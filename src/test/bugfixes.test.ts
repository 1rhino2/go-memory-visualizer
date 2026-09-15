import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GoParser } from '../goParser';
import { StructOptimizer } from '../optimizer';
import { MemoryCalculator } from '../memoryCalculator';
import { getKnownTypeInfo } from '../knownTypes';
import { buildMemoryMap, renderAsciiMap } from '../memoryMap';

// regression tests for the 1.1.2 bugcheck. every expected number here was
// checked against unsafe.Sizeof / unsafe.Offsetof on a real Go toolchain.

function parse(src: string, arch: 'amd64' | 'arm64' | '386' = 'amd64') {
  return new GoParser(arch).parseStructs(src);
}

test('one-line empty struct does not swallow the next declaration', () => {
  const structs = parse(`type Empty struct{}

type Foo struct {
	A int64
	B bool
}`);
  assert.deepEqual(structs.map(s => s.name), ['Empty', 'Foo']);
  assert.equal(structs[0].totalSize, 0);
  assert.equal(structs[0].fields.length, 0);
  assert.equal(structs[0].endLineNumber, 0);
  assert.equal(structs[1].totalSize, 16);
});

test('one-line struct body with fields is parsed and sized', () => {
  const structs = parse(`type Point struct{ X, Y int32 }
type Other struct {
	P Point
	B bool
}`);
  assert.equal(structs[0].name, 'Point');
  assert.equal(structs[0].totalSize, 8);
  assert.deepEqual(structs[0].fields.map(f => f.name), ['X', 'Y']);
  assert.equal(structs[1].totalSize, 12);
});

test('structs declared inside a type group are analyzed and registered', () => {
  const structs = parse(`type (
	Inner struct {
		A int64
	}
	Outer struct {
		I Inner
		B bool
	}
	Name string
)`);
  assert.deepEqual(structs.map(s => s.name), ['Inner', 'Outer']);
  assert.equal(structs[0].totalSize, 8);
  assert.equal(structs[1].fields[0].size, 8);
  assert.equal(structs[1].totalSize, 16);
});

test('embedded qualified and pointer types are kept', () => {
  const [t] = parse(`type T struct {
	sync.Mutex
	*bytes.Buffer
	n int32
}`);
  assert.deepEqual(t.fields.map(f => f.name), ['Mutex', 'Buffer', 'n']);
  assert.equal(t.fields[1].typeName, '*bytes.Buffer');
  assert.equal(t.totalSize, 24);
});

test('embedded generic type keeps its name', () => {
  const [t] = parse(`type T struct {
	Base[int]
	n int32
}`);
  assert.equal(t.fields[0].name, 'Base');
  assert.equal(t.fields.length, 2);
});

test('generic struct declarations are not skipped', () => {
  const structs = parse(`type Box[T any] struct {
	V T
	B bool
}`);
  assert.equal(structs.length, 1);
  assert.equal(structs[0].name, 'Box');
});

test('one-line anonymous struct field does not eat the rest of the parent', () => {
  const [t] = parse(`type T struct {
	Meta struct{ A int32 }
	B bool
	C int64
}`);
  assert.deepEqual(t.fields.map(f => f.name), ['Meta', 'B', 'C']);
  assert.equal(t.fields[0].size, 4);
  assert.equal(t.totalSize, 16);
});

test('trailing zero-size field gets the extra Go padding byte', () => {
  const [a] = parse(`type T struct {
	A int64
	_ struct{}
}`);
  assert.equal(a.totalSize, 16);

  const [b] = parse(`type T struct {
	_ struct{}
	A int64
}`);
  assert.equal(b.totalSize, 8);

  const [c] = parse(`type T struct {
	A int64
	E [0]byte
}`);
  assert.equal(c.totalSize, 16);
});

test('zero-size field at a cache line boundary is not flagged as crossing', () => {
  const [t] = parse(`type T struct {
	_ [0]func()
	A int64
}`);
  assert.equal(t.fields[0].crossesCacheLine, false);
  assert.deepEqual(t.hotFields, []);
});

