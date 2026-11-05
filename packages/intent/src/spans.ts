/**
 * UTF-8 source-span helpers.
 *
 * Spans are byte offsets into the UTF-8 encoding of the source text, so a
 * multilingual excerpt (CJK, emoji, accented Latin) still maps to the exact
 * bytes a reviewer would find in the file. Line numbers are derived from the
 * text prefix and are 1-based.
 */

export interface Utf8Span {
  startByte: number;
  endByte: number;
  startLine: number;
  endLine: number;
}

const encoder = new TextEncoder();

/** Byte length of a string in UTF-8. */
export function utf8Length(value: string): number {
  return encoder.encode(value).length;
}

/** 1-based line number of the character index `index` within `text`. */
export function lineNumberAt(text: string, index: number): number {
  let line = 1;
  const limit = Math.min(index, text.length);
  for (let i = 0; i < limit; i += 1) {
    if (text.charCodeAt(i) === 10 /* \n */) {
      line += 1;
    }
  }
  return line;
}

/**
 * Compute the UTF-8 byte span of the substring `text.slice(start, end)`.
 * `end` is exclusive in character terms; the returned `endByte` is exclusive.
 */
export function spanOf(text: string, start: number, end: number): Utf8Span {
  const clampedStart = Math.max(0, Math.min(start, text.length));
  const clampedEnd = Math.max(clampedStart, Math.min(end, text.length));
  const startByte = utf8Length(text.slice(0, clampedStart));
  const endByte = startByte + utf8Length(text.slice(clampedStart, clampedEnd));
  return {
    startByte,
    endByte,
    startLine: lineNumberAt(text, clampedStart),
    endLine: lineNumberAt(text, clampedEnd)
  };
}

/**
 * Find the first occurrence of `needle` in `text` at or after `fromIndex` and
 * return its span. Returns `undefined` when the needle is not present, so a
 * caller never fabricates a span for text that is not in the source.
 */
export function findSpan(text: string, needle: string, fromIndex = 0): Utf8Span | undefined {
  if (needle.length === 0) {
    return undefined;
  }
  const index = text.indexOf(needle, fromIndex);
  if (index === -1) {
    return undefined;
  }
  return spanOf(text, index, index + needle.length);
}
