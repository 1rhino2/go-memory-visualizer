export type Architecture = 'amd64' | 'arm64' | '386';

export interface FieldInfo {
  name: string;
  typeName: string;
  offset: number;
  size: number;
  alignment: number;
  lineNumber: number;
  paddingAfter: number;
}

export interface StructInfo {
  name: string;
  fields: FieldInfo[];
  totalSize: number;
  totalPadding: number;
  lineNumber: number;
  endLineNumber: number;
  alignment: number;
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
