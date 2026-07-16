import { FieldInfo, StructInfo, CACHE_LINE_SIZE } from './types';
import { MAX_MEMORY_MAP_BYTES } from './security';

export type MapCellKind = 'field' | 'padding' | 'empty';

export interface MemoryMapCell {
  offset: number;
  kind: MapCellKind;
  fieldName?: string;
  // stable index so the UI can color the same field consistently
  colorIndex: number;
}

export interface MemoryMap {
  structName: string;
  totalSize: number;
  totalPadding: number;
  // 0-100: how much of the struct is real data vs padding
  packScore: number;
  cells: MemoryMapCell[];
  // one row per cache line for nicer rendering
  rows: MemoryMapCell[][];
  // true when we capped cells to avoid OOM on huge arrays
  truncated: boolean;
}

export interface OptimizePreview {
  structName: string;
  originalSize: number;
  optimizedSize: number;
  bytesSaved: number;
  originalOrder: string[];
  optimizedOrder: string[];
  originalPackScore: number;
  optimizedPackScore: number;
}

// How packed the struct is. 100 means zero padding.
export function computePackScore(totalSize: number, totalPadding: number): number {
  if (totalSize <= 0) {
    return 100;
  }
  const used = Math.max(0, totalSize - totalPadding);
  return Math.round((used / totalSize) * 100);
}

export function buildMemoryMap(struct: StructInfo): MemoryMap {
  const cells: MemoryMapCell[] = [];
  const colorByField = new Map<string, number>();
  let nextColor = 0;

  // never allocate one cell per byte for multi-MB structs
  const mapSize = Math.min(Math.max(0, struct.totalSize), MAX_MEMORY_MAP_BYTES);
  const truncated = struct.totalSize > MAX_MEMORY_MAP_BYTES;

  for (let offset = 0; offset < mapSize; offset++) {
    const owner = findFieldAt(struct.fields, offset);
    if (owner) {
      if (!colorByField.has(owner.name)) {
        colorByField.set(owner.name, nextColor++);
      }
      cells.push({
        offset,
        kind: 'field',
        fieldName: owner.name,
        colorIndex: colorByField.get(owner.name)!
      });
    } else {
      cells.push({
        offset,
        kind: 'padding',
        colorIndex: -1
      });
    }
  }

  const rows: MemoryMapCell[][] = [];
  for (let i = 0; i < cells.length; i += CACHE_LINE_SIZE) {
    rows.push(cells.slice(i, i + CACHE_LINE_SIZE));
  }

  return {
    structName: struct.name,
    totalSize: struct.totalSize,
    totalPadding: struct.totalPadding,
    packScore: computePackScore(struct.totalSize, struct.totalPadding),
    cells,
    rows,
    truncated
  };
}

function findFieldAt(fields: FieldInfo[], offset: number): FieldInfo | undefined {
  for (const field of fields) {
    if (offset >= field.offset && offset < field.offset + field.size) {
      return field;
    }
  }
  return undefined;
}

// Compact ASCII map for markdown export / clipboard. Each char is one byte.
export function renderAsciiMap(map: MemoryMap, bytesPerRow: number = 16): string {
  const lines: string[] = [];
  lines.push(`${map.structName}  ${map.totalSize}B  pack ${map.packScore}%  pad ${map.totalPadding}B`);
  if (map.truncated) {
    lines.push(`(map truncated to first ${map.cells.length} bytes)`);
  }
  lines.push('');

  const legend = new Map<string, string>();
  const glyphs = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let glyphIdx = 0;

  for (const cell of map.cells) {
    if (cell.kind === 'field' && cell.fieldName && !legend.has(cell.fieldName)) {
      legend.set(cell.fieldName, glyphs[glyphIdx % glyphs.length]);
      glyphIdx++;
    }
  }

  for (let rowStart = 0; rowStart < map.cells.length; rowStart += bytesPerRow) {
    const slice = map.cells.slice(rowStart, rowStart + bytesPerRow);
    const offsetLabel = rowStart.toString(16).padStart(4, '0');
    let row = `${offsetLabel}  `;
    for (const cell of slice) {
      if (cell.kind === 'padding') {
        row += '.';
      } else if (cell.fieldName) {
        row += legend.get(cell.fieldName) || '?';
      } else {
        row += ' ';
      }
    }
    // pad short last rows so columns line up
    row += ' '.repeat(Math.max(0, bytesPerRow - slice.length));
    lines.push(row);
  }

  lines.push('');
  lines.push('legend: ' + [...legend.entries()].map(([name, g]) => `${g}=${name}`).join('  ') + '  .=padding');
  return lines.join('\n');
}

export function buildOptimizePreview(
  struct: StructInfo,
  originalSize: number,
  optimizedSize: number,
  bytesSaved: number,
  optimizedOrder: string[],
  optimizedPadding: number
): OptimizePreview {
  return {
    structName: struct.name,
    originalSize,
    optimizedSize,
    bytesSaved,
    originalOrder: struct.fields.map(f => f.name),
    optimizedOrder,
    originalPackScore: computePackScore(struct.totalSize, struct.totalPadding),
    optimizedPackScore: computePackScore(optimizedSize, optimizedPadding)
  };
}
