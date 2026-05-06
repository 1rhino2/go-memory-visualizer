import { strict as assert } from 'assert';
import test from 'node:test';
import { GoParser } from '../goParser';

test('parser resolves same-file aliases and compiler-sized headers', () => {
  const parser = new GoParser('amd64');
  const structs = parser.parseStructs(`
package main

type Flag bool
type Token = unsafe.Pointer

type Event struct {
  Active Flag
  IDs []uint64
  Token Token
}
`);

  const event = structs.find(structInfo => structInfo.name === 'Event');

  assert.ok(event);
  assert.equal(event.totalSize, 40);
  assert.deepEqual(
    event.fields.map(field => ({
      name: field.name,
      size: field.size,
      alignment: field.alignment,
      offset: field.offset,
      paddingAfter: field.paddingAfter
    })),
    [
      { name: 'Active', size: 1, alignment: 1, offset: 0, paddingAfter: 7 },
      { name: 'IDs', size: 24, alignment: 8, offset: 8, paddingAfter: 0 },
      { name: 'Token', size: 8, alignment: 8, offset: 32, paddingAfter: 0 }
    ]
  );
});

test('parser registers aliases declared inside type blocks', () => {
  const parser = new GoParser('amd64');
  const structs = parser.parseStructs(`
package main

type (
  Count uint16
  Label = string
)

type Sample struct {
  Count Count
  Label Label
}
`);

  const sample = structs.find(structInfo => structInfo.name === 'Sample');

  assert.ok(sample);
  assert.equal(sample.totalSize, 24);
  assert.deepEqual(
    sample.fields.map(field => ({
      name: field.name,
      size: field.size,
      offset: field.offset,
      paddingAfter: field.paddingAfter
    })),
    [
      { name: 'Count', size: 2, offset: 0, paddingAfter: 6 },
      { name: 'Label', size: 16, offset: 8, paddingAfter: 0 }
    ]
  );
});
