import * as vscode from 'vscode';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { GoParser } from './goParser';
import { StructOptimizer } from './optimizer';
import { Architecture, ExportFormat, CACHE_LINE_SIZE, StructInfo } from './types';
import {
  buildStructDiagnostics,
  StructDiagnostic,
  DEFAULT_DIAGNOSTIC_OPTIONS,
  summariseFileSavings
} from './diagnostics';
import { compareStructAcrossArchs } from './archCompare';
import { buildMemoryMap, renderAsciiMap, buildOptimizePreview } from './memoryMap';
import { buildMemoryMapHtml, buildOptimizePreviewHtml } from './webviewHtml';

// Security constants
const MAX_FILES = 1000;
const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const MAX_RESULTS = 500;
const VALID_ARCHS: Architecture[] = ['amd64', 'arm64', '386'];
const DEBOUNCE_DELAY_MS = 250;

// default to amd64 since most devs use that
let currentArch: Architecture = 'amd64';

// Debounce timeout handle
let decorationDebounceTimer: NodeJS.Timeout | undefined;

/**
 * Escapes HTML special characters to prevent XSS attacks
 * VULN-001, VULN-002: Fix DOM-based XSS
 */
function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, c => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return entities[c] || c;
  });
}

/**
 * Escapes markdown special characters to prevent markdown injection
 * VULN-015, VULN-016: Fix markdown injection
 */
