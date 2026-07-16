/**
 * Shared escaping / caps used across webviews, export, and parse paths.
 */

export const MAX_PARSE_BYTES = 1024 * 1024; // 1MB open-file / workspace parse cap
export const MAX_STRUCT_FIELDS = 2000;
export const MAX_ARRAY_ELEMENTS = 1_048_576; // 1Mi elements for size math
export const MAX_MEMORY_MAP_BYTES = 4096; // refuse per-byte maps beyond this

export function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, c => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return entities[c] || c;
  });
}

export function escapeMarkdown(str: string): string {
  return str.replace(/[\\`*_{}[\]()#+\-.!|]/g, '\\$&');
}

// keep markdown table cells on one line and kill pipe/formula tricks
export function sanitizeMarkdownCell(str: string): string {
  let s = str.replace(/[\r\n\t]+/g, ' ').replace(/\|/g, '\\|');
  if (/^[=+\-@]/.test(s)) {
    s = "'" + s;
  }
  return s;
}

export function sanitizeCSVValue(val: string): string {
  let sanitized = val;
  if (/^[=+\-@\t\r]/.test(sanitized)) {
    sanitized = "'" + sanitized;
  }
  return '"' + sanitized.replace(/"/g, '""') + '"';
}

export function truncateForParse(content: string): { text: string; truncated: boolean } {
  if (content.length <= MAX_PARSE_BYTES) {
    return { text: content, truncated: false };
  }
  return { text: content.slice(0, MAX_PARSE_BYTES), truncated: true };
}
