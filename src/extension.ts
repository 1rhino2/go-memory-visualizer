import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { GoParser } from './goParser';
import { StructOptimizer } from './optimizer';
import { Architecture, ExportFormat, CACHE_LINE_SIZE } from './types';

// default to amd64 since most devs use that
let currentArch: Architecture = 'amd64';

const paddingDecorationType = vscode.window.createTextEditorDecorationType({
  backgroundColor: 'rgba(255, 165, 0, 0.3)',
  border: '1px solid rgba(255, 165, 0, 0.5)',
});

const cacheLineCrossDecorationType = vscode.window.createTextEditorDecorationType({
  backgroundColor: 'rgba(255, 100, 100, 0.25)',
  border: '1px dashed rgba(255, 100, 100, 0.6)',
  after: {
    contentText: ' ⚠️ crosses cache line',
    color: '#ff6b6b',
    fontStyle: 'italic'
  }
});

const annotationDecorationType = vscode.window.createTextEditorDecorationType({
  before: {
    color: '#888',
    fontStyle: 'italic',
  },
  isWholeLine: false,
});

export function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration('goMemoryVisualizer');
  currentArch = config.get('defaultArchitecture', 'amd64') as Architecture;

  const parser = new GoParser(currentArch);
  const optimizer = new StructOptimizer(parser['calculator']);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('goMemoryVisualizer.optimizeStruct', () => {
      optimizeStructCommand(parser, optimizer);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('goMemoryVisualizer.showMemoryLayout', () => {
      showMemoryLayoutCommand(parser);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('goMemoryVisualizer.toggleArchitecture', () => {
      toggleArchitectureCommand(parser);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('goMemoryVisualizer.exportLayout', () => {
      exportLayoutCommand(parser);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('goMemoryVisualizer.analyzeWorkspace', () => {
      analyzeWorkspaceCommand(parser, optimizer);
    })
  );

  // Register providers
  context.subscriptions.push(
    vscode.languages.registerHoverProvider('go', new MemoryLayoutHoverProvider(parser))
  );

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider('go', new OptimizationCodeLensProvider(parser, optimizer))
  );

  // Update decorations on document change
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor && editor.document.languageId === 'go') {
        updateDecorations(editor, parser);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(event => {
      const editor = vscode.window.activeTextEditor;
      if (editor && event.document === editor.document && editor.document.languageId === 'go') {
        updateDecorations(editor, parser);
      }
    })
  );

  // Initial decoration
  if (vscode.window.activeTextEditor?.document.languageId === 'go') {
    updateDecorations(vscode.window.activeTextEditor, parser);
  }
}

export function deactivate() {
  paddingDecorationType.dispose();
  annotationDecorationType.dispose();
  cacheLineCrossDecorationType.dispose();
}

function updateDecorations(editor: vscode.TextEditor, parser: GoParser) {
  const config = vscode.workspace.getConfiguration('goMemoryVisualizer');
  if (!config.get('showInlineAnnotations', true)) {
    return;
  }

  const text = editor.document.getText();
  const structs = parser.parseStructs(text);
  
  const paddingRanges: vscode.DecorationOptions[] = [];
  const annotations: vscode.DecorationOptions[] = [];
  const cacheLineCrossRanges: vscode.DecorationOptions[] = [];
  const paddingThreshold = config.get('paddingWarningThreshold', 8);
  const showCacheLineWarnings = config.get('showCacheLineWarnings', true);

  for (const struct of structs) {
    for (const field of struct.fields) {
      const line = editor.document.lineAt(field.lineNumber);
      
      // Build the inline annotation text with cache line info
      const cacheLineTag = field.crossesCacheLine ? ` [L${field.cacheLineStart}-${field.cacheLineEnd}]` : ` [L${field.cacheLineStart}]`;
      const annotation = `[${field.offset}-${field.offset + field.size - 1}] ${field.size}B${cacheLineTag}`;
      const paddingInfo = field.paddingAfter > 0 ? ` +${field.paddingAfter}B pad` : '';
      
      annotations.push({
        range: new vscode.Range(field.lineNumber, 0, field.lineNumber, 0),
        renderOptions: {
          before: {
            contentText: `  ${annotation}${paddingInfo}  `,
            color: field.paddingAfter >= paddingThreshold ? '#ff6b6b' : 
                   field.crossesCacheLine ? '#ffaa00' : '#888',
          }
        }
      });

      // Highlight padding
      if (config.get('highlightPadding', true) && field.paddingAfter >= paddingThreshold) {
        paddingRanges.push({
          range: line.range,
          hoverMessage: `This field has ${field.paddingAfter} bytes of padding after it. Consider reordering struct fields.`
        });
      }

      // Highlight cache line crossings
      if (showCacheLineWarnings && field.crossesCacheLine) {
        cacheLineCrossRanges.push({
          range: line.range,
          hoverMessage: new vscode.MarkdownString(
            `**⚠️ Cache Line Crossing**\n\n` +
            `Field \`${field.name}\` (${field.size} bytes) spans cache lines ${field.cacheLineStart} and ${field.cacheLineEnd}.\n\n` +
            `This can cause **false sharing** in concurrent access and reduce cache efficiency.\n\n` +
            `Consider:\n` +
            `- Padding to align to cache line boundary\n` +
            `- Splitting into smaller fields\n` +
            `- Using \`//go:align ${CACHE_LINE_SIZE}\` directive`
          )
        });
      }
    }
  }

  editor.setDecorations(annotationDecorationType, annotations);
  editor.setDecorations(paddingDecorationType, paddingRanges);
  editor.setDecorations(cacheLineCrossDecorationType, cacheLineCrossRanges);
}

async function optimizeStructCommand(parser: GoParser, optimizer: StructOptimizer) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'go') {
    vscode.window.showErrorMessage('Please open a Go file');
    return;
  }

  const position = editor.selection.active;
  const text = editor.document.getText();
  const structs = parser.parseStructs(text);

  // Find struct containing cursor
  const struct = structs.find(s => 
    position.line >= s.lineNumber && position.line <= s.endLineNumber
  );

  if (!struct) {
    vscode.window.showErrorMessage('Cursor not inside a struct definition');
    return;
  }

  const result = optimizer.optimizeStruct(struct);
  
  if (result.bytesSaved === 0) {
    vscode.window.showInformationMessage(`Struct ${struct.name} is already optimally ordered`);
    return;
  }

  const optimized = optimizer.generateOptimizedCode(text, struct, result);
  
  await editor.edit(editBuilder => {
    const fullRange = new vscode.Range(
      editor.document.positionAt(0),
      editor.document.positionAt(text.length)
    );
    editBuilder.replace(fullRange, optimized);
  });

  vscode.window.showInformationMessage(
    `Optimized ${struct.name}: saved ${result.bytesSaved} bytes (${result.originalSize}B → ${result.optimizedSize}B)`
  );
}

function showMemoryLayoutCommand(parser: GoParser) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'go') {
    vscode.window.showErrorMessage('Please open a Go file');
    return;
  }

  const text = editor.document.getText();
  const structs = parser.parseStructs(text);

  if (structs.length === 0) {
    vscode.window.showInformationMessage('No structs found in current file');
    return;
  }

  let output = `# Memory Layout (${currentArch})\n\n`;
  
  for (const struct of structs) {
    output += `## ${struct.name}\n`;
    output += `Total Size: ${struct.totalSize} bytes\n`;
    output += `Alignment: ${struct.alignment} bytes\n`;
    output += `Total Padding: ${struct.totalPadding} bytes\n`;
    output += `Cache Lines: ${struct.cacheLinesCrossed} (${struct.cacheLinesCrossed * CACHE_LINE_SIZE} bytes)\n`;
    
    if (struct.hotFields.length > 0) {
      output += `⚠️ Fields crossing cache lines: ${struct.hotFields.join(', ')}\n`;
    }
    output += '\n';
    
    output += '| Field | Type | Offset | Size | Padding | Cache Line |\n';
    output += '|-------|------|--------|------|---------|------------|\n';
    
    for (const field of struct.fields) {
      const cacheLineStr = field.crossesCacheLine 
        ? `${field.cacheLineStart}-${field.cacheLineEnd} ⚠️` 
        : `${field.cacheLineStart}`;
      output += `| ${field.name} | ${field.typeName} | ${field.offset} | ${field.size} | ${field.paddingAfter} | ${cacheLineStr} |\n`;
    }
    
    output += '\n### Cache Line Breakdown\n\n';
    output += '| Line | Bytes | Fields | Used | Padding |\n';
    output += '|------|-------|--------|------|--------|\n';
    
    for (const cl of struct.cacheLines) {
      output += `| ${cl.lineNumber} | ${cl.startOffset}-${cl.endOffset} | ${cl.fields.join(', ')} | ${cl.bytesUsed}B | ${cl.bytesPadding}B |\n`;
    }
    
    output += '\n';
  }

  const panel = vscode.window.createWebviewPanel(
    'memoryLayout',
    'Go Memory Layout',
    vscode.ViewColumn.Beside,
    {}
  );

  panel.webview.html = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body { font-family: var(--vscode-font-family); padding: 20px; }
          table { border-collapse: collapse; margin: 20px 0; }
          th, td { border: 1px solid var(--vscode-panel-border); padding: 8px; text-align: left; }
          th { background-color: var(--vscode-editor-background); }
          h1, h2 { color: var(--vscode-foreground); }
          .warning { color: #ff6b6b; }
        </style>
      </head>
      <body>
        <pre>${output}</pre>
      </body>
    </html>
  `;
}

async function toggleArchitectureCommand(parser: GoParser) {
  const archs: Architecture[] = ['amd64', 'arm64', '386'];
  const selected = await vscode.window.showQuickPick(archs, {
    placeHolder: `Current: ${currentArch}`
  });

  if (selected) {
    currentArch = selected as Architecture;
    parser.setArchitecture(selected as Architecture);
    
    if (vscode.window.activeTextEditor?.document.languageId === 'go') {
      updateDecorations(vscode.window.activeTextEditor, parser);
    }
    
    vscode.window.showInformationMessage(`Architecture set to ${selected}`);
  }
}

async function exportLayoutCommand(parser: GoParser) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'go') {
    vscode.window.showErrorMessage('Please open a Go file');
    return;
  }

  const text = editor.document.getText();
  const structs = parser.parseStructs(text);

  if (structs.length === 0) {
    vscode.window.showInformationMessage('No structs found in current file');
    return;
  }

  const format = await vscode.window.showQuickPick(['JSON', 'Markdown', 'CSV'], {
    placeHolder: 'Select export format'
  });

  if (!format) {
    return;
  }

  const exportData: ExportFormat = {
    structs: structs.map(s => ({
      name: s.name,
      totalSize: s.totalSize,
      alignment: s.alignment,
      totalPadding: s.totalPadding,
      paddingPercentage: s.totalSize > 0 ? (s.totalPadding / s.totalSize) * 100 : 0,
      fields: s.fields.map(f => ({
        name: f.name,
        type: f.typeName,
        offset: f.offset,
        size: f.size,
        alignment: f.alignment,
        paddingAfter: f.paddingAfter
      }))
    })),
    architecture: currentArch,
    exportedAt: new Date().toISOString()
  };

  let content: string;
  let extension: string;

  switch (format) {
    case 'JSON':
      content = JSON.stringify(exportData, null, 2);
      extension = 'json';
      break;
    
    case 'Markdown':
      content = generateMarkdownReport(exportData);
      extension = 'md';
      break;
    
    case 'CSV':
      content = generateCSVReport(exportData);
      extension = 'csv';
      break;
    
    default:
      return;
  }

  const defaultFileName = `memory-layout-${currentArch}-${Date.now()}.${extension}`;
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
  
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(workspaceFolder, defaultFileName)),
    filters: {
      'Memory Layout': [extension]
    }
  });

  if (uri) {
    try {
      // validate path before writing
      const normalizedPath = path.normalize(uri.fsPath);
      const resolvedPath = path.resolve(normalizedPath);
      
      // check if path is within workspace or user selected valid location
      if (resolvedPath !== normalizedPath && !path.isAbsolute(normalizedPath)) {
        vscode.window.showErrorMessage('Invalid file path');
        return;
      }
      
      // ensure parent dir exists
      const parentDir = path.dirname(resolvedPath);
      if (!fs.existsSync(parentDir)) {
        vscode.window.showErrorMessage('Parent directory does not exist');
        return;
      }
      
      // write with explicit encoding and error handling
      fs.writeFileSync(resolvedPath, content, { encoding: 'utf8', mode: 0o644 });
      
      // verify write
      if (!fs.existsSync(resolvedPath)) {
        throw new Error('File write verification failed');
      }
      
      vscode.window.showInformationMessage(`Memory layout exported successfully`);
    } catch (error) {
      vscode.window.showErrorMessage(`Export failed: ${(error as Error).message}`);
    }
  }
}

function generateMarkdownReport(data: ExportFormat): string {
  let md = `# Go Memory Layout Report\n\n`;
  md += `**Architecture:** ${data.architecture}\n\n`;
  md += `**Generated:** ${data.exportedAt}\n\n`;
  md += `---\n\n`;

  for (const struct of data.structs) {
    md += `## ${struct.name}\n\n`;
    md += `- **Total Size:** ${struct.totalSize} bytes\n`;
    md += `- **Alignment:** ${struct.alignment} bytes\n`;
    md += `- **Total Padding:** ${struct.totalPadding} bytes (${struct.paddingPercentage.toFixed(2)}%)\n\n`;
    
    md += `### Fields\n\n`;
    md += `| Field | Type | Offset | Size | Alignment | Padding After |\n`;
    md += `|-------|------|--------|------|-----------|---------------|\n`;
    
    for (const field of struct.fields) {
      md += `| ${field.name} | ${field.type} | ${field.offset} | ${field.size} | ${field.alignment} | ${field.paddingAfter} |\n`;
    }
    
    md += `\n`;
  }

  return md;
}

function generateCSVReport(data: ExportFormat): string {
  let csv = `Struct,Field,Type,Offset,Size,Alignment,Padding After,Total Size,Total Padding,Padding Percentage,Architecture\n`;
  
  for (const struct of data.structs) {
    for (const field of struct.fields) {
      csv += `"${struct.name}","${field.name}","${field.type}",${field.offset},${field.size},${field.alignment},${field.paddingAfter},${struct.totalSize},${struct.totalPadding},${struct.paddingPercentage.toFixed(2)},${data.architecture}\n`;
    }
  }

  return csv;
}

interface WorkspaceAnalysisResult {
  file: string;
  structName: string;
  totalSize: number;
  totalPadding: number;
  paddingPercentage: number;
  bytesSaveable: number;
  cacheLinesCrossed: number;
  hotFields: string[];
}

async function analyzeWorkspaceCommand(parser: GoParser, optimizer: StructOptimizer) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showErrorMessage('No workspace folder open');
    return;
  }

  const results: WorkspaceAnalysisResult[] = [];
  
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Analyzing Go structs in workspace...',
    cancellable: true
  }, async (progress, token) => {
    const goFiles = await vscode.workspace.findFiles('**/*.go', '**/vendor/**');
    
    let processed = 0;
    for (const file of goFiles) {
      if (token.isCancellationRequested) {
        break;
      }
      
      progress.report({ 
        increment: (100 / goFiles.length), 
        message: `${path.basename(file.fsPath)}` 
      });

      try {
        const content = fs.readFileSync(file.fsPath, 'utf8');
        const structs = parser.parseStructs(content);
        
        for (const struct of structs) {
          const optimization = optimizer.optimizeStruct(struct);
          const paddingPct = struct.totalSize > 0 ? (struct.totalPadding / struct.totalSize) * 100 : 0;
          
          // Only include structs with issues
          if (optimization.bytesSaved > 0 || paddingPct > 10 || struct.hotFields.length > 0) {
            results.push({
              file: vscode.workspace.asRelativePath(file),
              structName: struct.name,
              totalSize: struct.totalSize,
              totalPadding: struct.totalPadding,
              paddingPercentage: paddingPct,
              bytesSaveable: optimization.bytesSaved,
              cacheLinesCrossed: struct.cacheLinesCrossed,
              hotFields: struct.hotFields
            });
          }
        }
      } catch (e) {
        // Skip files that can't be read
      }
      
      processed++;
    }
  });

  if (results.length === 0) {
    vscode.window.showInformationMessage('All structs in workspace are optimally aligned!');
    return;
  }

  // Sort by bytes saveable (most impactful first)
  results.sort((a, b) => b.bytesSaveable - a.bytesSaveable);

  // Create report panel
  const panel = vscode.window.createWebviewPanel(
    'workspaceAnalysis',
    'Workspace Memory Analysis',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  const totalSaveable = results.reduce((sum, r) => sum + r.bytesSaveable, 0);
  const totalPadding = results.reduce((sum, r) => sum + r.totalPadding, 0);
  const structsWithCacheIssues = results.filter(r => r.hotFields.length > 0).length;

  let html = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body { font-family: var(--vscode-font-family); padding: 20px; color: var(--vscode-foreground); }
          h1, h2, h3 { color: var(--vscode-foreground); }
          .summary { background: var(--vscode-editor-background); padding: 15px; border-radius: 5px; margin-bottom: 20px; }
          .stat { display: inline-block; margin-right: 30px; }
          .stat-value { font-size: 24px; font-weight: bold; color: var(--vscode-textLink-foreground); }
          .stat-label { font-size: 12px; color: var(--vscode-descriptionForeground); }
          table { border-collapse: collapse; width: 100%; margin-top: 20px; }
          th, td { border: 1px solid var(--vscode-panel-border); padding: 8px; text-align: left; }
          th { background-color: var(--vscode-editor-background); }
          .warning { color: #ff6b6b; }
          .saveable { color: #4caf50; font-weight: bold; }
          tr:hover { background: var(--vscode-list-hoverBackground); }
        </style>
      </head>
      <body>
        <h1>📊 Workspace Memory Analysis</h1>
        <p>Architecture: <strong>${currentArch}</strong></p>
        
        <div class="summary">
          <div class="stat">
            <div class="stat-value">${results.length}</div>
            <div class="stat-label">Structs with issues</div>
          </div>
          <div class="stat">
            <div class="stat-value saveable">${totalSaveable}B</div>
            <div class="stat-label">Total bytes saveable</div>
          </div>
          <div class="stat">
            <div class="stat-value">${totalPadding}B</div>
            <div class="stat-label">Total padding</div>
          </div>
          <div class="stat">
            <div class="stat-value warning">${structsWithCacheIssues}</div>
            <div class="stat-label">Cache line issues</div>
          </div>
        </div>

        <h2>Optimization Opportunities</h2>
        <table>
          <tr>
            <th>File</th>
            <th>Struct</th>
            <th>Size</th>
            <th>Padding</th>
            <th>Saveable</th>
            <th>Cache Lines</th>
            <th>Hot Fields</th>
          </tr>
  `;

  for (const r of results) {
    const hotFieldsStr = r.hotFields.length > 0 
      ? `<span class="warning">${r.hotFields.join(', ')}</span>` 
      : '-';
    const saveableStr = r.bytesSaveable > 0 
      ? `<span class="saveable">${r.bytesSaveable}B</span>` 
      : '-';
    
    html += `
      <tr>
        <td>${r.file}</td>
        <td><strong>${r.structName}</strong></td>
        <td>${r.totalSize}B</td>
        <td>${r.totalPadding}B (${r.paddingPercentage.toFixed(1)}%)</td>
        <td>${saveableStr}</td>
        <td>${r.cacheLinesCrossed}</td>
        <td>${hotFieldsStr}</td>
      </tr>
    `;
  }

  html += `
        </table>
      </body>
    </html>
  `;

  panel.webview.html = html;
}

class MemoryLayoutHoverProvider implements vscode.HoverProvider {
  constructor(private parser: GoParser) {}

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.Hover> {
    const text = document.getText();
    const structs = this.parser.parseStructs(text);

    for (const struct of structs) {
      const field = struct.fields.find(f => f.lineNumber === position.line);
      
      if (field) {
        const markdown = new vscode.MarkdownString();
        markdown.appendMarkdown(`**${struct.name}.${field.name}**\n\n`);
        markdown.appendMarkdown(`Type: \`${field.typeName}\`\n\n`);
        markdown.appendMarkdown(`Offset: ${field.offset} bytes\n\n`);
        markdown.appendMarkdown(`Size: ${field.size} bytes\n\n`);
        markdown.appendMarkdown(`Alignment: ${field.alignment} bytes\n\n`);
        markdown.appendMarkdown(`Cache Line: ${field.cacheLineStart}${field.crossesCacheLine ? `-${field.cacheLineEnd} ⚠️` : ''}\n\n`);
        
        if (field.paddingAfter > 0) {
          markdown.appendMarkdown(`⚠️ Padding after: ${field.paddingAfter} bytes\n\n`);
        }

        if (field.crossesCacheLine) {
          markdown.appendMarkdown(`---\n\n`);
          markdown.appendMarkdown(`**⚠️ Performance Warning**\n\n`);
          markdown.appendMarkdown(`This field crosses cache line boundaries (${field.cacheLineStart} → ${field.cacheLineEnd}), which can cause:\n\n`);
          markdown.appendMarkdown(`- Extra memory fetches\n`);
          markdown.appendMarkdown(`- False sharing in concurrent code\n`);
          markdown.appendMarkdown(`- Reduced cache efficiency\n`);
        }
        
        return new vscode.Hover(markdown);
      }
    }

    return null;
  }
}

class OptimizationCodeLensProvider implements vscode.CodeLensProvider {
  constructor(
    private parser: GoParser,
    private optimizer: StructOptimizer
  ) {}

  provideCodeLenses(document: vscode.TextDocument): vscode.ProviderResult<vscode.CodeLens[]> {
    const text = document.getText();
    const structs = this.parser.parseStructs(text);
    const lenses: vscode.CodeLens[] = [];

    for (const struct of structs) {
      const result = this.optimizer.optimizeStruct(struct);
      
      if (result.bytesSaved > 0) {
        const range = new vscode.Range(struct.lineNumber, 0, struct.lineNumber, 0);
        
        const lens = new vscode.CodeLens(range, {
          title: `Optimize Layout (save ${result.bytesSaved}B)`,
          command: 'goMemoryVisualizer.optimizeStruct',
          arguments: []
        });
        
        lenses.push(lens);
      }
    }

    return lenses;
  }
}


