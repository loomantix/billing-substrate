/**
 * Field-level encoding primitives shared by every record encoder.
 *
 * MCEDT records are fixed-width 7-bit ASCII. Helpers here:
 * - validate the input character class (printable ASCII, no lowercase),
 * - justify and pad to the field's exact width,
 * - convert ISO 8601 dates to the wire `YYYYMMDD` form,
 * - convert a final assembled string to its `Uint8Array` byte form.
 *
 * Helpers throw `EncodeException` with a discriminated `EncodeError`
 * payload on any violation. They never silently truncate.
 */

import {
  EncodeException,
  type FieldTooLongError,
  type FieldWrongWidthError,
  type InvalidCharacterClassError,
  type InvalidDateError,
  type InvalidNumericError,
} from './errors.js';

const ASCII_SPACE = 0x20;
const ASCII_TILDE = 0x7e;
const ASCII_LOWERCASE_A = 0x61;
const ASCII_LOWERCASE_Z = 0x7a;
const ASCII_DIGIT_0 = 0x30;
const ASCII_DIGIT_9 = 0x39;

/**
 * Reject any character outside printable ASCII (0x20–0x7E) or any lowercase
 * letter. The MCEDT format requires uppercase alpha; lowercase is rejected
 * loudly rather than silently upper-cased so the caller sees the source of
 * the bad data.
 */
export function assertAsciiUpper(value: string, path: string): void {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < ASCII_SPACE || code > ASCII_TILDE) {
      const error: InvalidCharacterClassError = {
        kind: 'invalid-character-class',
        path,
        value,
        badCharCode: code,
        badCharIndex: i,
        message: `non-printable or non-ASCII character at index ${i} (code ${code})`,
      };
      throw new EncodeException(error);
    }
    if (code >= ASCII_LOWERCASE_A && code <= ASCII_LOWERCASE_Z) {
      const error: InvalidCharacterClassError = {
        kind: 'invalid-character-class',
        path,
        value,
        badCharCode: code,
        badCharIndex: i,
        message: `lowercase character '${value[i]}' at index ${i}; MCEDT requires uppercase`,
      };
      throw new EncodeException(error);
    }
  }
}

/** Reject any character that is not an ASCII digit `0`–`9`. */
export function assertNumeric(value: string, path: string): void {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < ASCII_DIGIT_0 || code > ASCII_DIGIT_9) {
      const error: InvalidNumericError = {
        kind: 'invalid-numeric',
        path,
        value,
        message: `non-digit character at index ${i}`,
      };
      throw new EncodeException(error);
    }
  }
}

function assertNotTooLong(value: string, width: number, path: string): void {
  if (value.length > width) {
    const error: FieldTooLongError = {
      kind: 'field-too-long',
      path,
      value,
      width,
      message: `value of length ${value.length} exceeds field width ${width}`,
    };
    throw new EncodeException(error);
  }
}

/**
 * Left-justify `value` in a field of `width` chars, padding the right with
 * spaces. Validates ASCII-uppercase. Throws on over-length input.
 *
 * Used for HIN, version code, service location, diagnostic code, etc.
 */
export function leftJustifyText(value: string, width: number, path: string): string {
  assertAsciiUpper(value, path);
  assertNotTooLong(value, width, path);
  return value + ' '.repeat(width - value.length);
}

/**
 * Right-justify `value` in a field of `width` chars, padding the left with
 * `padChar`. Throws on over-length input.
 *
 * - `padChar = '0'` → numeric fields (`assertNumeric` enforced).
 * - `padChar = ' '` → optional-numeric / mixed fields where MCEDT permits
 *   blank-fill (e.g. referring provider, facility number).
 */
export function rightJustify(
  value: string,
  width: number,
  padChar: '0' | ' ',
  path: string,
): string {
  if (padChar === '0') {
    assertNumeric(value, path);
  } else {
    assertAsciiUpper(value, path);
  }
  assertNotTooLong(value, width, path);
  return padChar.repeat(width - value.length) + value;
}

/**
 * Encode an exact-width field — the value must be exactly `width` chars.
 * Used for the literal record prefix (`HE`/`B`/`H`/`T`/`E`) and for fields
 * whose length is part of the contract (group number = 4, provider reg
 * number = 6, specialty = 2, MOH office = 1, spec version = 3).
 */
export function exactWidth(value: string, width: number, path: string): string {
  if (value.length !== width) {
    const error: FieldWrongWidthError = {
      kind: 'field-wrong-width',
      path,
      value,
      expectedWidth: width,
      actualWidth: value.length,
      message: `value of length ${value.length} does not match required width ${width}`,
    };
    throw new EncodeException(error);
  }
  assertAsciiUpper(value, path);
  return value;
}

/**
 * Convert an ISO 8601 date string (`YYYY-MM-DD`) to the MCEDT wire form
 * (`YYYYMMDD`, 8 digits). Empty input returns 8 spaces — the format ref
 * specifies blank-padded dates for unpopulated optional dates and for
 * Q310-Q313 hourly claims that omit DoB.
 *
 * Validates: full ISO shape, all digits after dash-strip, plausible
 * year/month/day ranges. Does NOT validate calendar correctness (e.g.
 * Feb 30) — out of scope for an encoder; validators catch that.
 */
export function encodeIsoDate(value: string, path: string): string {
  if (value === '') return '        ';
  const isoPattern = /^(\d{4})-(\d{2})-(\d{2})$/;
  const match = isoPattern.exec(value);
  if (!match) {
    const error: InvalidDateError = {
      kind: 'invalid-date',
      path,
      value,
      message: `expected YYYY-MM-DD (or empty for unpopulated), got ${JSON.stringify(value)}`,
    };
    throw new EncodeException(error);
  }
  const yearStr = match[1] as string;
  const monthStr = match[2] as string;
  const dayStr = match[3] as string;
  const month = Number.parseInt(monthStr, 10);
  const day = Number.parseInt(dayStr, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    const error: InvalidDateError = {
      kind: 'invalid-date',
      path,
      value,
      message: `month=${month} or day=${day} out of plausible range`,
    };
    throw new EncodeException(error);
  }
  return `${yearStr}${monthStr}${dayStr}`;
}

/**
 * Encode a non-negative integer as a right-justified zero-filled numeric
 * field of `width` chars. Throws if the integer needs more than `width`
 * digits.
 */
export function encodeIntegerZeroFill(value: number, width: number, path: string): string {
  if (!Number.isInteger(value) || value < 0) {
    const error: InvalidNumericError = {
      kind: 'invalid-numeric',
      path,
      value: String(value),
      message: `expected a non-negative integer, got ${value}`,
    };
    throw new EncodeException(error);
  }
  const digits = String(value);
  if (digits.length > width) {
    const error: FieldTooLongError = {
      kind: 'field-too-long',
      path,
      value: digits,
      width,
      message: `integer ${value} requires ${digits.length} digits, exceeds field width ${width}`,
    };
    throw new EncodeException(error);
  }
  return '0'.repeat(width - digits.length) + digits;
}

/**
 * Encode a fixed-length space-fill field. Used purely for record fillers.
 */
export function spaces(width: number): string {
  return ' '.repeat(width);
}

/**
 * Convert an assembled record string (which is guaranteed by the encoder
 * primitives to be 7-bit ASCII) to its byte form.
 */
export function asciiBytes(record: string): Uint8Array {
  const bytes = new Uint8Array(record.length);
  for (let i = 0; i < record.length; i++) {
    bytes[i] = record.charCodeAt(i);
  }
  return bytes;
}
