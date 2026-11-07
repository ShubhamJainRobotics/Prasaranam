/**
 * Strict UTF-8 decoding and content sanitisation per SPEC Section 2A.6 item 1:
 * - Decode uploads as strict UTF-8 (fatal on invalid bytes).
 * - Strip one leading BOM.
 * - Normalise \r\n and \r to \n.
 * - Reject any NUL character and any C0 control character other than tab and newline.
 * - Do NOT apply Unicode normalisation (NFC/NFD), trimming, or whitespace collapsing;
 *   evidence must match the stored text exactly.
 */

export class IngestionError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(message: string, code = 'VALIDATION_ERROR', status = 422) {
    super(message);
    this.name = 'IngestionError';
    this.code = code;
    this.status = status;
  }
}

// C0 control characters except \t (0x09) and \n (0x0A), plus DEL (0x7F)
// Note: \r (0x0D) is normalised to \n prior to this check.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CONTROL_CHARS_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

/**
 * Sanitises and normalises raw UTF-8 buffer input.
 */
export function sanitiseBuffer(buffer: Buffer): string {
  let decoded: string;
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    decoded = decoder.decode(buffer);
  } catch {
    throw new IngestionError(
      'File contains invalid UTF-8 byte sequences or binary content',
      'VALIDATION_ERROR',
      422
    );
  }

  return sanitiseDecodedText(decoded);
}

/**
 * Sanitises and normalises decoded string input (e.g. pasted text).
 */
export function sanitiseText(text: string): string {
  return sanitiseDecodedText(text);
}

function sanitiseDecodedText(text: string): string {
  // Strip one leading BOM if present
  let result = text;
  if (result.charCodeAt(0) === 0xfeff) {
    result = result.slice(1);
  }

  // Normalise \r\n and \r to \n
  result = result.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Check for NUL and forbidden C0 control characters
  if (FORBIDDEN_CONTROL_CHARS_REGEX.test(result)) {
    throw new IngestionError(
      'Content contains forbidden control characters or NUL bytes',
      'VALIDATION_ERROR',
      422
    );
  }

  return result;
}
