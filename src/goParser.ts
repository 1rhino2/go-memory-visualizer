import { StructInfo, FieldInfo, Architecture, CacheLineInfo, CACHE_LINE_SIZE } from './types';
import { MemoryCalculator } from './memoryCalculator';

export class GoParser {
  private calculator: MemoryCalculator;

  constructor(architecture: Architecture = 'amd64') {
    this.calculator = new MemoryCalculator(architecture);
  }

  setArchitecture(arch: Architecture): void {
    this.calculator.setArchitecture(arch);
  }

  private registerStructDefinitions(content: string): void {
    const lines = content.split('\n');
    const structStartRegex = /^\s*type\s+(\w+)\s+struct\s*\{/;
    
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const match = line.match(structStartRegex);
      
      if (match) {
        const structName = match[1];
        const fields: Array<{ name: string; typeName: string }> = [];
        
        i++;
        while (i < lines.length) {
          const fieldLine = lines[i].trim();
          
          if (fieldLine.startsWith('}')) {
            break;
          }
          
          if (!fieldLine || fieldLine.startsWith('//')) {
            i++;
            continue;
          }
          
          const fieldMatch = fieldLine.match(/^(\w+(?:\s*,\s*\w+)*)\s+(.+?)(?:\s+`.*`)?(?:\s*\/\/.*)?$/);
          const embeddedMatch = fieldLine.match(/^(\*?\w+)(?:\s+`.*`)?(?:\s*\/\/.*)?$/);
          
          if (fieldMatch) {
            const names = fieldMatch[1].split(',').map(n => n.trim());
            const typeName = fieldMatch[2].trim();
            
            for (const name of names) {
              fields.push({ name, typeName });
            }
          } else if (embeddedMatch && !fieldMatch) {
            const typeName = embeddedMatch[1].trim();
            const fieldName = typeName.startsWith('*') ? typeName.substring(1) : typeName;
            fields.push({ name: fieldName, typeName });
          }
          
          i++;
        }
        
        this.calculator.registerStruct(structName, fields);
      }
      
      i++;
    }
  }

  parseStructs(content: string): StructInfo[] {
    const structs: StructInfo[] = [];
    const lines = content.split('\n');
    
    // Clear the struct registry before parsing
    this.calculator.clearStructRegistry();
    
    // First pass: register all struct definitions
    this.registerStructDefinitions(content);
    
    // match struct declarations like: type MyStruct struct {
    const structStartRegex = /^\s*type\s+(\w+)\s+struct\s*\{/;
    
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const match = line.match(structStartRegex);
      
      if (match) {
        const structName = match[1];
        const startLine = i;
        const fields: Array<{ name: string; typeName: string; lineNumber: number }> = [];
        
        i++;
        // keep going until we find the closing brace
        while (i < lines.length) {
          const fieldLine = lines[i].trim();
          
          // Check for closing brace
          if (fieldLine.startsWith('}')) {
            break;
          }
          
          // Skip empty lines and comments
          if (!fieldLine || fieldLine.startsWith('//')) {
            i++;
            continue;
          }
          
          // Parse field: name type or name, name2 type or just Type (embedded)
          const fieldMatch = fieldLine.match(/^(\w+(?:\s*,\s*\w+)*)\s+(.+?)(?:\s+`.*`)?(?:\s*\/\/.*)?$/);
          const embeddedMatch = fieldLine.match(/^(\*?\w+)(?:\s+`.*`)?(?:\s*\/\/.*)?$/);
          
          if (fieldMatch) {
            const names = fieldMatch[1].split(',').map(n => n.trim());
            const typeName = fieldMatch[2].trim();
            
            for (const name of names) {
              fields.push({ name, typeName, lineNumber: i });
            }
          } else if (embeddedMatch && !fieldMatch) {
            // Embedded field: just the type name, no explicit field name
            const typeName = embeddedMatch[1].trim();
            const fieldName = typeName.startsWith('*') ? typeName.substring(1) : typeName;
            fields.push({ name: fieldName, typeName, lineNumber: i });
          }
          
          i++;
        }
        
        // Calculate memory layout for this struct
        const structInfo = this.calculateStructLayout(structName, fields, startLine, i);
        structs.push(structInfo);
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
