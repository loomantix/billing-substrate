import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { encodeBatchHeader, type BatchHeaderInput } from './batch-header.js';
import { EncodeException } from './errors.js';

const validInput: BatchHeaderInput = {
  specVersion: '003',
  mohOfficeCode: '7',
  batchId: '202604190001',
  groupNumber: '0A12',
  providerRegNumber: '012345',
  specialtyCode: '00',
};

function decode(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

describe('encodeBatchHeader', () => {
  it('produces a 79-byte record', () => {
    const bytes = encodeBatchHeader(validInput);
    expect(bytes.length).toBe(79);
  });

  it('places fields at the spec-defined positions (golden bytes)', () => {
    const record = decode(encodeBatchHeader(validInput));

    expect(record.slice(0, 2)).toBe('HE');
    expect(record.slice(2, 3)).toBe('B');
    expect(record.slice(3, 6)).toBe('003');
    expect(record.slice(6, 7)).toBe('7');
    expect(record.slice(7, 19)).toBe('202604190001');
    expect(record.slice(19, 25)).toBe('      ');
    expect(record.slice(25, 29)).toBe('0A12');
    expect(record.slice(29, 35)).toBe('012345');
    expect(record.slice(35, 37)).toBe('00');
    expect(record.slice(37, 79)).toBe(' '.repeat(42));
  });

  it('rejects mohOfficeCode with wrong width', () => {
    try {
      encodeBatchHeader({ ...validInput, mohOfficeCode: '07' });
      throw new Error('should have thrown');
    } catch (e) {
      const err = (e as EncodeException).error;
      expect(err.kind).toBe('field-wrong-width');
      expect(err.path).toBe('mohOfficeCode');
    }
  });

  it('rejects batchId with wrong width', () => {
    expect(() =>
      encodeBatchHeader({ ...validInput, batchId: 'TOOSHORT' }),
    ).toThrow(EncodeException);
  });

  it('rejects lowercase in groupNumber', () => {
    try {
      encodeBatchHeader({ ...validInput, groupNumber: '0a12' });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as EncodeException).error.kind).toBe('invalid-character-class');
    }
  });

  it('rejects non-digit providerRegNumber via wrong-width then char-class chain', () => {
    expect(() =>
      encodeBatchHeader({ ...validInput, providerRegNumber: '12345' }),
    ).toThrow(EncodeException);
  });

  it('is deterministic — same input → byte-equal output', () => {
    const a = encodeBatchHeader(validInput);
    const b = encodeBatchHeader({ ...validInput });
    expect(a).toEqual(b);
  });
});

describe('encodeBatchHeader — property tests', () => {
  const arbInput: fc.Arbitrary<BatchHeaderInput> = fc.record({
    specVersion: fc
      .stringMatching(/^[A-Z0-9]{3}$/)
      .filter((s) => s.length === 3),
    mohOfficeCode: fc
      .stringMatching(/^[A-Z0-9]$/)
      .filter((s) => s.length === 1),
    batchId: fc
      .stringMatching(/^[A-Z0-9]{12}$/)
      .filter((s) => s.length === 12),
    groupNumber: fc
      .stringMatching(/^[A-Z0-9]{4}$/)
      .filter((s) => s.length === 4),
    providerRegNumber: fc
      .stringMatching(/^\d{6}$/)
      .filter((s) => s.length === 6),
    specialtyCode: fc.stringMatching(/^\d{2}$/).filter((s) => s.length === 2),
  });

  it('always produces exactly 79 bytes for any valid input', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const bytes = encodeBatchHeader(input);
        return bytes.length === 79;
      }),
    );
  });

  it('output bytes are always 7-bit printable ASCII', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const bytes = encodeBatchHeader(input);
        for (const b of bytes) {
          if (b < 0x20 || b > 0x7e) return false;
        }
        return true;
      }),
    );
  });
});
