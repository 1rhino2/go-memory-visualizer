import { StructInfo, OptimizationResult } from './types';
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
        optimizedPadding: 0
      };
    }

    const originalSize = struct.totalSize;
    
    // sort by alignment first (biggest first), then size - this minimizes padding
    const sortedFields = [...struct.fields].sort((a, b) => {
      if (a.alignment !== b.alignment) {
        return b.alignment - a.alignment;
      }
      return b.size - a.size;
    });

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
      optimizedPadding
    };
  }

  generateOptimizedCode(
    originalCode: string,
    struct: StructInfo,
    optimization: OptimizationResult
  ): string {
    const lines = originalCode.split('\n');
    const structLines: string[] = [];
    
    // Extract the original struct lines
    for (let i = struct.lineNumber; i <= struct.endLineNumber; i++) {
      structLines.push(lines[i]);
    }

    // Find the struct declaration line
    const structDeclLine = structLines[0];
    
    // Build the optimized struct
    const newLines: string[] = [structDeclLine];
    
    const emittedFieldLines = new Set<number>();

    // Add fields in optimized order
    for (const fieldName of optimization.reorderedFields) {
      const field = struct.fields.find(f => f.name === fieldName);
      if (field && !emittedFieldLines.has(field.lineNumber)) {
        // Find the original field line
        const originalFieldLine = lines[field.lineNumber];
        newLines.push(originalFieldLine);
        emittedFieldLines.add(field.lineNumber);
      }
    }
    
    // Add closing brace
    newLines.push(structLines[structLines.length - 1]);
    
    // Replace the struct in the original code
    const before = lines.slice(0, struct.lineNumber);
    const after = lines.slice(struct.endLineNumber + 1);
    
    return [...before, ...newLines, ...after].join('\n');
  }

  shouldOptimize(struct: StructInfo, minSavings: number = 8): boolean {
    if (struct.fields.length <= 1) {
      return false;
    }

    const optimization = this.optimizeStruct(struct);
    return optimization.bytesSaved >= minSavings;
  }
}
