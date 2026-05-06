import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { encodeClaimHeader, type ClaimHeaderInput } from './claim-header.js';
import { EncodeException } from './errors.js';

const patientLinked: ClaimHeaderInput = {
  hin: '1234567890',
  versionCode: 'AB',
  dateOfBirth: '1980-04-19',
  accountingNumber: 42,
  payProgram: 'HCP',
  payee: 'P',
  referringProvider: '',
  facilityNumber: '',
  admissionDate: '',
  referringLabNumber: '',
  manualReview: false,
  serviceLocation: '',
};

const q310Hourly: ClaimHeaderInput = {
  hin: '',
  versionCode: '',
  dateOfBirth: '',
  accountingNumber: 1,
  payProgram: 'HCP',
  payee: 'P',
  referringProvider: '',
  facilityNumber: '',
  admissionDate: '',
  referringLabNumber: '',
  manualReview: false,
  serviceLocation: '',
};

function decode(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

describe('encodeClaimHeader', () => {
  it('produces a 79-byte record for a patient-linked claim', () => {
    const bytes = encodeClaimHeader(patientLinked);
    expect(bytes.length).toBe(79);
  });

  it('produces a 79-byte record for Q310-Q313 (HIN/version/DoB blank)', () => {
    const bytes = encodeClaimHeader(q310Hourly);
    expect(bytes.length).toBe(79);
  });

  it('places fields at the spec-defined positions (patient-linked golden bytes)', () => {
    const record = decode(encodeClaimHeader(patientLinked));

    expect(record.slice(0, 2)).toBe('HE');
    expect(record.slice(2, 3)).toBe('H');
    expect(record.slice(3, 13)).toBe('1234567890');
    expect(record.slice(13, 15)).toBe('AB');
    expect(record.slice(15, 23)).toBe('19800419');
    expect(record.slice(23, 31)).toBe('00000042');
    expect(record.slice(31, 34)).toBe('HCP');
    expect(record.slice(34, 35)).toBe('P');
    expect(record.slice(35, 41)).toBe('      ');
    expect(record.slice(41, 45)).toBe('    ');
    expect(record.slice(45, 53)).toBe('        ');
    expect(record.slice(53, 57)).toBe('    ');
    expect(record.slice(57, 58)).toBe(' ');
    expect(record.slice(58, 62)).toBe('    ');
    expect(record.slice(62, 79)).toBe(' '.repeat(17));
  });

  it('blanks HIN, version, and DoB fields for Q310-Q313 hourly claims', () => {
    const record = decode(encodeClaimHeader(q310Hourly));
    expect(record.slice(3, 13)).toBe('          ');
    expect(record.slice(13, 15)).toBe('  ');
    expect(record.slice(15, 23)).toBe('        ');
  });

  it('emits Y at position 58 when manualReview is true', () => {
    const record = decode(
      encodeClaimHeader({ ...patientLinked, manualReview: true }),
    );
    expect(record.slice(57, 58)).toBe('Y');
  });

  it('rejects invalid payee value', () => {
    try {
      encodeClaimHeader({ ...patientLinked, payee: 'X' as 'P' });
      throw new Error('should have thrown');
    } catch (e) {
      const err = (e as EncodeException).error;
      expect(err.kind).toBe('field-wrong-width');
      expect(err.path).toBe('payee');
    }
  });

  it('rejects payProgram with wrong width', () => {
    expect(() =>
      encodeClaimHeader({ ...patientLinked, payProgram: 'HC' }),
    ).toThrow(EncodeException);
    expect(() =>
      encodeClaimHeader({ ...patientLinked, payProgram: 'HCPX' }),
    ).toThrow(EncodeException);
  });

  it('rejects HIN longer than 10 chars', () => {
    try {
      encodeClaimHeader({ ...patientLinked, hin: '12345678901' });
      throw new Error('should have thrown');
    } catch (e) {
      const err = (e as EncodeException).error;
      expect(err.kind).toBe('field-too-long');
      expect(err.path).toBe('hin');
    }
  });

  it('rejects malformed dateOfBirth', () => {
    expect(() =>
      encodeClaimHeader({ ...patientLinked, dateOfBirth: '1980/04/19' }),
    ).toThrow(EncodeException);
  });

  it('rejects accountingNumber that overflows 8 digits', () => {
    expect(() =>
      encodeClaimHeader({ ...patientLinked, accountingNumber: 100_000_000 }),
    ).toThrow(EncodeException);
  });

  it('is deterministic — same input → byte-equal output', () => {
    const a = encodeClaimHeader(patientLinked);
    const b = encodeClaimHeader({ ...patientLinked });
    expect(a).toEqual(b);
  });
});

describe('encodeClaimHeader — property tests', () => {
  const arbInput: fc.Arbitrary<ClaimHeaderInput> = fc.record({
    hin: fc.constantFrom('', '1234567890', '0000000001'),
    versionCode: fc.constantFrom('', 'AB', 'XY'),
    dateOfBirth: fc.constantFrom('', '1980-04-19', '2000-12-31'),
    accountingNumber: fc.integer({ min: 0, max: 99_999_999 }),
    payProgram: fc.constantFrom('HCP', 'RMB', 'WCB'),
    payee: fc.constantFrom<'P' | 'S'>('P', 'S'),
    referringProvider: fc.constantFrom('', '012345'),
    facilityNumber: fc.constantFrom('', '7777'),
    admissionDate: fc.constantFrom('', '2026-04-19'),
    referringLabNumber: fc.constantFrom('', '0001'),
    manualReview: fc.boolean(),
    serviceLocation: fc.constantFrom('', 'HOSP', 'OFFC'),
  });

  it('always produces exactly 79 bytes for any valid input', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const bytes = encodeClaimHeader(input);
        return bytes.length === 79;
      }),
    );
  });

  it('output bytes are always 7-bit printable ASCII', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const bytes = encodeClaimHeader(input);
        for (const b of bytes) {
          if (b < 0x20 || b > 0x7e) return false;
        }
        return true;
      }),
    );
  });
});
