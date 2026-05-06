import { strict as assert } from 'assert';
import test from 'node:test';
import { compareStructAcrossArchs } from '../archCompare';

test('compareStructAcrossArchs reports per-arch sizes for a slice/string struct', () => {
  const source = `
package main
type S struct {
  P *int
  N string
  B []byte
}
`;
  const cmp = compareStructAcrossArchs(source, 'S');
  assert.ok(cmp);
  assert.equal(cmp.layouts.length, 3);

  const sizes = Object.fromEntries(cmp.layouts.map(l => [l.architecture, l.totalSize]));
  // amd64/arm64: ptr=8, string=16, slice=24 -> 48
  assert.equal(sizes.amd64, 48);
  assert.equal(sizes.arm64, 48);
  // 386: ptr=4, string=8, slice=12 -> 24
  assert.equal(sizes['386'], 24);
});

test('returns undefined when the struct is not found in the source', () => {
  const cmp = compareStructAcrossArchs('package main\n', 'Missing');
  assert.equal(cmp, undefined);
});

test('per-arch field offsets reflect different pointer sizes', () => {
  const source = `
package main
type S struct {
  Flag bool
  Ptr  *int
}
`;
  const cmp = compareStructAcrossArchs(source, 'S');
  assert.ok(cmp);
  const amd64 = cmp.layouts.find(l => l.architecture === 'amd64');
  const x86 = cmp.layouts.find(l => l.architecture === '386');
  assert.ok(amd64);
  assert.ok(x86);
  // amd64: bool offset 0, ptr offset 8 (after 7B pad)
  assert.equal(amd64.fields[1].offset, 8);
  // 386: bool offset 0, ptr offset 4 (after 3B pad)
  assert.equal(x86.fields[1].offset, 4);
});

test('error fields stay 2-word across architectures', () => {
  const source = `
package main
type R struct {
  Err error
  ID  uint64
}
`;
  const cmp = compareStructAcrossArchs(source, 'R');
  assert.ok(cmp);
  const amd64 = cmp.layouts.find(l => l.architecture === 'amd64');
  const x86 = cmp.layouts.find(l => l.architecture === '386');
  assert.ok(amd64);
  assert.ok(x86);
  // amd64: error 16 bytes
  assert.equal(amd64.fields[0].size, 16);
  // 386: error 8 bytes (2 words of 4)
  assert.equal(x86.fields[0].size, 8);
});