function escapeMarkdown(str: string): string {
  return str.replace(/[\\`*_{}[\]()#+\-.!|]/g, '\\$&');
}

/**
 * Sanitizes CSV values to prevent formula injection
 * VULN-004: Fix CSV injection
 */
function sanitizeCSVValue(val: string): string {
  let sanitized = val;
  // Prefix with single quote if starts with formula characters
  if (/^[=+\-@\t\r]/.test(sanitized)) {
    sanitized = "'" + sanitized;
  }
  // Escape double quotes and wrap in quotes
  return '"' + sanitized.replace(/"/g, '""') + '"';
}

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
  // VULN-021: Validate architecture config value
  const configArch = config.get('defaultArchitecture', 'amd64');
  currentArch = VALID_ARCHS.includes(configArch as Architecture) 
    ? configArch as Architecture 
    : 'amd64';

  const parser = new GoParser(currentArch);
  // VULN-003: Use public getter instead of bracket notation
  const optimizer = new StructOptimizer(parser.getCalculator());

  // honor known-stdlib setting so people can turn guessing off
  const useKnown = config.get('useKnownStdlibTypes', true);
  parser.getCalculator().setUseKnownTypes(Boolean(useKnown));

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

  context.subscriptions.push(
    vscode.commands.registerCommand('goMemoryVisualizer.compareArchitectures', () => {
      compareArchitecturesCommand(parser);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('goMemoryVisualizer.showMemoryMap', () => {
      showMemoryMapCommand(parser);
    })
  );

  // Register providers
  context.subscriptions.push(
    vscode.languages.registerHoverProvider('go', new MemoryLayoutHoverProvider(parser))
  );

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider('go', new OptimizationCodeLensProvider(parser, optimizer))
  );

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      'go',
      new OptimizationCodeActionProvider(parser, optimizer),
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.RefactorRewrite] }
    )
  );

  // Diagnostics surface high-padding, optimizable, and cache-line crossing
  // structs in the Problems panel.
  const diagnosticCollection = vscode.languages.createDiagnosticCollection('go-memory-visualizer');
  context.subscriptions.push(diagnosticCollection);

  // Status bar item: live byte savings for the current file.
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'goMemoryVisualizer.showMemoryLayout';
  context.subscriptions.push(statusBarItem);

  const refreshDiagnosticsAndStatus = (document: vscode.TextDocument | undefined) => {
    if (!document || document.languageId !== 'go') {
      statusBarItem.hide();
      return;
    }
    const structs = parser.parseStructs(document.getText());
    publishDiagnostics(diagnosticCollection, document, structs, optimizer);
    updateStatusBar(statusBarItem, structs, optimizer);
  };

  // keep known-types toggle live without reload
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('goMemoryVisualizer.useKnownStdlibTypes')) {
        const fresh = vscode.workspace.getConfiguration('goMemoryVisualizer');
        parser.getCalculator().setUseKnownTypes(Boolean(fresh.get('useKnownStdlibTypes', true)));
        if (vscode.window.activeTextEditor?.document.languageId === 'go') {
          updateDecorations(vscode.window.activeTextEditor, parser);
          refreshDiagnosticsAndStatus(vscode.window.activeTextEditor.document);
        }
      }
    })
  );

  // Update decorations on document change
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor && editor.document.languageId === 'go') {
        debouncedUpdateDecorations(editor, parser);
      }
      refreshDiagnosticsAndStatus(editor?.document);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(event => {
      const editor = vscode.window.activeTextEditor;
      if (editor && event.document === editor.document && editor.document.languageId === 'go') {
        // VULN-017: Debounce to prevent race conditions and CPU spike
        debouncedUpdateDecorations(editor, parser);
        refreshDiagnosticsAndStatus(editor.document);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument(document => {
      diagnosticCollection.delete(document.uri);
    })
  );

  // Initial pass over the active editor
  if (vscode.window.activeTextEditor?.document.languageId === 'go') {
    updateDecorations(vscode.window.activeTextEditor, parser);
    refreshDiagnosticsAndStatus(vscode.window.activeTextEditor.document);
  }
}

export function deactivate() {
  // VULN-017: Clear debounce timer on deactivate
  if (decorationDebounceTimer) {
    clearTimeout(decorationDebounceTimer);
  }
  paddingDecorationType.dispose();
  annotationDecorationType.dispose();
  cacheLineCrossDecorationType.dispose();
}

/**
 * VULN-017: Debounced decoration update to prevent race conditions
 */
function debouncedUpdateDecorations(editor: vscode.TextEditor, parser: GoParser) {
  if (decorationDebounceTimer) {
    clearTimeout(decorationDebounceTimer);
  }
  decorationDebounceTimer = setTimeout(() => {
    updateDecorations(editor, parser);
  }, DEBOUNCE_DELAY_MS);
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
  // VULN-022: Validate paddingWarningThreshold is a positive number
  const rawThreshold = config.get('paddingWarningThreshold', 8);
  const paddingThreshold = Math.max(0, Number(rawThreshold) || 8);
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
        // VULN-016: Escape field name to prevent markdown injection
        const safeFieldName = escapeMarkdown(field.name);
        cacheLineCrossRanges.push({
          range: line.range,
          hoverMessage: new vscode.MarkdownString(
            `**⚠️ Cache Line Crossing**\n\n` +
            `Field \`${safeFieldName}\` (${field.size} bytes) spans cache lines ${field.cacheLineStart} and ${field.cacheLineEnd}.\n\n` +
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

  const config = vscode.workspace.getConfiguration('goMemoryVisualizer');
  const confirm = config.get('confirmBeforeOptimize', true);

  if (confirm) {
    const preview = buildOptimizePreview(
      struct,
      result.originalSize,
      result.optimizedSize,
      result.bytesSaved,
      result.reorderedFields,
      result.optimizedPadding
    );

    const panel = vscode.window.createWebviewPanel(
      'optimizePreview',
      `Optimize ${struct.name}?`,
      vscode.ViewColumn.Beside,
      { enableScripts: false, localResourceRoots: [] }
    );
    panel.webview.html = buildOptimizePreviewHtml(preview);

    const choice = await vscode.window.showQuickPick(
      [
        {
          label: `Apply reorder`,
          description: `${result.originalSize}B → ${result.optimizedSize}B (save ${result.bytesSaved}B)`,
          apply: true
        },
        {
          label: `Cancel`,
          description: 'Leave the struct as-is',
          apply: false
        }
      ],
      { placeHolder: `Reorder ${struct.name}? pack ${preview.originalPackScore}% → ${preview.optimizedPackScore}%` }
    );

    panel.dispose();

    if (!choice || !choice.apply) {
      return;
    }
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
    `Optimized ${struct.name}: saved ${result.bytesSaved} bytes (${result.originalSize}B → ${result.optimizedSize}B, pack ${struct.packScore}% → ${computePackFromResult(result)}%)`
  );
}

function computePackFromResult(result: { optimizedSize: number; optimizedPadding: number }): number {
  if (result.optimizedSize <= 0) {
    return 100;
  }
  return Math.round(((result.optimizedSize - result.optimizedPadding) / result.optimizedSize) * 100);
}

function showMemoryMapCommand(parser: GoParser) {
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

  const position = editor.selection.active;
  let struct = structs.find(s =>
    position.line >= s.lineNumber && position.line <= s.endLineNumber
  );

  // fall back to first struct if cursor is not inside one
  if (!struct) {
    struct = structs[0];
  }

  const map = buildMemoryMap(struct);
  const ascii = renderAsciiMap(map);

  const panel = vscode.window.createWebviewPanel(
    'memoryMap',
    `Memory Map: ${struct.name}`,
    vscode.ViewColumn.Beside,
    { enableScripts: false, localResourceRoots: [] }
  );
  panel.webview.html = buildMemoryMapHtml(map, ascii);
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

  let output = `# Memory Layout (${escapeHtml(currentArch)})\n\n`;
  
  for (const struct of structs) {
    // VULN-002: Escape all user-controlled content
    const safeName = escapeHtml(struct.name);
    output += `## ${safeName}\n`;
    output += `Total Size: ${struct.totalSize} bytes\n`;
    output += `Alignment: ${struct.alignment} bytes\n`;
    output += `Total Padding: ${struct.totalPadding} bytes\n`;
    output += `Cache Lines: ${struct.cacheLinesCrossed} (${struct.cacheLinesCrossed * CACHE_LINE_SIZE} bytes)\n`;
    
    if (struct.hotFields.length > 0) {
      const safeHotFields = struct.hotFields.map(f => escapeHtml(f)).join(', ');
      output += `⚠️ Fields crossing cache lines: ${safeHotFields}\n`;
    }
    output += '\n';
    
    output += '| Field | Type | Offset | Size | Padding | Cache Line |\n';
    output += '|-------|------|--------|------|---------|------------|\n';
    
    for (const field of struct.fields) {
      const safeFieldName = escapeHtml(field.name);
      const safeTypeName = escapeHtml(field.typeName);
      const cacheLineStr = field.crossesCacheLine 
        ? `${field.cacheLineStart}-${field.cacheLineEnd} ⚠️` 
        : `${field.cacheLineStart}`;
      output += `| ${safeFieldName} | ${safeTypeName} | ${field.offset} | ${field.size} | ${field.paddingAfter} | ${cacheLineStr} |\n`;
    }
    
    output += '\n### Cache Line Breakdown\n\n';
    output += '| Line | Bytes | Fields | Used | Padding |\n';
    output += '|------|-------|--------|------|--------|\n';
    
    for (const cl of struct.cacheLines) {
      const safeFields = cl.fields.map(f => escapeHtml(f)).join(', ');
      output += `| ${cl.lineNumber} | ${cl.startOffset}-${cl.endOffset} | ${safeFields} | ${cl.bytesUsed}B | ${cl.bytesPadding}B |\n`;
    }
    
    output += '\n';
  }

  // VULN-011: Configure secure webview options
  const panel = vscode.window.createWebviewPanel(
    'memoryLayout',
    'Go Memory Layout',
    vscode.ViewColumn.Beside,
    {
      enableScripts: false,
      localResourceRoots: []
    }
  );

  // VULN-002, VULN-011: Add CSP header
  panel.webview.html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
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
      
      // VULN-008: Use async file operations to avoid blocking
      // VULN-013: Use mode 0o600 for more secure file permissions
      await fsPromises.writeFile(resolvedPath, content, { encoding: 'utf8', mode: 0o600 });
      
      // verify write
      try {
        await fsPromises.access(resolvedPath);
      } catch {
        throw new Error('File write verification failed');
      }
      
      vscode.window.showInformationMessage(`Memory layout exported successfully`);
    } catch (error) {
      // VULN-012: Avoid exposing internal error details to user
      console.error('Export failed:', error);
      vscode.window.showErrorMessage('Export failed. Check the output channel for details.');
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
    md += `- **Total Padding:** ${struct.totalPadding} bytes (${struct.paddingPercentage.toFixed(2)}%)\n`;
    const pack = struct.totalSize > 0
      ? Math.round(((struct.totalSize - struct.totalPadding) / struct.totalSize) * 100)
      : 100;
    md += `- **Pack Score:** ${pack}%\n\n`;
    
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
      // VULN-004: Sanitize all values to prevent CSV formula injection
      csv += `${sanitizeCSVValue(struct.name)},${sanitizeCSVValue(field.name)},${sanitizeCSVValue(field.type)},${field.offset},${field.size},${field.alignment},${field.paddingAfter},${struct.totalSize},${struct.totalPadding},${struct.paddingPercentage.toFixed(2)},${data.architecture}\n`;
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
    
    // VULN-010: Limit number of files to prevent resource exhaustion
    const filesToProcess = goFiles.slice(0, MAX_FILES);
    if (goFiles.length > MAX_FILES) {
      vscode.window.showWarningMessage(`Processing first ${MAX_FILES} files only`);
    }
    
    for (const file of filesToProcess) {
      if (token.isCancellationRequested) {
        break;
      }
      
      // VULN-010: Limit results to prevent memory exhaustion
      if (results.length >= MAX_RESULTS) {
        vscode.window.showWarningMessage(`Showing first ${MAX_RESULTS} results only`);
        break;
      }
      
      progress.report({ 
        increment: (100 / filesToProcess.length), 
        message: `${path.basename(file.fsPath)}` 
      });

      try {
        // VULN-010: Check file size before reading
        const stat = fs.statSync(file.fsPath);
        if (stat.size > MAX_FILE_SIZE) {
          console.debug(`Skipping large file: ${file.fsPath} (${stat.size} bytes)`);
          continue;
        }
        
        // VULN-008: Use async file read
        const content = await fsPromises.readFile(file.fsPath, 'utf8');
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
        // VULN-024: Log errors instead of silently swallowing them
        console.debug(`Skipping file ${file.fsPath}: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    }
  });

  if (results.length === 0) {
    vscode.window.showInformationMessage('All structs in workspace are optimally aligned!');
    return;
  }

  // Sort by bytes saveable (most impactful first)
  results.sort((a, b) => b.bytesSaveable - a.bytesSaveable);

  // Create report panel
  // VULN-011: Configure secure webview options
  const panel = vscode.window.createWebviewPanel(
    'workspaceAnalysis',
    'Workspace Memory Analysis',
    vscode.ViewColumn.One,
    { 
      enableScripts: false,  // Disable scripts since we don't need them
      localResourceRoots: [] // No local resources needed
    }
  );

  const totalSaveable = results.reduce((sum, r) => sum + r.bytesSaveable, 0);
  const totalPadding = results.reduce((sum, r) => sum + r.totalPadding, 0);
  const structsWithCacheIssues = results.filter(r => r.hotFields.length > 0).length;

  // VULN-001: Build HTML with proper escaping and CSP
  let html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
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
    // VULN-001: Escape all user-controlled content to prevent XSS
    const safeFile = escapeHtml(r.file);
    const safeStructName = escapeHtml(r.structName);
    const safeHotFields = r.hotFields.map(f => escapeHtml(f)).join(', ');
    
    const hotFieldsStr = r.hotFields.length > 0 
      ? `<span class="warning">${safeHotFields}</span>` 
      : '-';
    const saveableStr = r.bytesSaveable > 0 
      ? `<span class="saveable">${r.bytesSaveable}B</span>` 
      : '-';
    
    html += `
      <tr>
        <td>${safeFile}</td>
        <td><strong>${safeStructName}</strong></td>
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
        // VULN-015: Escape user-controlled content to prevent markdown injection
        const safeStructName = escapeMarkdown(struct.name);
        const safeFieldName = escapeMarkdown(field.name);
        const safeTypeName = escapeMarkdown(field.typeName);
        
        markdown.appendMarkdown(`**${safeStructName}.${safeFieldName}**\n\n`);
        markdown.appendMarkdown(`Type: \`${safeTypeName}\`\n\n`);
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
          title: `Optimize Layout (save ${result.bytesSaved}B · pack ${struct.packScore}%)`,
          command: 'goMemoryVisualizer.optimizeStruct',
          arguments: []
        });
        
        lenses.push(lens);
      }
    }

    return lenses;
  }
}

