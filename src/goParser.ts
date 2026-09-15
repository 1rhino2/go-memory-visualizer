import { StructInfo, FieldInfo, Architecture, CacheLineInfo, CACHE_LINE_SIZE } from './types';
import { MemoryCalculator } from './memoryCalculator';
import { computePackScore } from './memoryMap';
import { MAX_STRUCT_FIELDS } from './security';

// `type Name struct {` / `type Name[T any] struct {`. Generic params are
// sized like any other unknown type (pointer width) but the struct still
// shows up instead of being skipped.
const STRUCT_START_RE = /^\s*type\s+(\w+)(?:\[[^\]]*\])?\s+struct\s*\{/;
const INTERFACE_START_RE = /^\s*type\s+(\w+)(?:\[[^\]]*\])?\s+interface\s*\{/;
// same two inside a `type ( ... )` group, no leading keyword
const BLOCK_STRUCT_RE = /^(\w+)(?:\[[^\]]*\])?\s+struct\s*\{/;
const BLOCK_INTERFACE_RE = /^(\w+)(?:\[[^\]]*\])?\s+interface\s*\{/;
const TYPE_ALIAS_RE = /^(\w+)\s+(?:=\s*)?(.+)$/;
// `const N = 16` / `const N int = 16`, and the same shape inside `const (`.
// Only plain integer literals; anything with iota or arithmetic is skipped.
const CONST_LINE_RE = /^\s*const\s+(\w+)\s*(?:\w+\s*)?=\s*(\d+)\s*$/;
const CONST_ENTRY_RE = /^(\w+)\s*(?:\w+\s*)?=\s*(\d+)$/;

interface ParsedField {
  name: string;
  typeName: string;
  lineNumber?: number;
  // last source line of the field, differs from lineNumber only for
  // multi-line anonymous struct fields
  endLineNumber?: number;
}

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

  private registerStructDefinitions(lines: string[]): void {
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const structMatch = line.match(STRUCT_START_RE);
      const interfaceMatch = line.match(INTERFACE_START_RE);

      const constMatch = line.split('//')[0].match(CONST_LINE_RE);
      if (constMatch) {
        this.calculator.registerConst(constMatch[1], parseInt(constMatch[2], 10));
      } else if (line.trim() === 'const (') {
        i++;
        while (i < lines.length && lines[i].trim() !== ')') {
          const m = lines[i].split('//')[0].trim().match(CONST_ENTRY_RE);
          if (m) {
            this.calculator.registerConst(m[1], parseInt(m[2], 10));
          }
          i++;
        }
      }

      if (line.trim() === 'type (') {
        i++;
        while (i < lines.length && lines[i].trim() !== ')') {
          const cleanTypeLine = lines[i].split('//')[0].trim();
          // Inline interface or struct inside a type block.
          const blockInterface = cleanTypeLine.match(BLOCK_INTERFACE_RE);
          if (blockInterface) {
            this.calculator.registerInterface(blockInterface[1]);
            i = this.skipBlock(lines, i) + 1;
            continue;
          }
          const blockStruct = cleanTypeLine.match(BLOCK_STRUCT_RE);
          if (blockStruct) {
            // structs in a type group used to be skipped, so anything
            // referencing them sized as a bare pointer
            const result = this.collectStructFields(lines, i, blockStruct[1], false);
            this.calculator.registerStruct(blockStruct[1], result.fields);
            i = result.endIndex + 1;
            continue;
          }
          const aliasMatch = cleanTypeLine.match(TYPE_ALIAS_RE);
          if (aliasMatch && !aliasMatch[2].startsWith('struct') && !aliasMatch[2].includes('{')) {
            this.calculator.registerTypeAlias(aliasMatch[1], aliasMatch[2].trim());
          }
          i++;
        }
      } else if (interfaceMatch) {
        this.calculator.registerInterface(interfaceMatch[1]);
        i = this.skipBlock(lines, i);
      } else if (structMatch) {
        const structName = structMatch[1];
        const result = this.collectStructFields(lines, i, structName, false);
        this.calculator.registerStruct(structName, result.fields);
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

  // Entry point for a struct whose opener is on `openIndex`. One-line
  // declarations like `type P struct{ X, Y int }` or `type E struct{}` carry
  // the whole body on the opener, so split that on `;` instead of walking
  // the following lines (which used to swallow the next declaration).
  private collectStructFields(
    lines: string[],
    openIndex: number,
    parentName: string,
    withLineNumbers: boolean
  ): { fields: ParsedField[]; endIndex: number } {
    const opener = lines[openIndex].split('//')[0];
    const bracePos = opener.indexOf('{');
    const inline = this.inlineBody(opener.slice(bracePos));
    if (inline !== undefined) {
      const virtual = inline.split(';');
      const fields: ParsedField[] = [];
      let anonCounter = 0;
      for (const piece of virtual) {
        const parsed = this.parseFieldLine(piece.trim(), parentName, () => anonCounter++, openIndex, openIndex);
        for (const f of parsed) {
          if (fields.length >= MAX_STRUCT_FIELDS) { break; }
          fields.push(withLineNumbers ? f : { name: f.name, typeName: f.typeName });
        }
      }
      return { fields, endIndex: openIndex };
    }
    return this.collectFieldsFromBlock(lines, openIndex + 1, parentName, withLineNumbers);
  }

  // If `text` (starting at its `{`) closes on the same line, return the body
  // between the braces. Undefined when the block continues on later lines.
  private inlineBody(text: string): string | undefined {
    let depth = 0;
    for (let k = 0; k < text.length; k++) {
      const ch = text[k];
      if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          return text.slice(1, k);
        }
      }
    }
    return undefined;
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
    withLineNumbers: boolean
  ): { fields: ParsedField[]; endIndex: number } {
    const fields: ParsedField[] = [];
    let i = startIndex;
    let anonCounter = 0;
    const nextAnon = () => anonCounter++;

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

      // Anonymous inline struct field spanning several lines:
      // `Name struct {` ... `}`. One-line bodies go through parseFieldLine.
      const anonStructMatch = cleanFieldLine.match(/^(\w+(?:\s*,\s*\w+)*)\s+struct\s*\{/);
      if (anonStructMatch && this.inlineBody(cleanFieldLine.slice(cleanFieldLine.indexOf('{'))) === undefined) {
        const names = anonStructMatch[1].split(',').map(n => n.trim());
        const startLine = i;
        const innerResult = this.collectFieldsFromBlock(lines, i + 1, `${parentName}__anon${anonCounter}`, false);
        const synthName = `__anon_${parentName}_${nextAnon()}`;
        this.calculator.registerStruct(synthName, innerResult.fields);

        for (const name of names) {
          if (fields.length >= MAX_STRUCT_FIELDS) {
            break;
          }
          fields.push(withLineNumbers
            ? { name, typeName: synthName, lineNumber: startLine, endLineNumber: innerResult.endIndex }
            : { name, typeName: synthName });
        }
        i = innerResult.endIndex + 1;
        continue;
      }

      for (const f of this.parseFieldLine(cleanFieldLine, parentName, nextAnon, i, i)) {
        // past the cap we still walk to the closing brace so endIndex is
        // right, we just stop recording fields
        if (fields.length >= MAX_STRUCT_FIELDS) {
          break;
        }
        fields.push(withLineNumbers ? f : { name: f.name, typeName: f.typeName });
      }

      i++;
    }

    return { fields, endIndex: i };
  }

  // Parses one field declaration (already stripped of comments and tags).
  // Returns zero or more fields since `A, B int` declares two.
  private parseFieldLine(
    text: string,
    parentName: string,
    nextAnon: () => number,
    lineNumber: number,
    endLineNumber: number
  ): ParsedField[] {
    if (!text) {
      return [];
    }

    // `Name struct{ X int }` or `_ struct{}` on one line
    const anonInline = text.match(/^(\w+(?:\s*,\s*\w+)*)\s+struct\s*\{/);
    if (anonInline) {
      const body = this.inlineBody(text.slice(text.indexOf('{')));
      if (body !== undefined) {
        const names = anonInline[1].split(',').map(n => n.trim());
        const idx = nextAnon();
        const inner: ParsedField[] = [];
        for (const piece of body.split(';')) {
          for (const f of this.parseFieldLine(piece.trim(), `${parentName}__anon${idx}`, () => 0, lineNumber, endLineNumber)) {
            inner.push({ name: f.name, typeName: f.typeName });
          }
        }
        const synthName = `__anon_${parentName}_${idx}`;
        this.calculator.registerStruct(synthName, inner);
        return names.map(name => ({ name, typeName: synthName, lineNumber, endLineNumber }));
      }
    }

    const fieldMatch = text.match(/^(\w+(?:\s*,\s*\w+)*)\s+(.+)$/);
    if (fieldMatch) {
      const names = fieldMatch[1].split(',').map(n => n.trim());
      // strip trailing junk / tags leftovers; keep type text bounded
      let typeName = fieldMatch[2].trim();
      if (typeName.length > 512) {
        typeName = typeName.slice(0, 512);
      }
      return names.map(name => ({ name, typeName, lineNumber, endLineNumber }));
    }

    // Embedded field: `Base`, `*Base`, `pkg.Type`, `*pkg.Type`, `Base[T]`.
    // The implicit field name is the last identifier before any type args.
    const embeddedMatch = text.match(/^(\*?)((?:\w+\.)?(\w+))(\[[^\]]*\])?$/);
    if (embeddedMatch) {
      const typeName = embeddedMatch[1] + embeddedMatch[2] + (embeddedMatch[4] || '');
      return [{ name: embeddedMatch[3], typeName, lineNumber, endLineNumber }];
    }

    return [];
  }

  parseStructs(content: string): StructInfo[] {
    const structs: StructInfo[] = [];
    const lines = stripBlockComments(content).split('\n');

    // Clear registries before parsing so re-runs do not leak state.
    this.calculator.clearStructRegistry();

    // First pass: register all struct, interface, and alias definitions.
    this.registerStructDefinitions(lines);

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      if (INTERFACE_START_RE.test(line)) {
        i = this.skipBlock(lines, i) + 1;
        continue;
      }

      if (line.trim() === 'type (') {
        i++;
        while (i < lines.length && lines[i].trim() !== ')') {
          const clean = lines[i].split('//')[0].trim();
          if (BLOCK_INTERFACE_RE.test(clean)) {
            i = this.skipBlock(lines, i) + 1;
            continue;
          }
          const blockStruct = clean.match(BLOCK_STRUCT_RE);
          if (blockStruct) {
            structs.push(this.parseStructAt(lines, i, blockStruct[1]));
            i = structs[structs.length - 1].endLineNumber + 1;
            continue;
          }
          i++;
        }
        i++;
        continue;
      }

      const match = line.match(STRUCT_START_RE);
      if (match) {
        structs.push(this.parseStructAt(lines, i, match[1]));
        i = structs[structs.length - 1].endLineNumber + 1;
        continue;
      }

      i++;
    }

    return structs;
  }

  private parseStructAt(lines: string[], openIndex: number, name: string): StructInfo {
    const result = this.collectStructFields(lines, openIndex, name, true);
    const fields = result.fields.map(f => ({
      name: f.name,
      typeName: f.typeName,
      lineNumber: f.lineNumber ?? openIndex,
      endLineNumber: f.endLineNumber ?? f.lineNumber ?? openIndex
    }));
    return this.calculateStructLayout(name, fields, openIndex, result.endIndex);
  }

  private calculateStructLayout(
    name: string,
    fields: Array<{ name: string; typeName: string; lineNumber: number; endLineNumber: number }>,
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
        hotFields: [],
        packScore: 100
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
      // zero-size fields occupy no bytes, so they cannot straddle a line
      const cacheLineEnd = typeInfo.size > 0
        ? Math.floor((offset + typeInfo.size - 1) / CACHE_LINE_SIZE)
        : cacheLineStart;
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
        endLineNumber: field.endLineNumber,
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
      hotFields,
      packScore: computePackScore(layout.size, totalPadding)
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

// Blank out /* ... */ comments but keep newlines so line numbers still map
// back to the editor. Line comments are handled per line elsewhere.
function stripBlockComments(content: string): string {
  if (!content.includes('/*')) {
    return content;
  }
  return content.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
}
