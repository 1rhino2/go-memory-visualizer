import { strict as assert } from 'assert';
import test from 'node:test';
import { GoParser } from '../goParser';
import { buildMemoryMap, renderAsciiMap } from '../memoryMap';
import { buildMemoryMapHtml, buildOptimizePreviewHtml } from '../webviewHtml';
import { buildOptimizePreview } from '../memoryMap';
import {
  escapeHtml,
  sanitizeCSVValue,
  sanitizeMarkdownCell,
  MAX_MEMORY_MAP_BYTES
} from '../security';

test('escapeHtml neutralizes script and attribute breakouts', () => {
  const payload = `<script>alert(1)</script>"'><img src=x onerror=alert(1)>`;
  const out = escapeHtml(payload);
  // raw tags / quotes must not survive; onerror= as text is fine once < and " are gone
  assert.equal(out.includes('<'), false);
  assert.equal(out.includes('>'), false);
  assert.equal(out.includes('"'), false);
  assert.match(out, /&lt;script&gt;/);
  assert.match(out, /&quot;/);
});

test('webview HTML escapes hostile type and field names', () => {
  // type names can carry punctuation the parser keeps
  const parser = new GoParser('amd64');
  const structs = parser.parseStructs(`
package main
type Safe struct {
  A string
  B int
}
`);
  const map = buildMemoryMap(structs[0]);
  // inject hostile names after parse (simulates tainted layout data)
  map.structName = 'Evil<script>alert(1)</script>';
  map.cells[0].fieldName = '"><img src=x onerror=alert(1)>';
  const html = buildMemoryMapHtml(map, renderAsciiMap(map));
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('"><img'), false);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /&lt;script&gt;/);
});

test('optimize preview HTML escapes field order names', () => {
  const preview = buildOptimizePreview(
    {
      name: 'X<img>',
      fields: [
        { name: 'A<script>', typeName: 'int', offset: 0, size: 8, alignment: 8, lineNumber: 0, paddingAfter: 0, cacheLineStart: 0, cacheLineEnd: 0, crossesCacheLine: false }
      ],
      totalSize: 8,
      totalPadding: 0,
      lineNumber: 0,
      endLineNumber: 2,
      alignment: 8,
      cacheLines: [],
      cacheLinesCrossed: 1,
      hotFields: [],
      packScore: 100
    },
    8,
    8,
    0,
    ['B"><img src=x onerror=alert(1)>'],
    0
  );
  const html = buildOptimizePreviewHtml(preview);
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('<img>'), false);
  assert.match(html, /&lt;img&gt;/);
});

test('huge array structs do not allocate one map cell per byte', () => {
  const parser = new GoParser('amd64');
  const structs = parser.parseStructs(`
package main
type Bomb struct {
  Huge [2000000]byte
}
`);
  assert.ok(structs[0].totalSize > MAX_MEMORY_MAP_BYTES);
  const map = buildMemoryMap(structs[0]);
  assert.equal(map.truncated, true);
  assert.equal(map.cells.length, MAX_MEMORY_MAP_BYTES);
  // must finish quickly - length check is the proxy for O(n) safety
  assert.ok(map.cells.length <= MAX_MEMORY_MAP_BYTES);
});

test('CSV formula injection is neutralized', () => {
  const evil = '=cmd|\'/c calc\'!A0';
  const cell = sanitizeCSVValue(evil);
  assert.match(cell, /^"'=/);
  assert.equal(cell.startsWith('='), false);
});

test('markdown table cells escape pipes and newlines', () => {
  const cell = sanitizeMarkdownCell('foo|bar\nbaz');
  assert.equal(cell.includes('\n'), false);
  assert.match(cell, /\\\|/);
});

test('hostile type strings in layout stay escaped in map html', () => {
  const parser = new GoParser('amd64');
  const structs = parser.parseStructs(`
package main
type T struct {
  X map[string]string
}
`);
  // force a hostile type label into the ascii legend path via field name
  structs[0].fields[0].name = 'x<script>';
  const map = buildMemoryMap(structs[0]);
  const html = buildMemoryMapHtml(map, renderAsciiMap(map));
  assert.equal(html.includes('<script>'), false);
});
