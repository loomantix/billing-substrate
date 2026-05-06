import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { EncodeException } from './errors.js';
import { encodeItemRecord, type ItemRecordInput } from './item-record.js';

const q310Item: ItemRecordInput = {
  serviceCode: 'Q310A',
  feeSubmittedCents: 8000,
  units: 4,
  serviceDate: '2026-04-19',
  diagnosticCode: '',
};

function decode(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

describe('encodeItemRecord', () => {
  it('produces a 79-byte record', () => {
    expect(encodeItemRecord(q310Item).length).toBe(79);
  });

  it('places fields at the spec-defined positions (golden bytes)', () => {
    const record = decode(encodeItemRecord(q310Item));

    expect(record.slice(0, 2)).toBe('HE');
    expect(record.slice(2, 3)).toBe('T');
    expect(record.slice(3, 8)).toBe('Q310A');
    expect(record.slice(8, 10)).toBe('  ');
    expect(record.slice(10, 16)).toBe('008000');
    expect(record.slice(16, 18)).toBe('04');
    expect(record.slice(18, 26)).toBe('20260419');
    expect(record.slice(26, 30)).toBe('    ');
    expect(record.slice(30, 79)).toBe(' '.repeat(49));
  });

  it('encodes a diagnostic code left-justified', () => {
    const record = decode(
      encodeItemRecord({ ...q310Item, diagnosticCode: '799' }),
    );
    expect(record.slice(26, 30)).toBe('799 ');
  });

  it('rejects serviceCode with wrong width', () => {
    expect(() =>
      encodeItemRecord({ ...q310Item, serviceCode: 'Q310' }),
    ).toThrow(EncodeException);
    expect(() =>
      encodeItemRecord({ ...q310Item, serviceCode: 'Q310AB' }),
    ).toThrow(EncodeException);
  });

  it('rejects empty serviceDate (required)', () => {
    try {
      encodeItemRecord({ ...q310Item, serviceDate: '' });
      throw new Error('should have thrown');
    } catch (e) {
      const err = (e as EncodeException).error;
      expect(err.kind).toBe('invalid-date');
      expect(err.path).toBe('serviceDate');
    }
  });

  it('rejects fee that overflows 6 digits', () => {
    expect(() =>
      encodeItemRecord({ ...q310Item, feeSubmittedCents: 1_000_000 }),
    ).toThrow(EncodeException);
  });

  it('rejects negative fee', () => {
    expect(() =>
      encodeItemRecord({ ...q310Item, feeSubmittedCents: -1 }),
    ).toThrow(EncodeException);
  });

  it('rejects units > 99', () => {
    expect(() => encodeItemRecord({ ...q310Item, units: 100 })).toThrow(
      EncodeException,
    );
  });

  it('rejects lowercase in serviceCode', () => {
    try {
      encodeItemRecord({ ...q310Item, serviceCode: 'q310a' });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as EncodeException).error.kind).toBe('invalid-character-class');
    }
  });

  it('is deterministic — same input → byte-equal output', () => {
    const a = encodeItemRecord(q310Item);
    const b = encodeItemRecord({ ...q310Item });
    expect(a).toEqual(b);
  });
});

describe('encodeItemRecord — property tests', () => {
  const arbInput: fc.Arbitrary<ItemRecordInput> = fc.record({
    serviceCode: fc.constantFrom('Q310A', 'Q311A', 'Q312A', 'Q313A', 'A007A'),
    feeSubmittedCents: fc.integer({ min: 0, max: 999_999 }),
    units: fc.integer({ min: 0, max: 99 }),
    serviceDate: fc.constantFrom('2026-04-19', '2026-04-20', '2025-12-31'),
    diagnosticCode: fc.constantFrom('', '799', 'V70'),
  });

  it('always produces exactly 79 bytes for any valid input', () => {
    fc.assert(
      fc.property(arbInput, (input) => encodeItemRecord(input).length === 79),
    );
  });

  it('output bytes are always 7-bit printable ASCII', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const bytes = encodeItemRecord(input);
        for (const b of bytes) if (b < 0x20 || b > 0x7e) return false;
        return true;
      }),
    );
  });

  it('record always begins with "HET"', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const bytes = encodeItemRecord(input);
        return bytes[0] === 0x48 && bytes[1] === 0x45 && bytes[2] === 0x54;
      }),
    );
  });
});
