import { strict as assert } from 'assert';
import test from 'node:test';
import { GoParser } from '../goParser';
import { StructOptimizer } from '../optimizer';
import {
  buildStructDiagnostics,
  summariseFileSavings,
  DEFAULT_DIAGNOSTIC_OPTIONS
} from '../diagnostics';

function setup(source: string) {
  const parser = new GoParser('amd64');
  const structs = parser.parseStructs(source);
  const optimizer = new StructOptimizer(parser.getCalculator());
  return { structs, optimizer };
}

test('flags optimizable structs with bytesSaved diagnostic', () => {
  const { structs, optimizer } = setup(`
package main
type User struct {
  Active bool
  ID uint64
  Count uint16
}
`);
  const diags = buildStructDiagnostics(structs, optimizer);
  const optimizable = diags.find(d => d.code === 'optimizable');
  assert.ok(optimizable);
  assert.match(optimizable.message, /save 8 B/);
  assert.equal(optimizable.severity, 'info');
});

test('does not flag already-optimal structs', () => {
  const { structs, optimizer } = setup(`
package main
type Tight struct {
  ID   uint64
  Name string
  Flag bool
}
`);
  const diags = buildStructDiagnostics(structs, optimizer);
  assert.equal(diags.filter(d => d.code === 'optimizable').length, 0);
});

test('flags cache-line crossings as hint diagnostics', () => {
  const { structs, optimizer } = setup(`
package main
type Big struct {
  Pad1 [60]byte
  Span uint64
  Tail [60]byte
}
`);
  const diags = buildStructDiagnostics(structs, optimizer);
  const cross = diags.find(d => d.code === 'cache-line-cross');
  assert.ok(cross);
  assert.equal(cross.severity, 'hint');
  assert.match(cross.message, /Tail/);
});

test('respects cacheLineWarnings=false', () => {
  const { structs, optimizer } = setup(`
package main
type Big struct {
  Pad1 [60]byte
  Span uint64
  Tail [60]byte
}
`);
  const diags = buildStructDiagnostics(structs, optimizer, {
    ...DEFAULT_DIAGNOSTIC_OPTIONS,
    cacheLineWarnings: false
  });
  assert.equal(diags.filter(d => d.code === 'cache-line-cross').length, 0);
});

test('flags high-padding structs above threshold', () => {
  const { structs, optimizer } = setup(`
package main
type Wasteful struct {
  A bool
  B uint64
  C bool
  D uint64
}
`);
  const diags = buildStructDiagnostics(structs, optimizer);
  const padding = diags.find(d => d.code === 'padding');
  assert.ok(padding);
  assert.match(padding.message, /padding/);
});

test('summariseFileSavings totals saveable bytes per file', () => {
  const { structs, optimizer } = setup(`
package main
type Optimal struct {
  ID   uint64
  Name string
}
type WastefulOne struct {
  M bool
  N uint64
  O bool
  R uint64
}
type WastefulTwo struct {
  A bool
  B uint64
  C uint16
}
`);
  const summary = summariseFileSavings(structs, optimizer);
  assert.equal(summary.totalStructs, 3);
  // Optimal: 0 saved. WastefulOne: 32 -> 24 = 8 saved. WastefulTwo: 24 -> 16 = 8 saved.
  assert.equal(summary.optimizableCount, 2);
  assert.equal(summary.fileSaveable, 16);
});

test('summary returns zeros for files with no structs', () => {
  const { structs, optimizer } = setup(`package main\n// empty\n`);
  const summary = summariseFileSavings(structs, optimizer);
  assert.deepEqual(summary, { fileSaveable: 0, optimizableCount: 0, totalStructs: 0 });
});