test('386 aligns int64 and float64 to 4 bytes', () => {
  const [t] = parse(`type T struct {
	B bool
	A int64
	F float64
}`, '386');
  assert.equal(t.fields[1].offset, 4);
  assert.equal(t.fields[2].offset, 12);
  assert.equal(t.totalSize, 20);
  assert.equal(t.alignment, 4);

  const calc = new MemoryCalculator('386');
  assert.equal(calc.getTypeInfo('complex128').alignment, 4);
  // atomic 64-bit types carry align64 and stay 8-aligned on 386
  assert.equal(calc.getTypeInfo('atomic.Int64').alignment, 8);
});

test('known stdlib sizes match current Go', () => {
  assert.deepEqual(getKnownTypeInfo('atomic.Bool', 'amd64'), { size: 4, alignment: 4 });
  assert.deepEqual(getKnownTypeInfo('atomic.Pointer[int]', 'amd64'), { size: 8, alignment: 8 });
  assert.deepEqual(getKnownTypeInfo('sync.WaitGroup', '386'), { size: 16, alignment: 8 });
  assert.deepEqual(getKnownTypeInfo('sync.Cond', 'amd64'), { size: 56, alignment: 8 });
  assert.deepEqual(getKnownTypeInfo('sync.Cond', '386'), { size: 32, alignment: 4 });
  assert.deepEqual(getKnownTypeInfo('time.Duration', '386'), { size: 8, alignment: 4 });
});

test('inline interface literals and struct{} are sized', () => {
  const calc = new MemoryCalculator('amd64');
  assert.deepEqual(calc.getTypeInfo('interface{ Foo() }'), { size: 16, alignment: 8 });
  assert.deepEqual(calc.getTypeInfo('struct{}'), { size: 0, alignment: 1 });
  assert.deepEqual(calc.getTypeInfo('struct {}'), { size: 0, alignment: 1 });
});

test('block comments inside a struct are ignored', () => {
  const [t] = parse(`type T struct {
	A int64 /* trailing */
	/* B bool
	C bool */
	D bool
}`);
  assert.deepEqual(t.fields.map(f => f.name), ['A', 'D']);
  assert.equal(t.fields[1].lineNumber, 4);
});