// Surfaces the optimizer as a Quick Fix lightbulb (Ctrl+.) on any struct
// declaration that can be reordered to save bytes.
class OptimizationCodeActionProvider implements vscode.CodeActionProvider {
  constructor(
    private parser: GoParser,
    private optimizer: StructOptimizer
  ) {}

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range
  ): vscode.ProviderResult<vscode.CodeAction[]> {
    const structs = this.parser.parseStructs(document.getText());
    const actions: vscode.CodeAction[] = [];

    for (const struct of structs) {
      if (range.start.line < struct.lineNumber || range.start.line > struct.endLineNumber) {
        continue;
      }
      const result = this.optimizer.optimizeStruct(struct);
      if (result.bytesSaved <= 0) {
        continue;
      }

      const action = new vscode.CodeAction(
        `Optimize ${struct.name} layout (save ${result.bytesSaved}B)`,
        vscode.CodeActionKind.RefactorRewrite
      );
      action.command = {
        command: 'goMemoryVisualizer.optimizeStruct',
        title: 'Optimize Struct Memory Layout'
      };
      action.isPreferred = true;
      actions.push(action);
    }

    return actions;
  }
}

function publishDiagnostics(
  collection: vscode.DiagnosticCollection,
  document: vscode.TextDocument,
  structs: StructInfo[],
  optimizer: StructOptimizer
): void {
  const config = vscode.workspace.getConfiguration('goMemoryVisualizer');
  const rawThreshold = config.get('paddingWarningThreshold', 8);
  const paddingThreshold = Math.max(0, Number(rawThreshold) || 8);
  const cacheLineWarnings = config.get('showCacheLineWarnings', true);

  const items = buildStructDiagnostics(structs, optimizer, {
    ...DEFAULT_DIAGNOSTIC_OPTIONS,
    paddingThreshold,
    cacheLineWarnings
  });

  const diagnostics: vscode.Diagnostic[] = items.map(item => toVSCodeDiagnostic(item, document));
  collection.set(document.uri, diagnostics);
}

