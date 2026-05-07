import { describe, expect, it } from 'vitest';

import {
  asciiBytes,
  assertAsciiUpper,
  assertNumeric,
  encodeIntegerZeroFill,
  encodeIsoDate,
  exactWidth,
  leftJustifyText,
  rightJustify,
  spaces,
} from './encoding.js';
import { EncodeException } from './errors.js';

describe('assertAsciiUpper', () => {
  it('accepts uppercase, digits, and printable punctuation', () => {
    expect(() => assertAsciiUpper('HELLO 123', 'x')).not.toThrow();
    expect(() => assertAsciiUpper('Q310A', 'x')).not.toThrow();
    expect(() => assertAsciiUpper('', 'x')).not.toThrow();
  });

  it('rejects lowercase with invalid-character-class', () => {
    try {
      assertAsciiUpper('Hello', 'field.x');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(EncodeException);
      const err = (e as EncodeException).error;
      expect(err.kind).toBe('invalid-character-class');
      expect(err.path).toBe('field.x');
      if (err.kind === 'invalid-character-class') {
        expect(err.badCharIndex).toBe(1);
      }
    }
  });

  it('rejects non-ASCII (e.g. é) with invalid-character-class', () => {
    try {
      assertAsciiUpper('CAFÉ', 'x');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(EncodeException);
      const err = (e as EncodeException).error;
      expect(err.kind).toBe('invalid-character-class');
    }
  });

  it('rejects control characters (e.g. tab)', () => {
    expect(() => assertAsciiUpper('A\tB', 'x')).toThrow(EncodeException);
  });

  it('rejects a surrogate pair (emoji, non-BMP) with invalid-character-class', () => {
    // A non-BMP character (e.g. emoji) is a UTF-16 surrogate pair —
    // each half has code point 0xD800-0xDFFF, well outside printable
    // ASCII. Without this defense the encoder would silently produce
    // record bytes that mis-correlate `string.length` (code units) with
    // byte width. Pin the throw so a future "tolerate" change fails closed.
    try {
      assertAsciiUpper('A\u{1F600}', 'x');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(EncodeException);
      const err = (e as EncodeException).error;
      expect(err.kind).toBe('invalid-character-class');
    }
  });
});

describe('assertNumeric', () => {
  it('accepts digits and empty string', () => {
    expect(() => assertNumeric('123', 'x')).not.toThrow();
    expect(() => assertNumeric('', 'x')).not.toThrow();
  });

  it('rejects letters with invalid-numeric', () => {
    try {
      assertNumeric('12A', 'x');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as EncodeException).error.kind).toBe('invalid-numeric');
    }
  });

  it('rejects spaces (use space-padded variants instead)', () => {
    expect(() => assertNumeric('1 2', 'x')).toThrow(EncodeException);
  });
});

describe('leftJustifyText', () => {
  it('pads with spaces on the right', () => {
    expect(leftJustifyText('AB', 5, 'x')).toBe('AB   ');
  });

  it('returns the value as-is when it equals the width', () => {
    expect(leftJustifyText('ABCDE', 5, 'x')).toBe('ABCDE');
  });

  it('rejects over-length input', () => {
    try {
      leftJustifyText('ABCDEF', 5, 'field.x');
      throw new Error('should have thrown');
    } catch (e) {
      const err = (e as EncodeException).error;
      expect(err.kind).toBe('field-too-long');
      expect(err.path).toBe('field.x');
    }
  });

  it('returns all-spaces for empty input', () => {
    expect(leftJustifyText('', 4, 'x')).toBe('    ');
  });
});

describe('rightJustify', () => {
  it("pads with '0' for numeric fields", () => {
    expect(rightJustify('42', 6, '0', 'x')).toBe('000042');
  });

  it("pads with ' ' for blank-fillable fields", () => {
    expect(rightJustify('42', 6, ' ', 'x')).toBe('    42');
  });

  it("rejects non-digit input when padding with '0'", () => {
    try {
      rightJustify('4A', 4, '0', 'x');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as EncodeException).error.kind).toBe('invalid-numeric');
    }
  });

  it('rejects over-length input', () => {
    expect(() => rightJustify('123456', 4, '0', 'x')).toThrow(EncodeException);
  });
});

