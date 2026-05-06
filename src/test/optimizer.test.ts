import { strict as assert } from 'assert';
import test from 'node:test';
import { GoParser } from '../goParser';
import { StructOptimizer } from '../optimizer';

test('optimizer reports size savings for poorly ordered structs', () => {
  const parser = new GoParser('amd64');
  const structs = parser.parseStructs(`
package main

type User struct {
  Active bool
  ID uint64
  Count uint16
}
`);

  const optimizer = new StructOptimizer(parser.getCalculator());
  const result = optimizer.optimizeStruct(structs[0]);

  assert.equal(result.originalSize, 24);
  assert.equal(result.optimizedSize, 16);
  assert.equal(result.bytesSaved, 8);
  assert.deepEqual(result.reorderedFields, ['ID', 'Count', 'Active']);
});

test('optimizer emits grouped field lines once', () => {
  const source = `
package main

type Packed struct {
  A, B uint8
  Big uint64
}
`;
  const parser = new GoParser('amd64');
  const structs = parser.parseStructs(source);
  const optimizer = new StructOptimizer(parser.getCalculator());
  const optimization = optimizer.optimizeStruct(structs[0]);
  const optimized = optimizer.generateOptimizedCode(source, structs[0], optimization);

  assert.equal(optimized.match(/A, B uint8/g)?.length, 1);
  assert.ok(optimized.indexOf('Big uint64') < optimized.indexOf('A, B uint8'));
});

test('optimizer reports zero savings for already-optimal structs', () => {
  const parser = new GoParser('amd64');
  const structs = parser.parseStructs(`
package main

type Optimal struct {
  ID    uint64
  Name  string
  Flag  bool
}
`);

  const optimizer = new StructOptimizer(parser.getCalculator());
  const result = optimizer.optimizeStruct(structs[0]);
  assert.equal(result.bytesSaved, 0);
  assert.equal(result.originalSize, result.optimizedSize);
});

test('shouldOptimize respects minSavings threshold', () => {
  const parser = new GoParser('amd64');
  const structs = parser.parseStructs(`
package main

type Tiny struct {
  A bool
  B uint16
}
`);

  const optimizer = new StructOptimizer(parser.getCalculator());
  // Tiny has only 1 byte saveable (5->4), under default threshold of 8
  assert.equal(optimizer.shouldOptimize(structs[0]), false);
  assert.equal(optimizer.shouldOptimize(structs[0], 0), true);
});

test('optimizer produces correct savings on 386 architecture', () => {
  const parser = new GoParser('386');
  const structs = parser.parseStructs(`
package main

type Mixed struct {
  Flag    bool
  Pointer *int
  Count   uint16
}
`);

  const optimizer = new StructOptimizer(parser.getCalculator());
  const result = optimizer.optimizeStruct(structs[0]);
  // 386: bool(1)+3pad+ptr(4)+u16(2)+2pad = 12. Optimized: ptr(4)+u16(2)+bool(1)+1pad = 8
  assert.equal(result.originalSize, 12);
  assert.equal(result.optimizedSize, 8);
  assert.equal(result.bytesSaved, 4);
});

test('optimizer handles error fields with correct interface sizing', () => {
  const parser = new GoParser('amd64');
  const structs = parser.parseStructs(`
package main

type Result struct {
  Code int32
  Err  error
  ID   uint64
}
`);

  const optimizer = new StructOptimizer(parser.getCalculator());
  const result = optimizer.optimizeStruct(structs[0]);
  // Original: int32(4)+4pad+error(16)+uint64(8) = 32
  // Optimized: error(16)+uint64(8)+int32(4)+4pad = 32. No savings (already efficient).
  assert.equal(result.originalSize, 32);
  assert.equal(result.bytesSaved, 0);
});