function toVSCodeDiagnostic(item: StructDiagnostic, document: vscode.TextDocument): vscode.Diagnostic {
  const startLine = Math.max(0, Math.min(item.line, document.lineCount - 1));
  const lineRange = document.lineAt(startLine).range;
  const severity = item.severity === 'warning'
    ? vscode.DiagnosticSeverity.Warning
    : item.severity === 'hint'
    ? vscode.DiagnosticSeverity.Hint
    : vscode.DiagnosticSeverity.Information;

  const diagnostic = new vscode.Diagnostic(lineRange, item.message, severity);
  diagnostic.source = 'go-memory-visualizer';
  diagnostic.code = item.code;
  return diagnostic;
}

function updateStatusBar(
  item: vscode.StatusBarItem,
  structs: StructInfo[],
  optimizer: StructOptimizer
): void {
  const summary = summariseFileSavings(structs, optimizer);
  if (summary.totalStructs === 0) {
    item.hide();
    return;
  }

  const avgPack = structs.length > 0
    ? Math.round(structs.reduce((sum, s) => sum + s.packScore, 0) / structs.length)
    : 100;

  if (summary.fileSaveable === 0) {
    item.text = `$(check) Go layout: optimal · ${avgPack}% packed`;
    item.tooltip = `${summary.totalStructs} struct${summary.totalStructs === 1 ? '' : 's'} already optimally ordered (${currentArch}). Avg pack score ${avgPack}%.`;
  } else {
    item.text = `$(symbol-struct) Save ${summary.fileSaveable}B · ${avgPack}% packed`;
    item.tooltip = `${summary.optimizableCount} of ${summary.totalStructs} structs can be reordered to save ${summary.fileSaveable} bytes (${currentArch}). Avg pack score ${avgPack}%. Click for layout.`;
  }
  item.show();
}

