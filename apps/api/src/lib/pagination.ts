export function encodeCursor(sortKey: string | number | Date, id: string): string {
  const val = sortKey instanceof Date ? sortKey.toISOString() : sortKey;
  const payload = JSON.stringify([val, id]);
  return Buffer.from(payload).toString('base64url');
}

export function decodeCursor(cursor?: string): [string | number, string] | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length === 2) {
      return parsed as [string | number, string];
    }
    return null;
  } catch {
    return null;
  }
}
