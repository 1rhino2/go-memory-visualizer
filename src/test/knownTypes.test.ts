import { strict as assert } from 'assert';
import test from 'node:test';
import { getKnownTypeInfo, isKnownType } from '../knownTypes';
import { MemoryCalculator } from '../memoryCalculator';
import { GoParser } from '../goParser';

test('time.Time is 24B on amd64 and 20B on 386', () => {
  // amd64: 8+8+8 = 24
  assert.deepEqual(getKnownTypeInfo('time.Time', 'amd64'), { size: 24, alignment: 8 });
  // 386: 8+8+4 = 20
  assert.deepEqual(getKnownTypeInfo('time.Time', '386'), { size: 20, alignment: 8 });
});

test('sync.Mutex and atomic.Int64 have stable sizes', () => {
  assert.deepEqual(getKnownTypeInfo('sync.Mutex', 'amd64'), { size: 8, alignment: 4 });
  assert.deepEqual(getKnownTypeInfo('atomic.Int64', 'amd64'), { size: 8, alignment: 8 });
  assert.deepEqual(getKnownTypeInfo('context.Context', 'amd64'), { size: 16, alignment: 8 });
});

test('isKnownType recognizes stdlib names', () => {
  assert.equal(isKnownType('time.Time'), true);
  assert.equal(isKnownType('sync.RWMutex'), true);
  assert.equal(isKnownType('SomethingElse'), false);
});

test('calculator sizes time.Time via known types by default', () => {
  const calc = new MemoryCalculator('amd64');
  assert.deepEqual(calc.getTypeInfo('time.Time'), { size: 24, alignment: 8 });
});

test('calculator can disable known types and fall back to pointer size', () => {
  const calc = new MemoryCalculator('amd64');
  calc.setUseKnownTypes(false);
  assert.deepEqual(calc.getTypeInfo('time.Time'), { size: 8, alignment: 8 });
});

test('parser lays out structs that embed time.Time correctly', () => {
  const parser = new GoParser('amd64');
  const structs = parser.parseStructs(`
package main

type Event struct {
  Flag bool
  When time.Time
  ID   uint64
}
`);
  const event = structs[0];
  // Flag(1)+7pad + time.Time(24) + ID(8) = 40
  assert.equal(event.totalSize, 40);
  assert.equal(event.fields[1].size, 24);
  assert.equal(event.fields[1].offset, 8);
});

test('sync.Mutex fields size correctly inside a struct', () => {
  const parser = new GoParser('amd64');
  const structs = parser.parseStructs(`
package main

type Guarded struct {
  Mu   sync.Mutex
  Ready bool
}
`);
  // Mutex 8 + bool 1 + 3 pad to align 4? max align is 4 from mutex -> size 12
  assert.equal(structs[0].fields[0].size, 8);
  assert.equal(structs[0].totalSize, 12);
});
