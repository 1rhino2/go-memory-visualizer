import { Architecture, StructInfo } from './types';
import { GoParser } from './goParser';

export interface ArchLayout {
  architecture: Architecture;
  totalSize: number;
  totalPadding: number;
  alignment: number;
  fields: Array<{ name: string; typeName: string; offset: number; size: number; paddingAfter: number }>;
}

export interface ArchComparison {
  structName: string;
  layouts: ArchLayout[];
}

const ALL_ARCHS: ReadonlyArray<Architecture> = ['amd64', 'arm64', '386'];

// Re-parses the same source under each supported architecture and returns
// a per-architecture layout for the named struct. Pure logic so it can be
// unit tested without vscode.
export function compareStructAcrossArchs(
  source: string,
  structName: string,
  archs: ReadonlyArray<Architecture> = ALL_ARCHS
): ArchComparison | undefined {
  const layouts: ArchLayout[] = [];

  for (const arch of archs) {
    const parser = new GoParser(arch);
    const structs = parser.parseStructs(source);
    const target = structs.find(s => s.name === structName);
    if (!target) {
      return undefined;
    }
    layouts.push(toArchLayout(target, arch));
  }

  return { structName, layouts };
}

function toArchLayout(struct: StructInfo, arch: Architecture): ArchLayout {
  return {
    architecture: arch,
    totalSize: struct.totalSize,
    totalPadding: struct.totalPadding,
    alignment: struct.alignment,
    fields: struct.fields.map(f => ({
      name: f.name,
      typeName: f.typeName,
      offset: f.offset,
      size: f.size,
      paddingAfter: f.paddingAfter
    }))
  };
}