test('optimizer keeps comments, duplicate blank fields, and anon struct bodies', () => {
  const src = `package x

type T struct {
	// leading comment for a
	a bool
	_ [3]byte // pad
	b int64
	_ [4]byte
	c bool
	Inner struct {
		X int64
		Y bool
	}
}`;
  const parser = new GoParser('amd64');
  const [t] = parser.parseStructs(src);
  const optimizer = new StructOptimizer(parser.getCalculator());
  const result = optimizer.optimizeStruct(t);
  assert.equal(result.reorderedIndices.length, t.fields.length);

  const out = optimizer.generateOptimizedCode(src, t, result);
  assert.ok(out.includes('\t// leading comment for a\n\ta bool'), 'comment travels with its field');
  assert.equal((out.match(/^\t_ \[/gm) || []).length, 2, 'both _ fields survive');
  assert.ok(out.includes('\tInner struct {\n\t\tX int64\n\t\tY bool\n\t}'), 'anon struct body intact');
  assert.ok(out.endsWith('\n}'), 'outer closing brace intact');

  // reparse the output: same fields, same size, still valid shape
  const [again] = parser.parseStructs(out);
  assert.equal(again.fields.length, t.fields.length);
  assert.equal(again.totalSize, result.optimizedSize);
});

test('optimizer puts zero-size fields first instead of last', () => {
  const parser = new GoParser('amd64');
  // int32 + trailing struct{} = 4 + 1 pad byte -> 8. moving the marker
  // first drops the padding byte and the struct is 4.
  const [t] = parser.parseStructs(`type T struct {
	A int32
	_ struct{}
}`);
  assert.equal(t.totalSize, 8);
  const optimizer = new StructOptimizer(parser.getCalculator());
  const result = optimizer.optimizeStruct(t);
  assert.equal(result.reorderedFields[0], '_');
  assert.equal(result.optimizedSize, 4);
  assert.equal(result.bytesSaved, 4);
});

test('optimizer rewrites a one-line struct in place', () => {
  const src = `type P struct{ B bool; A int64; C bool }
var x P`;
  const parser = new GoParser('amd64');
  const [t] = parser.parseStructs(src);
  const optimizer = new StructOptimizer(parser.getCalculator());
  const result = optimizer.optimizeStruct(t);
  assert.equal(result.bytesSaved, 8);
  const out = optimizer.generateOptimizedCode(src, t, result);
  assert.equal(out, `type P struct{ A int64; B bool; C bool }\nvar x P`);
});

test('one-line interface declarations do not hang the parser', { timeout: 2000 }, () => {
  const structs = parse(`type Stringer interface{ String() string }
type (
	Reader interface{ Read([]byte) (int, error) }
	T struct {
		S Stringer
		R Reader
		B bool
	}
)`);
  assert.deepEqual(structs.map(s => s.name), ['T']);
  assert.equal(structs[0].totalSize, 40);
});

test('array length from a same-file const is resolved', () => {
  const structs = parse(`const maxLen = 16

const (
	keySize     = 32
	nonceSize int = 12
	computed = keySize * 2
)

type T struct {
	Name  [maxLen]byte
	Key   [keySize]byte
	Nonce [nonceSize]byte
	B     bool
}`);
  const [t] = structs;
  assert.equal(t.fields[0].size, 16);
  assert.equal(t.fields[1].size, 32);
  assert.equal(t.fields[2].size, 12);
  assert.equal(t.totalSize, 61);

  // unknown const still falls back to pointer width like before
  const [u] = parse(`type U struct {
	Buf [unknownLen]byte
}`);
  assert.equal(u.fields[0].size, 8);
});

test('common stdlib interfaces size as 2 words', () => {
  const [t] = parse(`type T struct {
	R io.Reader
	S fmt.Stringer
	H http.Handler
	B bool
}`);
  assert.equal(t.fields[0].size, 16);
  assert.equal(t.fields[1].size, 16);
  assert.equal(t.fields[2].size, 16);
  assert.equal(t.totalSize, 56);
});

test('memory map keeps repeated _ fields distinct', () => {
  const [t] = parse(`type T struct {
	_ [4]byte
	A int32
	_ [8]byte
}`);
  const map = buildMemoryMap(t);
  const first = map.cells[0];
  const third = map.cells[8];
  assert.equal(first.fieldName, '_');
  assert.equal(third.fieldName, '_');
  assert.notEqual(first.colorIndex, third.colorIndex);
  const ascii = renderAsciiMap(map);
  assert.ok(ascii.includes('A=_'), ascii);
  assert.ok(ascii.includes('C=_'), ascii);
});

test('field cap stops recording but still finds the closing brace', () => {
  const body = '\tF int64\n'.repeat(2500);
  const src = `type T struct {\n${body}}\ntype After struct {\n\tB bool\n}`;
  const structs = parse(src);
  assert.equal(structs.length, 2);
  assert.equal(structs[0].fields.length, 2000);
  assert.equal(structs[0].endLineNumber, 2501);
  assert.equal(structs[1].name, 'After');
});

test('rewrite only changes the struct block (line delta is zero)', () => {
  const src = `package x\n\ntype T struct {\n\tA bool\n\tB int64\n}\n\nfunc f() {}\n`;
  const parser = new GoParser('amd64');
  const [t] = parser.parseStructs(src);
  const optimizer = new StructOptimizer(parser.getCalculator());
  const out = optimizer.generateOptimizedCode(src, t, optimizer.optimizeStruct(t));
  const oldLines = src.split('\n');
  const newLines = out.split('\n');
  assert.equal(newLines.length, oldLines.length);
  assert.deepEqual(newLines.slice(0, t.lineNumber), oldLines.slice(0, t.lineNumber));
  assert.deepEqual(newLines.slice(t.endLineNumber + 1), oldLines.slice(t.endLineNumber + 1));
  assert.deepEqual(newLines.slice(t.lineNumber, t.endLineNumber + 1), ['type T struct {', '\tB int64', '\tA bool', '}']);
});
