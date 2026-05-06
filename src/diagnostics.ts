import { StructInfo } from './types';
import { StructOptimizer } from './optimizer';

export interface StructDiagnostic {
  structName: string;
  line: number;
  endLine: number;
  severity: 'info' | 'hint' | 'warning';
  code: 'padding' | 'optimizable' | 'cache-line-cross';
  message: string;
}

export interface DiagnosticOptions {
  paddingThreshold: number;
  paddingWastePercent: number;
  optimizerMinSavings: number;
  cacheLineWarnings: boolean;
}

export const DEFAULT_DIAGNOSTIC_OPTIONS: DiagnosticOptions = {
  paddingThreshold: 8,
  paddingWastePercent: 20,
  optimizerMinSavings: 8,
  cacheLineWarnings: true
};

// Pure function that turns parsed struct info into a list of diagnostics.
// Lives outside extension.ts so it can be unit tested without vscode.
export function buildStructDiagnostics(
  structs: StructInfo[],
  optimizer: StructOptimizer,
  options: DiagnosticOptions = DEFAULT_DIAGNOSTIC_OPTIONS
): StructDiagnostic[] {
  const diagnostics: StructDiagnostic[] = [];

  for (const struct of structs) {
    if (struct.fields.length === 0) {
      continue;
    }

    const wastePct = struct.totalSize > 0
      ? (struct.totalPadding / struct.totalSize) * 100
      : 0;

    if (struct.totalPadding >= options.paddingThreshold && wastePct >= options.paddingWastePercent) {
      diagnostics.push({
        structName: struct.name,
        line: struct.lineNumber,
        endLine: struct.endLineNumber,
        severity: 'info',
        code: 'padding',
        message: `${struct.name} wastes ${struct.totalPadding} bytes of padding (${wastePct.toFixed(1)}% of ${struct.totalSize} B).`
      });
    }

    const optimization = optimizer.optimizeStruct(struct);
    if (optimization.bytesSaved >= options.optimizerMinSavings) {
      diagnostics.push({
        structName: struct.name,
        line: struct.lineNumber,
        endLine: struct.endLineNumber,
        severity: 'info',
        code: 'optimizable',
        message: `${struct.name} can be reordered to save ${optimization.bytesSaved} B (${struct.totalSize} B -> ${optimization.optimizedSize} B).`
      });
    }

    if (options.cacheLineWarnings && struct.hotFields.length > 0) {
      diagnostics.push({
        structName: struct.name,
        line: struct.lineNumber,
        endLine: struct.endLineNumber,
        severity: 'hint',
        code: 'cache-line-cross',
        message: `${struct.name} has fields that cross cache line boundaries: ${struct.hotFields.join(', ')}.`
      });
    }
  }

  return diagnostics;
}

export interface FileSavingsSummary {
  fileSaveable: number;
  optimizableCount: number;
  totalStructs: number;
}

export function summariseFileSavings(
  structs: StructInfo[],
  optimizer: StructOptimizer,
  minSavings: number = 0
): FileSavingsSummary {
  let fileSaveable = 0;
  let optimizableCount = 0;

  for (const struct of structs) {
    if (struct.fields.length === 0) {
      continue;
    }
    const result = optimizer.optimizeStruct(struct);
    if (result.bytesSaved >= minSavings && result.bytesSaved > 0) {
      fileSaveable += result.bytesSaved;
      optimizableCount++;
    }
  }

  return { fileSaveable, optimizableCount, totalStructs: structs.length };
}
