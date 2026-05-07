/**
 * Smoke tests for the contract package data shapes. These aren't validation
 * tests — they exist to keep the package compiling against its own public
 * API surface and catch unintended type-shape changes via TS errors at
 * `pnpm typecheck`.
 */

import { describe, expect, it } from 'vitest';

import {
  asBatchItemIndex,
  isBlockingFinding,
  isoDateToUtcMs,
  parseIsoDate,
} from './index.js';
import type {
  ClaimBatch,
  ClaimItem,
  Jurisdiction,
  PatientReference,
  RenderedClaim,
  ServicePeriod,
  Severity,
  SubmitterIdentity,
  ValidationReport,
  ValidationViolation,
} from './index.js';

describe('contract types', () => {
  it('non-patient claim item (Q310-Q313 hourly) compiles', () => {
    const item: ClaimItem = {
      serviceDate: '2026-04-15',
      feeCode: 'Q313A',
      units: 4,
      feeSubmittedCents: 8000,
    };
    expect(item.units).toBe(4);
    expect(item.patient).toBeUndefined();
  });

  it('patient-linked claim item compiles', () => {
    const patient: PatientReference = {
      healthNumber: '1234567890',
      versionCode: 'AB',
      dateOfBirth: '1980-05-12',
    };
    const item: ClaimItem = {
      serviceDate: '2026-04-15',
      feeCode: 'A007A',
      units: 1,
      feeSubmittedCents: 3995,
      patient,
      diagnosticCode: 'V20',
    };
    expect(item.patient?.healthNumber).toBe('1234567890');
  });

  it('claim batch wires submitter, period, items', () => {
    const period: ServicePeriod = { start: '2026-04-19', end: '2026-05-18' };
    const batch: ClaimBatch = {
      submitterId: '00000000-0000-0000-0000-000000000000',
      servicePeriod: period,
      items: [],
    };
    expect(batch.servicePeriod.start).toBe('2026-04-19');
    expect(batch.items).toHaveLength(0);
  });

  it('submitter identity carries jurisdiction-specific identifiers', () => {
    const submitter: SubmitterIdentity = {
      id: '00000000-0000-0000-0000-000000000000',
      jurisdiction: 'ontario-mcedt',
      displayName: 'Sample FHO Group',
      identifiers: {
        groupNumber: '0A12',
        mohOfficeCode: 'A',
      },
    };
    expect(submitter.identifiers.groupNumber).toBe('0A12');
  });

  it('validation report aggregates violations with stable codes', () => {
    const violation: ValidationViolation = {
      severity: 'error',
      code: 'missing-group-number',
      message: 'Submitter is missing required identifier `groupNumber`.',
      path: 'submitter.identifiers.groupNumber',
    };
    const report: ValidationReport = { violations: [violation] };
    expect(report.violations[0]?.code).toBe('missing-group-number');
  });

  it('rendered claim carries jurisdiction + bytes + content hash', () => {
    const rendered: RenderedClaim = {
      jurisdiction: 'ontario-mcedt',
      bytes: new Uint8Array([72, 69, 66]),
      byteCount: 3,
      contentHashSha256Hex: 'abcdef',
    };
    expect(rendered.byteCount).toBe(3);
    expect(rendered.bytes.byteLength).toBe(3);
  });

  it('jurisdiction is open-string-set for future regions', () => {
    const known: Jurisdiction = 'ontario-mcedt';
    const future: Jurisdiction = 'bc-msp' as Jurisdiction;
    expect(known).toBe('ontario-mcedt');
    expect(future).toBe('bc-msp');
  });

  it('severity values are exactly error or warning', () => {
    const error: Severity = 'error';
    const warning: Severity = 'warning';
    expect([error, warning]).toEqual(['error', 'warning']);
  });
});

describe('parseIsoDate', () => {
  it('accepts a well-formed YYYY-MM-DD and returns the branded value', () => {
    const result = parseIsoDate('2026-04-19');
    expect(result).toBe('2026-04-19');
  });

  it('accepts the leap-day 2024-02-29', () => {
    expect(parseIsoDate('2024-02-29')).toBe('2024-02-29');
  });

  it('rejects Feb 30 via calendar round-trip', () => {
    expect(parseIsoDate('2024-02-30')).toBeNull();
  });

  it('rejects Apr 31 via calendar round-trip', () => {
    expect(parseIsoDate('2024-04-31')).toBeNull();
  });

  it('rejects month=13 / month=00', () => {
    expect(parseIsoDate('2024-13-01')).toBeNull();
    expect(parseIsoDate('2024-00-15')).toBeNull();
  });

  it('rejects day=00 / day=32', () => {
    expect(parseIsoDate('2024-04-00')).toBeNull();
    expect(parseIsoDate('2024-04-32')).toBeNull();
  });

  it('rejects non-zero-padded components', () => {
    expect(parseIsoDate('2024-4-19')).toBeNull();
    expect(parseIsoDate('2024-04-9')).toBeNull();
  });

  it('rejects datetime / extra characters / leading whitespace', () => {
    expect(parseIsoDate('2024-04-19T00:00:00Z')).toBeNull();
    expect(parseIsoDate(' 2024-04-19')).toBeNull();
    expect(parseIsoDate('2024-04-19 ')).toBeNull();
  });

  it('rejects empty string', () => {
    expect(parseIsoDate('')).toBeNull();
  });

  it('rejects non-leap-year Feb 29', () => {
    expect(parseIsoDate('2023-02-29')).toBeNull();
  });
});

describe('isoDateToUtcMs', () => {
  it('round-trips epoch zero (1970-01-01) → 0', () => {
    const date = parseIsoDate('1970-01-01')!;
    expect(isoDateToUtcMs(date)).toBe(0);
  });

  it('produces UTC midnight (no local-tz drift)', () => {
    const date = parseIsoDate('2026-05-06')!;
    expect(isoDateToUtcMs(date)).toBe(Date.UTC(2026, 4, 6));
  });

  it('handles leap day 2024-02-29 correctly', () => {
    const date = parseIsoDate('2024-02-29')!;
    expect(isoDateToUtcMs(date)).toBe(Date.UTC(2024, 1, 29));
  });

  it('throws on a forged brand (non YYYY-MM-DD shape)', () => {
    expect(() => isoDateToUtcMs('garbage' as unknown as ReturnType<typeof parseIsoDate> & string)).toThrow(/IsoDate brand violated/);
  });
});

describe('isBlockingFinding', () => {
  it('blocks errors', () => {
    expect(isBlockingFinding('error')).toBe(true);
  });

  it('does not block warnings', () => {
    expect(isBlockingFinding('warning')).toBe(false);
  });

  it('throws on a future severity bypassed via cast (fail-loud, not silent return)', () => {
    expect(() => isBlockingFinding('info' as Severity)).toThrow(/unhandled Severity/);
  });
});

describe('asBatchItemIndex', () => {
  it('brands non-negative integers', () => {
    expect(asBatchItemIndex(0)).toBe(0);
    expect(asBatchItemIndex(42)).toBe(42);
  });

  it('rejects negatives, NaN, Infinity, floats', () => {
    expect(asBatchItemIndex(-1)).toBeNull();
    expect(asBatchItemIndex(Number.NaN)).toBeNull();
    expect(asBatchItemIndex(Infinity)).toBeNull();
    expect(asBatchItemIndex(1.5)).toBeNull();
  });
});