async function compareArchitecturesCommand(parser: GoParser) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'go') {
    vscode.window.showErrorMessage('Please open a Go file');
    return;
  }

  const text = editor.document.getText();
  const structs = parser.parseStructs(text);
  const struct = structs.find(s =>
    editor.selection.active.line >= s.lineNumber &&
    editor.selection.active.line <= s.endLineNumber
  );
  if (!struct) {
    vscode.window.showErrorMessage('Place the cursor inside a struct definition first');
    return;
  }

  const comparison = compareStructAcrossArchs(text, struct.name);
  if (!comparison) {
    vscode.window.showErrorMessage(`Could not compare ${struct.name} across architectures`);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'archComparison',
    `Layout: ${struct.name}`,
    vscode.ViewColumn.Beside,
    { enableScripts: false, localResourceRoots: [] }
  );

  const safeName = escapeHtml(comparison.structName);
  const archCols = comparison.layouts.map(l => `<th>${escapeHtml(l.architecture)}</th>`).join('');
  const sizeRow = comparison.layouts
    .map(l => `<td><strong>${l.totalSize}B</strong> &middot; ${l.totalPadding}B pad &middot; align ${l.alignment}</td>`)
    .join('');

  const fieldNames = comparison.layouts[0].fields.map(f => f.name);
  const fieldRows = fieldNames.map(name => {
    const cells = comparison.layouts
      .map(l => {
        const f = l.fields.find(ff => ff.name === name);
        if (!f) {
          return `<td>-</td>`;
        }
        const padCell = f.paddingAfter > 0 ? ` <span class="pad">+${f.paddingAfter}B</span>` : '';
        return `<td>off ${f.offset} &middot; ${f.size}B${padCell}</td>`;
      })
      .join('');
    return `<tr><th>${escapeHtml(name)}</th>${cells}</tr>`;
  }).join('');

  panel.webview.html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
        <style>
          body { font-family: var(--vscode-font-family); padding: 24px; color: var(--vscode-foreground); }
          h1 { font-size: 18px; margin: 0 0 16px; }
          p { margin: 0 0 16px; color: var(--vscode-descriptionForeground); }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid var(--vscode-panel-border); padding: 8px 12px; text-align: left; vertical-align: top; }
          thead th { background: var(--vscode-editor-background); }
          tbody th { font-weight: 600; width: 18%; }
          .pad { color: #ff9c4a; font-style: italic; }
          .totals td { background: var(--vscode-editor-background); }
        </style>
      </head>
      <body>
        <h1>${safeName} layout across architectures</h1>
        <p>Side-by-side struct layout produced from the same source. Padding and alignment can shift between targets because pointer size and slice/string headers differ.</p>
        <table>
          <thead><tr><th>Field</th>${archCols}</tr></thead>
          <tbody>
            <tr class="totals"><th>total</th>${sizeRow}</tr>
            ${fieldRows}
          </tbody>
        </table>
      </body>
    </html>
  `;
}
