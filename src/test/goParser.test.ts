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

test('error and named interface fields are sized as 2 words', () => {
  const parser = new GoParser('amd64');
  const structs = parser.parseStructs(`
package main

type Closer interface {
  Close() error
}

type Result struct {
  Err error
  C   Closer
  ID  uint32
}
`);

  const result = structs.find(s => s.name === 'Result');
  assert.ok(result);
  // err: 16 (offset 0), Closer: 16 (offset 16), ID: 4 (offset 32) + 4 final pad
  assert.equal(result.totalSize, 40);
  assert.deepEqual(
    result.fields.map(f => ({ name: f.name, size: f.size, offset: f.offset })),
    [
      { name: 'Err', size: 16, offset: 0 },
      { name: 'C', size: 16, offset: 16 },
      { name: 'ID', size: 4, offset: 32 }
    ]
  );
});

test('parser handles embedded structs and embedded pointers', () => {
  const parser = new GoParser('amd64');
  const structs = parser.parseStructs(`
package main

type Base struct {
  ID        uint64
  CreatedAt int64
}

type Meta struct {
  Tag string
}

type Document struct {
  Base
  *Meta
  Title     string
  Published bool
}
`);

  const doc = structs.find(s => s.name === 'Document');
  assert.ok(doc);
  // Base: 16 bytes (offset 0), *Meta: 8 bytes (offset 16), Title string: 16 (offset 24), Published bool: 1 + 7 final pad
  assert.equal(doc.totalSize, 48);
  const fieldsByName = Object.fromEntries(doc.fields.map(f => [f.name, f]));
  assert.equal(fieldsByName['Base'].size, 16);
  assert.equal(fieldsByName['Meta'].size, 8);
  assert.equal(fieldsByName['Title'].size, 16);
  assert.equal(fieldsByName['Published'].size, 1);
});

test('parser computes nested struct sizes recursively', () => {
  const parser = new GoParser('amd64');
  const structs = parser.parseStructs(`
package main

type Point struct {
  X float64
  Y float64
}

type Rectangle struct {
  TopLeft Point
  Width   uint32
  Height  uint32
}
`);

  const rect = structs.find(s => s.name === 'Rectangle');
  assert.ok(rect);
  assert.equal(rect.totalSize, 24);
  assert.equal(rect.fields[0].size, 16);
});

test('parser handles anonymous inline struct fields', () => {
  const parser = new GoParser('amd64');
  const structs = parser.parseStructs(`
package main

type Outer struct {
  Header struct {
    ID    uint64
    Flags uint8
  }
  Body []byte
}
`);

  const outer = structs.find(s => s.name === 'Outer');
  assert.ok(outer);
  // Header: uint64 + uint8 + 7 pad = 16 bytes, then Body slice: 24 bytes -> total 40
  assert.equal(outer.totalSize, 40);
  assert.equal(outer.fields.length, 2);
  assert.equal(outer.fields[0].name, 'Header');
  assert.equal(outer.fields[0].size, 16);
  assert.equal(outer.fields[1].name, 'Body');
  assert.equal(outer.fields[1].size, 24);
});

test('parser computes cache line crossings and hot fields', () => {
  const parser = new GoParser('amd64');
  const structs = parser.parseStructs(`
package main

type Big struct {
  Pad1 [60]byte
  Span uint64
  Tail [60]byte
}
`);

  const big = structs.find(s => s.name === 'Big');
  assert.ok(big);
  // Pad1 occupies bytes 0..59, Span sits at offset 64 (4 bytes pad first), Tail starts at 72
  // Span at 64..71 stays in cache line 1. Tail at 72..131 crosses lines 1->2.
  const span = big.fields.find(f => f.name === 'Span');
  const tail = big.fields.find(f => f.name === 'Tail');
  assert.ok(span);
  assert.ok(tail);
  assert.equal(span.crossesCacheLine, false);
  assert.equal(tail.crossesCacheLine, true);
  assert.ok(big.cacheLinesCrossed >= 2);
  assert.ok(big.hotFields.includes('Tail'));
});

test('parser respects 386 architecture sizing', () => {
  const parser = new GoParser('386');
  const structs = parser.parseStructs(`
package main

type S struct {
  P *int
  S string
  B []byte
}
`);

  const s = structs.find(structInfo => structInfo.name === 'S');
  assert.ok(s);
  // 386: pointer = 4, string = 8, slice = 12 -> total 24
  assert.equal(s.totalSize, 24);
});

test('parser ignores interface declarations as struct candidates', () => {
  const parser = new GoParser('amd64');
  const structs = parser.parseStructs(`
package main

type Reader interface {
  Read(p []byte) (n int, err error)
}

type Wrap struct {
  R Reader
}
`);

  // Only Wrap is a struct.
  assert.equal(structs.length, 1);
  assert.equal(structs[0].name, 'Wrap');
  assert.equal(structs[0].totalSize, 16);
});

test('struct tags and end-of-line comments do not break parsing', () => {
  const parser = new GoParser('amd64');
  const structs = parser.parseStructs(`
package main

type Tagged struct {
  ID   uint64 ` + '`json:"id"`' + ` // identifier
  Name string ` + '`json:"name"`' + `
  Active bool // is the user active
}
`);

  const tagged = structs.find(s => s.name === 'Tagged');
  assert.ok(tagged);
  assert.equal(tagged.fields.length, 3);
  // uint64(8) + string(16) + bool(1) + 7 final pad = 32
  assert.equal(tagged.totalSize, 32);
});
