import { MemoryMap, OptimizePreview } from './memoryMap';

// Solid palette - no gradients. Distinct enough to tell fields apart.
const FIELD_COLORS = [
  '#3d8bfd',
  '#20c997',
  '#fd7e14',
  '#cc5de8',
  '#fcc419',
  '#ff6b6b',
  '#15aabf',
  '#82c91e',
  '#e64980',
  '#748ffc'
];

const PAD_COLOR = '#4a4a4a';

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

function cellColor(colorIndex: number, kind: string): string {
  if (kind === 'padding') {
    return PAD_COLOR;
  }
  if (colorIndex < 0) {
    return PAD_COLOR;
  }
  return FIELD_COLORS[colorIndex % FIELD_COLORS.length];
}

export function buildMemoryMapHtml(map: MemoryMap, ascii: string): string {
  const safeName = escapeHtml(map.structName);
  const legendEntries = new Map<string, number>();
  for (const cell of map.cells) {
    if (cell.kind === 'field' && cell.fieldName && !legendEntries.has(cell.fieldName)) {
      legendEntries.set(cell.fieldName, cell.colorIndex);
    }
  }

  let legendHtml = '';
  for (const [name, idx] of legendEntries) {
    const color = cellColor(idx, 'field');
    legendHtml += `<span class="legend-item"><span class="swatch" style="background:${color}"></span>${escapeHtml(name)}</span>`;
  }
  legendHtml += `<span class="legend-item"><span class="swatch" style="background:${PAD_COLOR}"></span>padding</span>`;

  let gridHtml = '';
  for (const row of map.rows) {
    gridHtml += '<div class="row">';
    for (const cell of row) {
      const color = cellColor(cell.colorIndex, cell.kind);
      const title = cell.kind === 'padding'
        ? `offset ${cell.offset}: padding`
        : `offset ${cell.offset}: ${cell.fieldName}`;
      gridHtml += `<div class="cell" style="background:${color}" title="${escapeHtml(title)}"></div>`;
    }
    gridHtml += '</div>';
  }

  return `<!DOCTYPE html>
<html>
  <head>
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
    <style>
      body {
        font-family: var(--vscode-font-family);
        padding: 20px;
        color: var(--vscode-foreground);
        background: var(--vscode-editor-background);
      }
      h1 { font-size: 18px; margin: 0 0 8px; font-weight: 600; }
      .meta { color: var(--vscode-descriptionForeground); margin-bottom: 16px; font-size: 13px; }
      .stat { display: inline-block; margin-right: 20px; }
      .stat b { color: var(--vscode-textLink-foreground); }
      .legend { margin: 12px 0 16px; display: flex; flex-wrap: wrap; gap: 10px; }
      .legend-item { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; }
      .swatch { width: 12px; height: 12px; border: 1px solid var(--vscode-panel-border); }
      .grid { display: inline-block; border: 1px solid var(--vscode-panel-border); padding: 4px; }
      .row { display: flex; }
      .cell {
        width: 10px;
        height: 10px;
        margin: 1px;
        border: 1px solid rgba(0,0,0,0.15);
      }
      pre {
        margin-top: 20px;
        padding: 12px;
        background: var(--vscode-textCodeBlock-background, #1e1e1e);
        border: 1px solid var(--vscode-panel-border);
        overflow-x: auto;
        font-size: 12px;
        line-height: 1.4;
      }
      h2 { font-size: 14px; margin: 24px 0 8px; font-weight: 600; }
    </style>
  </head>
  <body>
    <h1>${safeName} memory map</h1>
    <div class="meta">
      <span class="stat">size <b>${map.totalSize}B</b></span>
      <span class="stat">padding <b>${map.totalPadding}B</b></span>
      <span class="stat">pack score <b>${map.packScore}%</b></span>
    </div>
    <div class="legend">${legendHtml}</div>
    <div class="grid">${gridHtml}</div>
    <h2>ASCII</h2>
    <pre>${escapeHtml(ascii)}</pre>
  </body>
</html>`;
}

export function buildOptimizePreviewHtml(preview: OptimizePreview): string {
  const safeName = escapeHtml(preview.structName);
  const origList = preview.originalOrder.map(n => `<li>${escapeHtml(n)}</li>`).join('');
  const optList = preview.optimizedOrder.map(n => `<li>${escapeHtml(n)}</li>`).join('');

  return `<!DOCTYPE html>
<html>
  <head>
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
    <style>
      body {
        font-family: var(--vscode-font-family);
        padding: 20px;
        color: var(--vscode-foreground);
        background: var(--vscode-editor-background);
      }
      h1 { font-size: 18px; margin: 0 0 12px; }
      .banner {
        padding: 12px 14px;
        border: 1px solid var(--vscode-panel-border);
        background: var(--vscode-editor-background);
        margin-bottom: 20px;
      }
      .saved { color: #4caf50; font-weight: 600; }
      .cols { display: flex; gap: 24px; flex-wrap: wrap; }
      .col { flex: 1; min-width: 160px; }
      h2 { font-size: 13px; margin: 0 0 8px; color: var(--vscode-descriptionForeground); font-weight: 600; }
      ol { margin: 0; padding-left: 20px; }
      li { margin: 2px 0; }
      .score { font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 6px; }
    </style>
  </head>
  <body>
    <h1>Optimize ${safeName}?</h1>
    <div class="banner">
      ${preview.originalSize}B → ${preview.optimizedSize}B
      <span class="saved">save ${preview.bytesSaved}B</span>
      &nbsp;·&nbsp; pack ${preview.originalPackScore}% → ${preview.optimizedPackScore}%
    </div>
    <div class="cols">
      <div class="col">
        <h2>Current order</h2>
        <ol>${origList}</ol>
        <div class="score">pack ${preview.originalPackScore}%</div>
      </div>
      <div class="col">
        <h2>Proposed order</h2>
        <ol>${optList}</ol>
        <div class="score">pack ${preview.optimizedPackScore}%</div>
      </div>
    </div>
  </body>
</html>`;
}
