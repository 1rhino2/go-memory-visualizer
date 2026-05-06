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
