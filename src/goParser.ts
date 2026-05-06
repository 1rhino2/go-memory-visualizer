import { StructInfo, FieldInfo, Architecture, CacheLineInfo, CACHE_LINE_SIZE } from './types';
import { MemoryCalculator } from './memoryCalculator';

/**
 * Parser for Go struct definitions
 * Extracts struct fields and calculates memory layout
 */
export class GoParser {
  private calculator: MemoryCalculator;

  constructor(architecture: Architecture = 'amd64') {
    this.calculator = new MemoryCalculator(architecture);
  }

  /**
   * Returns the memory calculator instance for use by optimizer
   * VULN-003: Public getter instead of private member access
   */
  getCalculator(): MemoryCalculator {
    return this.calculator;
  }

  /** Update the target architecture for size calculations */
  setArchitecture(arch: Architecture): void {
    this.calculator.setArchitecture(arch);
  }

  private registerStructDefinitions(content: string): void {
    const lines = content.split('\n');
    const structStartRegex = /^\s*type\s+(\w+)\s+struct\s*\{/;
    const interfaceStartRegex = /^\s*type\s+(\w+)\s+interface\s*\{/;
    const typeAliasRegex = /^\s*(\w+)\s+(?:=\s*)?(.+)$/;

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const structMatch = line.match(structStartRegex);
      const interfaceMatch = line.match(interfaceStartRegex);

      if (line.trim() === 'type (') {
        i++;
        while (i < lines.length && lines[i].trim() !== ')') {
          const cleanTypeLine = lines[i].split('//')[0].trim();
          // Inline interface or struct inside a type block.
          const blockInterface = cleanTypeLine.match(/^(\w+)\s+interface\s*\{/);
          if (blockInterface) {
            this.calculator.registerInterface(blockInterface[1]);
            i = this.skipBlock(lines, i);
            continue;
          }
          const blockStruct = cleanTypeLine.match(/^(\w+)\s+struct\s*\{/);
          if (blockStruct) {
            i = this.skipBlock(lines, i);
            continue;
          }
          const aliasMatch = cleanTypeLine.match(typeAliasRegex);
          if (aliasMatch && !aliasMatch[2].startsWith('struct') && !aliasMatch[2].includes('{')) {
            this.calculator.registerTypeAlias(aliasMatch[1], aliasMatch[2].trim());
          }
          i++;
        }
      } else if (interfaceMatch) {
        this.calculator.registerInterface(interfaceMatch[1]);
        i = this.skipBlock(lines, i);
        continue;
      } else if (structMatch) {
        const structName = structMatch[1];
        const fields: Array<{ name: string; typeName: string }> = [];
        const result = this.collectFieldsFromBlock(lines, i + 1, structName, false);
        for (const f of result.fields) {
          fields.push({ name: f.name, typeName: f.typeName });
        }
        this.calculator.registerStruct(structName, fields);
        i = result.endIndex;
      } else {
        const cleanTypeLine = line.split('//')[0].trim();
        const aliasMatch = cleanTypeLine.match(/^type\s+(\w+)\s+(?:=\s*)?(.+)$/);
        if (aliasMatch && !aliasMatch[2].startsWith('struct') && !aliasMatch[2].includes('{')) {
          this.calculator.registerTypeAlias(aliasMatch[1], aliasMatch[2].trim());
        }
      }

      i++;
    }
  }

  // Skip from a `{` opener line to its matching `}`. Returns the index of the
  // closing line. Handles nested braces inside the block.
  private skipBlock(lines: string[], startIndex: number): number {
    let depth = 0;
    let i = startIndex;
    let opened = false;
    while (i < lines.length) {
      const stripped = lines[i].split('//')[0];
      for (const ch of stripped) {
        if (ch === '{') {
          depth++;
          opened = true;
        } else if (ch === '}') {
          depth--;
          if (opened && depth === 0) {
            return i;
          }
        }
      }
      i++;
    }
    return i;
  }

  // Walks struct field lines starting at startIndex (the line right after the
  // opening `{`), returning all field info and the index of the closing `}`.
  // Supports anonymous inline struct fields by counting braces and registering
  // each as a synthetic struct in the calculator.
  private collectFieldsFromBlock(
    lines: string[],
    startIndex: number,
    parentName: string,
    withLineNumbers: true
  ): { fields: Array<{ name: string; typeName: string; lineNumber: number }>; endIndex: number };
  private collectFieldsFromBlock(
    lines: string[],
    startIndex: number,
    parentName: string,
    withLineNumbers: false
  ): { fields: Array<{ name: string; typeName: string }>; endIndex: number };
  private collectFieldsFromBlock(
    lines: string[],
    startIndex: number,
    parentName: string,
    withLineNumbers: boolean
  ): { fields: Array<{ name: string; typeName: string; lineNumber?: number }>; endIndex: number } {
    const fields: Array<{ name: string; typeName: string; lineNumber?: number }> = [];
    let i = startIndex;
    let anonCounter = 0;

    while (i < lines.length) {
      const fieldLine = lines[i].trim();

      if (fieldLine.startsWith('}')) {
        return { fields, endIndex: i };
      }

      if (!fieldLine || fieldLine.startsWith('//')) {
        i++;
        continue;
      }

      const cleanFieldLine = fieldLine.split('//')[0].split('`')[0].trim();
      if (!cleanFieldLine) { i++; continue; }

      // Anonymous inline struct field: `Name struct { ... }` possibly multi-line.
      const anonStructMatch = cleanFieldLine.match(/^(\w+(?:\s*,\s*\w+)*)\s+struct\s*\{/);
      if (anonStructMatch) {
        const names = anonStructMatch[1].split(',').map(n => n.trim());
        const startLine = i;
        const innerStart = i + 1;
        const innerResult = this.collectFieldsFromBlock(lines, innerStart, `${parentName}__anon${anonCounter}`, false);
        const synthName = `__anon_${parentName}_${anonCounter++}`;
        this.calculator.registerStruct(synthName, innerResult.fields);

        for (const name of names) {
          if (withLineNumbers) {
            fields.push({ name, typeName: synthName, lineNumber: startLine });
          } else {
            fields.push({ name, typeName: synthName });
          }
        }
        i = innerResult.endIndex + 1;
        continue;
      }

      const fieldMatch = cleanFieldLine.match(/^(\w+(?:\s*,\s*\w+)*)\s+(.+)$/);
      const embeddedMatch = cleanFieldLine.match(/^(\*?\w+)$/);

      if (fieldMatch) {
        const names = fieldMatch[1].split(',').map(n => n.trim());
        const typeName = fieldMatch[2].trim();
        for (const name of names) {
          if (withLineNumbers) {
            fields.push({ name, typeName, lineNumber: i });
          } else {
            fields.push({ name, typeName });
          }
        }
      } else if (embeddedMatch) {
        const typeName = embeddedMatch[1].trim();
        const fieldName = typeName.startsWith('*') ? typeName.substring(1) : typeName;
        if (withLineNumbers) {
          fields.push({ name: fieldName, typeName, lineNumber: i });
        } else {
          fields.push({ name: fieldName, typeName });
        }
      }

      i++;
    }

    return { fields, endIndex: i };
  }

  parseStructs(content: string): StructInfo[] {
    const structs: StructInfo[] = [];
    const lines = content.split('\n');

    // Clear registries before parsing so re-runs do not leak state.
    this.calculator.clearStructRegistry();

    // First pass: register all struct, interface, and alias definitions.
    this.registerStructDefinitions(content);

    const structStartRegex = /^\s*type\s+(\w+)\s+struct\s*\{/;
    const interfaceStartRegex = /^\s*type\s+(\w+)\s+interface\s*\{/;

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const match = line.match(structStartRegex);

      if (interfaceStartRegex.test(line)) {
        i = this.skipBlock(lines, i) + 1;
        continue;
      }

      if (match) {
        const structName = match[1];
        const startLine = i;
        const result = this.collectFieldsFromBlock(lines, i + 1, structName, true);
        const structInfo = this.calculateStructLayout(structName, result.fields, startLine, result.endIndex);
        structs.push(structInfo);
        i = result.endIndex + 1;
        continue;
      }

      i++;
    }

    return structs;
  }

  private calculateStructLayout(
    name: string,
    fields: Array<{ name: string; typeName: string; lineNumber: number }>,
    startLine: number,
    endLine: number
  ): StructInfo {
    if (fields.length === 0) {
      return {
        name,
        fields: [],
        totalSize: 0,
        totalPadding: 0,
        lineNumber: startLine,
        endLineNumber: endLine,
        alignment: 1,
        cacheLines: [],
        cacheLinesCrossed: 0,
        hotFields: []
      };
    }

    const layout = this.calculator.calculateStructSize(
      fields.map(f => ({ typeName: f.typeName }))
    );

    const hotFields: string[] = [];

    const fieldInfos: FieldInfo[] = fields.map((field, idx) => {
      const typeInfo = this.calculator.getTypeInfo(field.typeName);
      const offset = layout.fieldOffsets[idx];
      const paddingAfter = idx < fields.length - 1 
        ? layout.fieldOffsets[idx + 1] - (offset + typeInfo.size)
        : layout.paddings[fields.length]; // Final padding

      // Calculate cache line info for this field
      const cacheLineStart = Math.floor(offset / CACHE_LINE_SIZE);
      const cacheLineEnd = Math.floor((offset + typeInfo.size - 1) / CACHE_LINE_SIZE);
      const crossesCacheLine = cacheLineStart !== cacheLineEnd;

      if (crossesCacheLine) {
        hotFields.push(field.name);
      }

      return {
        name: field.name,
        typeName: field.typeName,
        offset,
        size: typeInfo.size,
        alignment: typeInfo.alignment,
        lineNumber: field.lineNumber,
        paddingAfter,
        cacheLineStart,
        cacheLineEnd,
        crossesCacheLine
      };
    });

    const totalPadding = layout.paddings.reduce((sum, p) => sum + p, 0);

    // Calculate cache line breakdown
    const cacheLines = this.calculateCacheLines(fieldInfos, layout.size);
    const cacheLinesCrossed = Math.ceil(layout.size / CACHE_LINE_SIZE);

    return {
      name,
      fields: fieldInfos,
      totalSize: layout.size,
      totalPadding,
      lineNumber: startLine,
      endLineNumber: endLine,
      alignment: layout.alignment,
      cacheLines,
      cacheLinesCrossed,
      hotFields
    };
  }

  private calculateCacheLines(fields: FieldInfo[], totalSize: number): CacheLineInfo[] {
    const numLines = Math.ceil(totalSize / CACHE_LINE_SIZE);
    const cacheLines: CacheLineInfo[] = [];

    for (let lineNum = 0; lineNum < numLines; lineNum++) {
      const startOffset = lineNum * CACHE_LINE_SIZE;
      const endOffset = Math.min(startOffset + CACHE_LINE_SIZE - 1, totalSize - 1);
      
      const fieldsInLine: string[] = [];
      let bytesUsed = 0;

      for (const field of fields) {
        const fieldEnd = field.offset + field.size - 1;
        // Check if field overlaps with this cache line
        if (field.offset <= endOffset && fieldEnd >= startOffset) {
          fieldsInLine.push(field.name);
          // Calculate bytes of this field in this cache line
          const overlapStart = Math.max(field.offset, startOffset);
          const overlapEnd = Math.min(fieldEnd, endOffset);
          bytesUsed += overlapEnd - overlapStart + 1;
        }
      }

      const lineSize = endOffset - startOffset + 1;
      const bytesPadding = lineSize - bytesUsed;

      cacheLines.push({
        lineNumber: lineNum,
        startOffset,
        endOffset,
        fields: fieldsInLine,
        bytesUsed,
        bytesPadding
      });
    }

    return cacheLines;
  }
}
