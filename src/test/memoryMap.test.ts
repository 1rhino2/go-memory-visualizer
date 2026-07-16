import { strict as assert } from 'assert';
import test from 'node:test';
import { GoParser } from '../goParser';
import {
  buildMemoryMap,
  computePackScore,
  renderAsciiMap,
  buildOptimizePreview
} from '../memoryMap';
import { StructOptimizer } from '../optimizer';

test('computePackScore is 100 when there is no padding', () => {
  assert.equal(computePackScore(40, 0), 100);
  assert.equal(computePackScore(0, 0), 100);
});

test('computePackScore reflects padding waste', () => {
  // 48B total, 14B pad -> (34/48)*100 = 71
  assert.equal(computePackScore(48, 14), 71);
});

test('buildMemoryMap paints fields and padding cells', () => {
  const parser = new GoParser('amd64');
  const structs = parser.parseStructs(`
package main
type User struct {
  Active bool
  ID uint64
}
`);
  const map = buildMemoryMap(structs[0]);
  assert.equal(map.totalSize, 16);
  assert.equal(map.cells.length, 16);
  // first byte is Active
  assert.equal(map.cells[0].kind, 'field');
  assert.equal(map.cells[0].fieldName, 'Active');
  // bytes 1-7 are padding
  assert.equal(map.cells[1].kind, 'padding');
  assert.equal(map.cells[7].kind, 'padding');
  // byte 8 starts ID
  assert.equal(map.cells[8].kind, 'field');
  assert.equal(map.cells[8].fieldName, 'ID');
  assert.ok(map.packScore < 100);
  assert.equal(map.truncated, false);
});

test('renderAsciiMap includes legend and padding dots', () => {
  const parser = new GoParser('amd64');
  const structs = parser.parseStructs(`
package main
type User struct {
  Active bool
  ID uint64
}
`);
  const map = buildMemoryMap(structs[0]);
  const ascii = renderAsciiMap(map, 16);
  assert.match(ascii, /User/);
  assert.match(ascii, /legend:/);
  assert.match(ascii, /\./); // padding dots
  assert.match(ascii, /Active/);
  assert.match(ascii, /ID/);
});

test('buildOptimizePreview carries before/after pack scores', () => {
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
  const preview = buildOptimizePreview(
    structs[0],
    result.originalSize,
    result.optimizedSize,
    result.bytesSaved,
    result.reorderedFields,
    result.optimizedPadding
  );
  assert.equal(preview.bytesSaved, 8);
  assert.equal(preview.originalOrder[0], 'Active');
  assert.equal(preview.optimizedOrder[0], 'ID');
  assert.ok(preview.optimizedPackScore >= preview.originalPackScore);
});

test('parser exposes packScore on StructInfo', () => {
  const parser = new GoParser('amd64');
  const structs = parser.parseStructs(`
package main
type Tight struct {
  ID uint64
  Name string
}
`);
  assert.equal(structs[0].packScore, 100);
});
