import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { EncodeException } from './errors.js';
import { encodeTrailer, type TrailerInput } from './trailer.js';

const exampleCounts: TrailerInput = {
  claimHeaderCount: 12,
  herRecordCount: 0,
  itemRecordCount: 47,
};

function decode(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

describe('encodeTrailer', () => {
  it('produces a 79-byte record', () => {
    expect(encodeTrailer(exampleCounts).length).toBe(79);
  });

  it('places fields at the spec-defined positions (golden bytes)', () => {
    const record = decode(encodeTrailer(exampleCounts));

    expect(record.slice(0, 2)).toBe('HE');
    expect(record.slice(2, 3)).toBe('E');
    expect(record.slice(3, 7)).toBe('0012');
    expect(record.slice(7, 11)).toBe('0000');
    expect(record.slice(11, 16)).toBe('00047');
    expect(record.slice(16, 79)).toBe(' '.repeat(63));
  });

  it('zero-fills max-width counts', () => {
    const record = decode(
      encodeTrailer({
        claimHeaderCount: 9999,
        herRecordCount: 9999,
        itemRecordCount: 99_999,
      }),
    );
    expect(record.slice(3, 7)).toBe('9999');
    expect(record.slice(7, 11)).toBe('9999');
    expect(record.slice(11, 16)).toBe('99999');
  });

  it('rejects counts that overflow their field width', () => {
    expect(() =>
      encodeTrailer({ ...exampleCounts, claimHeaderCount: 10_000 }),
    ).toThrow(EncodeException);
    expect(() =>
      encodeTrailer({ ...exampleCounts, itemRecordCount: 100_000 }),
    ).toThrow(EncodeException);
  });

  it('rejects negative counts', () => {
    expect(() =>
      encodeTrailer({ ...exampleCounts, herRecordCount: -1 }),
    ).toThrow(EncodeException);
  });

  it('rejects non-integer counts', () => {
    expect(() =>
      encodeTrailer({ ...exampleCounts, claimHeaderCount: 1.5 }),
    ).toThrow(EncodeException);
  });

  it('is deterministic — same input → byte-equal output', () => {
    const a = encodeTrailer(exampleCounts);
    const b = encodeTrailer({ ...exampleCounts });
    expect(a).toEqual(b);
  });
});

describe('encodeTrailer — property tests', () => {
  const arbInput: fc.Arbitrary<TrailerInput> = fc.record({
    claimHeaderCount: fc.integer({ min: 0, max: 9999 }),
    herRecordCount: fc.integer({ min: 0, max: 9999 }),
    itemRecordCount: fc.integer({ min: 0, max: 99_999 }),
  });

  it('always produces exactly 79 bytes for any valid input', () => {
    fc.assert(
      fc.property(arbInput, (input) => encodeTrailer(input).length === 79),
    );
  });

  it('output bytes are always 7-bit printable ASCII', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const bytes = encodeTrailer(input);
        for (const b of bytes) if (b < 0x20 || b > 0x7e) return false;
        return true;
      }),
    );
  });
});
