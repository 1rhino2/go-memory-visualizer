import { Architecture } from './types';

/** Type size and alignment information */
interface TypeSizeInfo {
  size: number;
  alignment: number;
}

/** Struct definition with name and field list */
interface StructDefinition {
  name: string;
  fields: Array<{ name: string; typeName: string }>;
}

/**
 * Calculates memory layout for Go structs based on architecture
 * Supports amd64, arm64, and 386 architectures
 */
// Built-in Go interface types that ship with the language. We pre-register
// these so users do not need a stdlib parse for accurate sizing.
const BUILTIN_INTERFACES: ReadonlyArray<string> = ['error'];

export class MemoryCalculator {
  private arch: Architecture;
  private structRegistry: Map<string, StructDefinition> = new Map();
  private typeAliasRegistry: Map<string, string> = new Map();
  private interfaceRegistry: Set<string> = new Set(BUILTIN_INTERFACES);

  constructor(architecture: Architecture = 'amd64') {
    this.arch = architecture;
  }

  setArchitecture(arch: Architecture): void {
    this.arch = arch;
  }

  getArchitecture(): Architecture {
    return this.arch;
  }

  registerStruct(name: string, fields: Array<{ name: string; typeName: string }>): void {
    this.structRegistry.set(name, { name, fields });
  }

  registerTypeAlias(name: string, typeName: string): void {
    this.typeAliasRegistry.set(name, typeName);
  }

  registerInterface(name: string): void {
    this.interfaceRegistry.add(name);
  }

  clearStructRegistry(): void {
    this.structRegistry.clear();
    this.typeAliasRegistry.clear();
    this.interfaceRegistry = new Set(BUILTIN_INTERFACES);
  }

  /**
   * Get type size info with recursion protection
   * VULN-018: Prevent unbounded recursion with seen set
   * @param typeName The type name to look up
   * @param seen Set of already-seen type names (for recursion detection)
   */
  getTypeInfo(typeName: string, seen: Set<string> = new Set()): TypeSizeInfo {
    const ptrSize = this.getPointerSize();
    
    // VULN-018: Detect circular struct references
    if (seen.has(typeName)) {
      // Return pointer size for circular references
      return { size: ptrSize, alignment: ptrSize };
    }

    const aliasTarget = this.typeAliasRegistry.get(typeName);
    if (aliasTarget) {
      seen.add(typeName);
      return this.getTypeInfo(aliasTarget, seen);
    }
    
    // Basic Go types with their sizes
    switch (typeName) {
      case 'bool':
      case 'int8':
      case 'uint8':
      case 'byte':
        return { size: 1, alignment: 1 };
      
      case 'int16':
      case 'uint16':
        return { size: 2, alignment: 2 };
      
      case 'int32':
      case 'uint32':
      case 'float32':
      case 'rune':
        return { size: 4, alignment: 4 };
      
      case 'int64':
      case 'uint64':
      case 'float64':
        return { size: 8, alignment: 8 };

      case 'complex64':
        return { size: 8, alignment: 4 };
      
      case 'complex128':
        return { size: 16, alignment: 8 };
      
      case 'int':
      case 'uint':
      case 'uintptr':
        return { size: ptrSize, alignment: ptrSize };
      
      case 'string':
        return { size: ptrSize * 2, alignment: ptrSize };
      
      default:
        // Handle pointers, slices, maps, channels, interfaces
        if (typeName.startsWith('*') || typeName === 'unsafe.Pointer') {
          return { size: ptrSize, alignment: ptrSize };
        }
        if (typeName.startsWith('[]')) {
          return { size: ptrSize * 3, alignment: ptrSize };
        }
        if (typeName.startsWith('[') && typeName.includes(']')) {
          // Array type [N]T
          const match = typeName.match(/\[(\d+)\](.+)/);
          if (match) {
            const count = parseInt(match[1], 10);
            const elemType = match[2];
            const elemInfo = this.getTypeInfo(elemType, seen);
            // VULN-014: Prevent integer overflow
            const maxSafeSize = Number.MAX_SAFE_INTEGER / 8;
            if (count > maxSafeSize || count * elemInfo.size > Number.MAX_SAFE_INTEGER) {
              return { size: Number.MAX_SAFE_INTEGER, alignment: elemInfo.alignment };
            }
            return {
              size: count * elemInfo.size,
              alignment: elemInfo.alignment
            };
          }
        }
        if (
          typeName.startsWith('map[') ||
          typeName.startsWith('chan ') ||
          typeName.startsWith('chan<- ') ||
          typeName.startsWith('<-chan ') ||
          typeName.startsWith('func(')
        ) {
          return { size: ptrSize, alignment: ptrSize };
        }
        if (typeName === 'interface{}' || typeName === 'any') {
          return { size: ptrSize * 2, alignment: ptrSize };
        }
        // Named interfaces (e.g. error, io.Reader, custom interfaces) are
        // 2-word values: type pointer + data pointer.
        if (this.interfaceRegistry.has(typeName)) {
          return { size: ptrSize * 2, alignment: ptrSize };
        }

        {
          // Check if it's a registered custom struct
          const structDef = this.structRegistry.get(typeName);
          if (structDef) {
            // VULN-018: Track seen types to prevent infinite recursion
            seen.add(typeName);
            const layout = this.calculateStructSize(structDef.fields, seen);
            return { size: layout.size, alignment: layout.alignment };
          }
        }

        // Default for unknown types (treat as pointer-sized). External
        // qualified types like `time.Time` or `io.Reader` are intentionally
        // not guessed here, since `pkg.Type` could be a struct or an
        // interface. Users can call `registerInterface` for known cases.
        return { size: ptrSize, alignment: ptrSize };
    }
  }

  private getPointerSize(): number {
    switch (this.arch) {
      case 'amd64':
      case 'arm64':
        return 8;
      case '386':
        return 4;
      default:
        return 8;
    }
  }

  alignOffset(offset: number, alignment: number): number {
    const remainder = offset % alignment;
    if (remainder === 0) {
      return offset;
    }
    return offset + (alignment - remainder);
  }

  /**
   * Calculate struct size with recursion tracking
   * VULN-018: Accept seen parameter for circular reference detection
   */
  calculateStructSize(fields: Array<{ typeName: string }>, seen: Set<string> = new Set()): { size: number; alignment: number; fieldOffsets: number[]; paddings: number[] } {
    if (fields.length === 0) {
      return { size: 0, alignment: 1, fieldOffsets: [], paddings: [] };
    }

    let currentOffset = 0;
    let maxAlignment = 1;
    const fieldOffsets: number[] = [];
    const paddings: number[] = [];

    for (const field of fields) {
      const typeInfo = this.getTypeInfo(field.typeName, new Set(seen));
      maxAlignment = Math.max(maxAlignment, typeInfo.alignment);
      
      // Align the field
      const alignedOffset = this.alignOffset(currentOffset, typeInfo.alignment);
      const paddingBefore = alignedOffset - currentOffset;
      
      fieldOffsets.push(alignedOffset);
      currentOffset = alignedOffset + typeInfo.size;
      paddings.push(paddingBefore);
    }

    // Align the total struct size to its alignment
    const totalSize = this.alignOffset(currentOffset, maxAlignment);
    const finalPadding = totalSize - currentOffset;

    return {
      size: totalSize,
      alignment: maxAlignment,
      fieldOffsets,
      paddings: [...paddings, finalPadding]
    };
  }
}
