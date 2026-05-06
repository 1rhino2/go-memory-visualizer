import test from 'node:test';
import { strict as assert } from 'assert';
import { MemoryCalculator } from '../memoryCalculator';

test('uses Go-compatible sizes for slices and complex64', () => {
  const amd64 = new MemoryCalculator('amd64');
  assert.deepEqual(amd64.getTypeInfo('[]byte'), { size: 24, alignment: 8 });
  assert.deepEqual(amd64.getTypeInfo('complex64'), { size: 8, alignment: 4 });

  const x86 = new MemoryCalculator('386');
  assert.deepEqual(x86.getTypeInfo('[]byte'), { size: 12, alignment: 4 });
});

test('resolves same-file type aliases before calculating layout', () => {
  const calculator = new MemoryCalculator('amd64');
  calculator.registerTypeAlias('Flag', 'bool');
  calculator.registerTypeAlias('UserID', 'uint64');

  assert.deepEqual(calculator.getTypeInfo('Flag'), { size: 1, alignment: 1 });
  assert.deepEqual(calculator.getTypeInfo('UserID'), { size: 8, alignment: 8 });

  const layout = calculator.calculateStructSize([
    { typeName: 'Flag' },
    { typeName: 'UserID' }
  ]);

  assert.equal(layout.size, 16);
  assert.deepEqual(layout.fieldOffsets, [0, 8]);
  assert.deepEqual(layout.paddings, [0, 7, 0]);
});

test('treats unsafe.Pointer as pointer-sized', () => {
  const calculator = new MemoryCalculator('amd64');
  assert.deepEqual(calculator.getTypeInfo('unsafe.Pointer'), { size: 8, alignment: 8 });
});
