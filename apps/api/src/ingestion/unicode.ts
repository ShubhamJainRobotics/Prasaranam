/**
 * Unicode code-point helpers.
 * Per SPEC Section 2A.6 item 3:
 * All offsets are zero-based indices in Unicode code points (not UTF-16 code units, not bytes).
 * JavaScript code uses code-point-aware iteration ([...str]);
 * the database uses character functions on a UTF-8 database.
 */

/**
 * Returns the length of the string in Unicode code points.
 * Multi-byte characters and surrogate pairs (e.g. emoji) count as 1 code point.
 */
export function codePointLength(str: string): number {
  return [...str].length;
}

/**
 * Slices a string using zero-based Unicode code-point offsets.
 * start: zero-based code-point index (inclusive)
 * end: zero-based code-point index (exclusive, optional)
 */
export function codePointSlice(str: string, start: number, end?: number): string {
  const points = [...str];
  return points.slice(start, end).join('');
}

/**
 * Returns the code point at the given index.
 */
export function codePointAt(str: string, index: number): string | undefined {
  return [...str][index];
}
