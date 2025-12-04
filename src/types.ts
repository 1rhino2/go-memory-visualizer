export type Architecture = 'amd64' | 'arm64' | '386';

/**
 * Cache line size in bytes (64 bytes on most modern CPUs)
 */
export const CACHE_LINE_SIZE = 64; // bytes - standard CPU cache line

export interface CacheLineInfo {
  lineNumber: number;       // which cache line (0, 1, 2, ...)
  startOffset: number;      // byte offset where this line starts
  endOffset: number;        // byte offset where this line ends
  fields: string[];         // field names in this cache line
  bytesUsed: number;        // actual data bytes (excluding padding)
  bytesPadding: number;     // padding bytes in this line
}

export interface FieldInfo {
  name: string;
  typeName: string;
  offset: number;
  size: number;
  alignment: number;
  lineNumber: number;
  paddingAfter: number;
  cacheLineStart: number;   // which cache line field starts in
  cacheLineEnd: number;     // which cache line field ends in
  crossesCacheLine: boolean; // true if field spans multiple cache lines
}

export interface StructInfo {
  name: string;
  fields: FieldInfo[];
  totalSize: number;
  totalPadding: number;
  lineNumber: number;
  endLineNumber: number;
  alignment: number;
  cacheLines: CacheLineInfo[];      // cache line breakdown
  cacheLinesCrossed: number;        // how many cache lines this struct spans
  hotFields: string[];              // fields that cross cache line boundaries
}

export interface MemoryLayout {
  structs: StructInfo[];
  architecture: Architecture;
}

export interface OptimizationResult {
  originalSize: number;
  optimizedSize: number;
  bytesSaved: number;
  reorderedFields: string[];
}

export interface StructDefinition {
  name: string;
  fields: Array<{ name: string; typeName: string }>;
}

export interface ExportFormat {
  structs: Array<{
    name: string;
    totalSize: number;
    alignment: number;
    totalPadding: number;
    paddingPercentage: number;
    fields: Array<{
      name: string;
      type: string;
      offset: number;
      size: number;
      alignment: number;
      paddingAfter: number;
    }>;
  }>;
  architecture: Architecture;
  exportedAt: string;
}
