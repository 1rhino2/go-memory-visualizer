import { StructInfo, FieldInfo, OptimizationResult } from './types';
import { MemoryCalculator } from './memoryCalculator';

export class StructOptimizer {
  private calculator: MemoryCalculator;

  constructor(calculator: MemoryCalculator) {
    this.calculator = calculator;
  }

  optimizeStruct(struct: StructInfo): OptimizationResult {
    if (struct.fields.length === 0) {
      return {
        originalSize: 0,
        optimizedSize: 0,
        bytesSaved: 0,
        reorderedFields: [],
        reorderedIndices: [],
        optimizedPadding: 0
      };
    }

    const originalSize = struct.totalSize;

    // sort by alignment first (biggest first), then size - this minimizes
    // padding. zero-size fields go up front: Go pads a struct that ends in
    // one by a whole byte (then aligns), which can cost more than it saves.
    const order = struct.fields.map((_, idx) => idx).sort((ia, ib) => {
      const a = struct.fields[ia];
      const b = struct.fields[ib];
      const aZero = a.size === 0 ? 0 : 1;
      const bZero = b.size === 0 ? 0 : 1;
      if (aZero !== bZero) {
        return aZero - bZero;
      }
      if (a.alignment !== b.alignment) {
        return b.alignment - a.alignment;
      }
      return b.size - a.size;
    });
    const sortedFields = order.map(idx => struct.fields[idx]);

    // Calculate new layout
    const optimizedLayout = this.calculator.calculateStructSize(
      sortedFields.map(f => ({ typeName: f.typeName }))
    );

    const optimizedPadding = optimizedLayout.paddings.reduce((sum, p) => sum + p, 0);

    return {
      originalSize,
      optimizedSize: optimizedLayout.size,
      bytesSaved: originalSize - optimizedLayout.size,
      reorderedFields: sortedFields.map(f => f.name),
      reorderedIndices: order,
      optimizedPadding
    };
  }

  generateOptimizedCode(
    originalCode: string,
    struct: StructInfo,
    optimization: OptimizationResult
  ): string {
    const lines = originalCode.split('\n');

    // one-line struct: the whole body sits on the opener, rebuild it inline
    if (struct.lineNumber === struct.endLineNumber) {
      return this.rewriteInlineStruct(lines, struct, optimization);
    }

    const structDeclLine = lines[struct.lineNumber];
    const newLines: string[] = [structDeclLine];

    // Each field owns its own lines plus any // comment lines directly above
    // it, so docs travel with the field instead of vanishing. Blank lines
    // between groups are dropped like before.
    const claimed = new Set<number>();
    const blockFor = (field: FieldInfo): string[] => {
      let start = field.lineNumber;
      while (start - 1 > struct.lineNumber) {
        const prev = lines[start - 1].trim();
        if (!prev.startsWith('//') || claimed.has(start - 1)) {
          break;
        }
        start--;
      }
      const out: string[] = [];
      for (let ln = start; ln <= field.endLineNumber; ln++) {
        if (!claimed.has(ln)) {
          out.push(lines[ln]);
          claimed.add(ln);
        }
      }
      return out;
    };

    const indices = optimization.reorderedIndices.length === struct.fields.length
      ? optimization.reorderedIndices
      : this.indicesFromNames(struct, optimization.reorderedFields);

    for (const idx of indices) {
      const field = struct.fields[idx];
      if (!field) {
        continue;
      }
      // `a, b int` shares one line; the first name emits it, later ones skip
      newLines.push(...blockFor(field));
    }

    // anything left unclaimed between the braces that is not blank (a
    // trailing comment, a line we failed to parse) is kept in place so the
    // rewrite never silently deletes source
    for (let ln = struct.lineNumber + 1; ln < struct.endLineNumber; ln++) {
      if (!claimed.has(ln) && lines[ln].trim() !== '') {
        newLines.push(lines[ln]);
      }
    }

    // Add closing brace
    newLines.push(lines[struct.endLineNumber]);

    // Replace the struct in the original code
    const before = lines.slice(0, struct.lineNumber);
    const after = lines.slice(struct.endLineNumber + 1);

    return [...before, ...newLines, ...after].join('\n');
  }

  private rewriteInlineStruct(lines: string[], struct: StructInfo, optimization: OptimizationResult): string {
    const line = lines[struct.lineNumber];
    const open = line.indexOf('{');
    const close = line.lastIndexOf('}');
    if (open < 0 || close < open) {
      return lines.join('\n');
    }
    const pieces = line.slice(open + 1, close).split(';').map(x => x.trim()).filter(Boolean);
    // map each declared piece to the fields it produced, in source order
    const pieceOf: number[] = [];
    let fieldIdx = 0;
    for (let pi = 0; pi < pieces.length && fieldIdx < struct.fields.length; pi++) {
      const names = pieces[pi].split(/\s+/)[0].split(',').length;
      for (let n = 0; n < names && fieldIdx < struct.fields.length; n++) {
        pieceOf[fieldIdx++] = pi;
      }
    }
    const indices = optimization.reorderedIndices.length === struct.fields.length
      ? optimization.reorderedIndices
      : this.indicesFromNames(struct, optimization.reorderedFields);
    const seenPiece = new Set<number>();
    const ordered: string[] = [];
    for (const idx of indices) {
      const pi = pieceOf[idx];
      if (pi !== undefined && !seenPiece.has(pi)) {
        seenPiece.add(pi);
        ordered.push(pieces[pi]);
      }
    }
    for (let pi = 0; pi < pieces.length; pi++) {
      if (!seenPiece.has(pi)) {
        ordered.push(pieces[pi]);
      }
    }
    const rebuilt = line.slice(0, open + 1) + ' ' + ordered.join('; ') + ' ' + line.slice(close);
    return [...lines.slice(0, struct.lineNumber), rebuilt, ...lines.slice(struct.lineNumber + 1)].join('\n');
  }

  // fallback for callers that built an OptimizationResult by hand
  private indicesFromNames(struct: StructInfo, names: string[]): number[] {
    const used = new Set<number>();
    const out: number[] = [];
    for (const name of names) {
      const idx = struct.fields.findIndex((f, i) => f.name === name && !used.has(i));
      if (idx >= 0) {
        used.add(idx);
        out.push(idx);
      }
    }
    return out;
  }

  shouldOptimize(struct: StructInfo, minSavings: number = 8): boolean {
    if (struct.fields.length <= 1) {
      return false;
    }

    const optimization = this.optimizeStruct(struct);
    return optimization.bytesSaved >= minSavings;
  }
}