describe('exactWidth', () => {
  it('returns the value when length matches', () => {
    expect(exactWidth('HCP', 3, 'x')).toBe('HCP');
  });

  it('rejects too-short input with field-wrong-width', () => {
    try {
      exactWidth('HC', 3, 'payProgram');
      throw new Error('should have thrown');
    } catch (e) {
      const err = (e as EncodeException).error;
      expect(err.kind).toBe('field-wrong-width');
      if (err.kind === 'field-wrong-width') {
        expect(err.expectedWidth).toBe(3);
        expect(err.actualWidth).toBe(2);
      }
    }
  });

  it('rejects too-long input with field-wrong-width (not field-too-long)', () => {
    try {
      exactWidth('HCPX', 3, 'x');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as EncodeException).error.kind).toBe('field-wrong-width');
    }
  });

  it('still validates character class on exact-width values', () => {
    expect(() => exactWidth('hcp', 3, 'x')).toThrow(EncodeException);
  });
});

describe('encodeIsoDate', () => {
  it('strips dashes from valid ISO date', () => {
    expect(encodeIsoDate('2026-04-19', 'x')).toBe('20260419');
  });

  it('returns 8 spaces for empty string', () => {
    expect(encodeIsoDate('', 'x')).toBe('        ');
  });

  it('rejects non-ISO format with invalid-date', () => {
    try {
      encodeIsoDate('04/19/2026', 'serviceDate');
      throw new Error('should have thrown');
    } catch (e) {
      const err = (e as EncodeException).error;
      expect(err.kind).toBe('invalid-date');
      expect(err.path).toBe('serviceDate');
    }
  });

  it('rejects year-month-day component out of range', () => {
    expect(() => encodeIsoDate('2026-13-01', 'x')).toThrow(EncodeException);
    expect(() => encodeIsoDate('2026-04-32', 'x')).toThrow(EncodeException);
    expect(() => encodeIsoDate('2026-00-15', 'x')).toThrow(EncodeException);
  });

  it('rejects partially-numeric input', () => {
    expect(() => encodeIsoDate('20XX-04-19', 'x')).toThrow(EncodeException);
  });
});

describe('encodeIntegerZeroFill', () => {
  it('zero-fills a small integer', () => {
    expect(encodeIntegerZeroFill(42, 6, 'x')).toBe('000042');
  });

  it('handles zero', () => {
    expect(encodeIntegerZeroFill(0, 4, 'x')).toBe('0000');
  });

  it('handles a value matching the full width', () => {
    expect(encodeIntegerZeroFill(999_999, 6, 'x')).toBe('999999');
  });

  it('rejects negative integers', () => {
    expect(() => encodeIntegerZeroFill(-1, 4, 'x')).toThrow(EncodeException);
  });

  it('rejects non-integer numbers', () => {
    expect(() => encodeIntegerZeroFill(1.5, 4, 'x')).toThrow(EncodeException);
  });

  it('rejects values that overflow the field width', () => {
    try {
      encodeIntegerZeroFill(1_000_000, 6, 'feeSubmittedCents');
      throw new Error('should have thrown');
    } catch (e) {
      const err = (e as EncodeException).error;
      expect(err.kind).toBe('field-too-long');
    }
  });
});

describe('spaces', () => {
  it('returns N space characters', () => {
    expect(spaces(5)).toBe('     ');
    expect(spaces(0)).toBe('');
  });
});

describe('asciiBytes', () => {
  it('encodes 7-bit ASCII to a Uint8Array of equal length', () => {
    const bytes = asciiBytes('HE');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(2);
    expect(bytes[0]).toBe(0x48);
    expect(bytes[1]).toBe(0x45);
  });

  it('preserves space and digit byte values', () => {
    const bytes = asciiBytes(' 0');
    expect(bytes[0]).toBe(0x20);
    expect(bytes[1]).toBe(0x30);
  });
});
