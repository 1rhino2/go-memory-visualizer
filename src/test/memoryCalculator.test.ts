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

test('error and registered interfaces are 2-word values', () => {
  const calculator = new MemoryCalculator('amd64');
  // built-in error interface
  assert.deepEqual(calculator.getTypeInfo('error'), { size: 16, alignment: 8 });

  calculator.registerInterface('Stringer');
  assert.deepEqual(calculator.getTypeInfo('Stringer'), { size: 16, alignment: 8 });

  // 386 keeps the 2-word semantics with 4-byte words.
  const x86 = new MemoryCalculator('386');
  assert.deepEqual(x86.getTypeInfo('error'), { size: 8, alignment: 4 });
});

test('arm64 matches amd64 for word-sized types', () => {
  const arm = new MemoryCalculator('arm64');
  assert.deepEqual(arm.getTypeInfo('uintptr'), { size: 8, alignment: 8 });
  assert.deepEqual(arm.getTypeInfo('string'), { size: 16, alignment: 8 });
  assert.deepEqual(arm.getTypeInfo('[]int32'), { size: 24, alignment: 8 });
  assert.deepEqual(arm.getTypeInfo('error'), { size: 16, alignment: 8 });
});

test('sizes channels, maps, funcs, and interface{} correctly', () => {
  const calculator = new MemoryCalculator('amd64');
  assert.deepEqual(calculator.getTypeInfo('chan int'), { size: 8, alignment: 8 });
  assert.deepEqual(calculator.getTypeInfo('chan<- int'), { size: 8, alignment: 8 });
  assert.deepEqual(calculator.getTypeInfo('<-chan int'), { size: 8, alignment: 8 });
  assert.deepEqual(calculator.getTypeInfo('map[string]int'), { size: 8, alignment: 8 });
  assert.deepEqual(calculator.getTypeInfo('func(int) error'), { size: 8, alignment: 8 });
  assert.deepEqual(calculator.getTypeInfo('interface{}'), { size: 16, alignment: 8 });
  assert.deepEqual(calculator.getTypeInfo('any'), { size: 16, alignment: 8 });
});

test('resolves nested aliases to the base type', () => {
  const calculator = new MemoryCalculator('amd64');
  calculator.registerTypeAlias('A', 'B');
  calculator.registerTypeAlias('B', 'C');
  calculator.registerTypeAlias('C', 'uint32');
  assert.deepEqual(calculator.getTypeInfo('A'), { size: 4, alignment: 4 });
});

test('arrays compute size from element size and count', () => {
  const calculator = new MemoryCalculator('amd64');
  assert.deepEqual(calculator.getTypeInfo('[16]byte'), { size: 16, alignment: 1 });
  assert.deepEqual(calculator.getTypeInfo('[4]int64'), { size: 32, alignment: 8 });
  assert.deepEqual(calculator.getTypeInfo('[3]complex64'), { size: 24, alignment: 4 });
});

test('caps absurd array sizes without crashing or claiming MAX_SAFE_INTEGER', () => {
  const calculator = new MemoryCalculator('amd64');
  // formerly returned MAX_SAFE_INTEGER and could OOM the memory map UI
  const big = calculator.getTypeInfo('[2000000000000000]int64');
  assert.ok(big.size <= 1_048_576 * 8);
  assert.ok(Number.isFinite(big.size));
  assert.equal(big.alignment, 8);
});

test('clearing registries resets state but keeps builtin error', () => {
  const calculator = new MemoryCalculator('amd64');
  calculator.registerStruct('User', [{ name: 'ID', typeName: 'uint64' }]);
  calculator.registerTypeAlias('Flag', 'bool');
  calculator.registerInterface('MyInt');
  calculator.clearStructRegistry();

  // Custom registrations are gone.
  assert.deepEqual(calculator.getTypeInfo('User'), { size: 8, alignment: 8 });
  assert.deepEqual(calculator.getTypeInfo('Flag'), { size: 8, alignment: 8 });
  assert.deepEqual(calculator.getTypeInfo('MyInt'), { size: 8, alignment: 8 });
  // error stays a 2-word interface.
  assert.deepEqual(calculator.getTypeInfo('error'), { size: 16, alignment: 8 });
});

test('struct layout adds final padding to satisfy alignment', () => {
  const calculator = new MemoryCalculator('amd64');
  const layout = calculator.calculateStructSize([
    { typeName: 'uint64' },
    { typeName: 'uint8' }
  ]);
  assert.equal(layout.size, 16);
  assert.equal(layout.alignment, 8);
  // [no pad before id, no pad before flag, 7 final pad] in current tail-padding format
  assert.deepEqual(layout.paddings, [0, 0, 7]);
});

test('switching architecture updates pointer-sized types', () => {
  const calculator = new MemoryCalculator('amd64');
  assert.deepEqual(calculator.getTypeInfo('string'), { size: 16, alignment: 8 });
  calculator.setArchitecture('386');
  assert.deepEqual(calculator.getTypeInfo('string'), { size: 8, alignment: 4 });
  assert.equal(calculator.getArchitecture(), '386');
});
