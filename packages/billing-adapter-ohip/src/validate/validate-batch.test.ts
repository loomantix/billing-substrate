import type {
  ClaimBatch,
  ClaimItem,
  PatientReference,
  ValidationViolation,
} from '@loomantix/billing-adapter';
import { describe, expect, it } from 'vitest';

import type { OntarioMcedtConfig } from '../emit/emit-claim-file.js';

import { validateBatch } from './validate-batch.js';

const NOW = new Date('2026-05-04T00:00:00Z');

const validConfig: OntarioMcedtConfig = {
  specVersion: '003',
  identifiers: {
    groupNumber: '0A12',
    mohOfficeCode: '7',
    providerRegNumber: '012345',
    specialtyCode: '00',
  },
  batchId: '202604190001',
};

function q310Item(overrides: Partial<ClaimItem> = {}): ClaimItem {
  return {
    serviceDate: '2026-04-19',
    feeCode: 'Q310A',
    units: 4,
    feeSubmittedCents: 8000,
    ...overrides,
  };
}

function batchOf(items: ClaimItem[]): ClaimBatch {
  return {
    submitterId: 'group-0A12',
    servicePeriod: { start: '2026-04-19', end: '2026-05-04' },
    items,
  };
}

function codes(violations: readonly ValidationViolation[]): string[] {
  return violations.map((v) => v.code);
}

function find(
  violations: readonly ValidationViolation[],
  code: string,
): ValidationViolation | undefined {
  return violations.find((v) => v.code === code);
}

describe('validateBatch — happy path', () => {
  it('produces zero error-severity violations for a clean Q-code batch', () => {
    const report = validateBatch(
      batchOf([q310Item()]),
      validConfig,
      { now: NOW },
    );
    const errors = report.violations.filter((v) => v.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('produces zero violations for a clean batch using only known fee codes', () => {
    const report = validateBatch(
      batchOf([q310Item({ feeCode: 'Q310A' }), q310Item({ feeCode: 'Q313A' })]),
      validConfig,
      { now: NOW },
    );
    expect(report.violations).toHaveLength(0);
  });
});

describe('validateBatch — submitter-level checks', () => {
  it('flags missing groupNumber', () => {
    const report = validateBatch(
      batchOf([q310Item()]),
      { ...validConfig, identifiers: { ...validConfig.identifiers, groupNumber: '' } },
      { now: NOW },
    );
    expect(codes(report.violations)).toContain('missing-group-number');
  });

  it('flags wrong-width groupNumber', () => {
    const report = validateBatch(
      batchOf([q310Item()]),
      { ...validConfig, identifiers: { ...validConfig.identifiers, groupNumber: 'ABC' } },
      { now: NOW },
    );
    expect(codes(report.violations)).toContain('invalid-group-number-width');
  });

  it('flags lowercase in groupNumber', () => {
    const report = validateBatch(
      batchOf([q310Item()]),
      { ...validConfig, identifiers: { ...validConfig.identifiers, groupNumber: '0a12' } },
      { now: NOW },
    );
    expect(codes(report.violations)).toContain('lowercase-group-number');
  });

  it('flags wrong-width mohOfficeCode', () => {
    const report = validateBatch(
      batchOf([q310Item()]),
      { ...validConfig, identifiers: { ...validConfig.identifiers, mohOfficeCode: '07' } },
      { now: NOW },
    );
    expect(codes(report.violations)).toContain('invalid-moh-office-code-width');
  });

  it('flags non-digit providerRegNumber', () => {
    const report = validateBatch(
      batchOf([q310Item()]),
      { ...validConfig, identifiers: { ...validConfig.identifiers, providerRegNumber: '12345A' } },
      { now: NOW },
    );
    expect(codes(report.violations)).toContain('invalid-provider-reg-number-format');
  });

  it('flags wrong-width specialtyCode', () => {
    const report = validateBatch(
      batchOf([q310Item()]),
      { ...validConfig, identifiers: { ...validConfig.identifiers, specialtyCode: '7' } },
      { now: NOW },
    );
    expect(codes(report.violations)).toContain('invalid-specialty-code-width');
  });

  it('flags missing batchId', () => {
    const report = validateBatch(batchOf([q310Item()]), { ...validConfig, batchId: '' }, { now: NOW });
    expect(codes(report.violations)).toContain('missing-batch-id');
  });

  it('flags wrong-width specVersion', () => {
    const report = validateBatch(
      batchOf([q310Item()]),
      { ...validConfig, specVersion: '03' },
      { now: NOW },
    );
    expect(codes(report.violations)).toContain('invalid-spec-version-width');
  });
});

describe('validateBatch — period-level checks', () => {
  it('rejects a malformed servicePeriod.start', () => {
    const report = validateBatch(
      {
        ...batchOf([q310Item()]),
        servicePeriod: { start: '04/19/2026', end: '2026-05-04' },
      },
      validConfig,
      { now: NOW },
    );
    expect(codes(report.violations)).toContain('invalid-service-period-start');
  });

  it('rejects start > end', () => {
    const report = validateBatch(
      {
        ...batchOf([q310Item()]),
        servicePeriod: { start: '2026-05-19', end: '2026-04-19' },
      },
      validConfig,
      { now: NOW },
    );
    expect(codes(report.violations)).toContain('invalid-service-period-bounds');
  });

  it('warns on a service period starting in the future', () => {
    const report = validateBatch(
      {
        ...batchOf([q310Item({ serviceDate: '2027-01-01' })]),
        servicePeriod: { start: '2027-01-01', end: '2027-01-31' },
      },
      validConfig,
      { now: NOW },
    );
    const warning = find(report.violations, 'service-period-future');
    expect(warning?.severity).toBe('warning');
  });

  it('warns on a service period >2 years old', () => {
    const oldBatch = {
      ...batchOf([q310Item({ serviceDate: '2023-04-19' })]),
      servicePeriod: { start: '2023-04-19', end: '2023-05-04' },
    };
    const report = validateBatch(oldBatch, validConfig, { now: NOW });
    const warning = find(report.violations, 'service-period-too-old');
    expect(warning?.severity).toBe('warning');
  });
});

describe('validateBatch — item-level checks', () => {
  it('flags fee code that does not match ANNNS', () => {
    const report = validateBatch(
      batchOf([q310Item({ feeCode: 'Q310' })]),
      validConfig,
      { now: NOW },
    );
    expect(codes(report.violations)).toContain('invalid-fee-code-format');
  });

  it('flags fee code with lowercase letters', () => {
    const report = validateBatch(
      batchOf([q310Item({ feeCode: 'q310a' })]),
      validConfig,
      { now: NOW },
    );
    expect(codes(report.violations)).toContain('invalid-fee-code-format');
  });

  it('warns on a syntactically valid but unknown fee code', () => {
    const report = validateBatch(
      batchOf([q310Item({ feeCode: 'Z999X' })]),
      validConfig,
      { now: NOW },
    );
    const warning = find(report.violations, 'unknown-fee-code');
    expect(warning?.severity).toBe('warning');
  });

  it('flags units below range', () => {
    const report = validateBatch(
      batchOf([q310Item({ units: 0 })]),
      validConfig,
      { now: NOW },
    );
    expect(codes(report.violations)).toContain('units-out-of-range');
  });

  it('flags units above range', () => {
    const report = validateBatch(
      batchOf([q310Item({ units: 100 })]),
      validConfig,
      { now: NOW },
    );
    expect(codes(report.violations)).toContain('units-out-of-range');
  });

  it('flags non-integer units', () => {
    const report = validateBatch(
      batchOf([q310Item({ units: 1.5 })]),
      validConfig,
      { now: NOW },
    );
    expect(codes(report.violations)).toContain('units-out-of-range');
  });

  it('flags zero or negative fee', () => {
    const a = validateBatch(batchOf([q310Item({ feeSubmittedCents: 0 })]), validConfig, { now: NOW });
    expect(codes(a.violations)).toContain('invalid-fee-amount');
    const b = validateBatch(batchOf([q310Item({ feeSubmittedCents: -100 })]), validConfig, { now: NOW });
    expect(codes(b.violations)).toContain('invalid-fee-amount');
  });

  it('flags fee that overflows the 6-digit field', () => {
    const report = validateBatch(
      batchOf([q310Item({ feeSubmittedCents: 1_000_000 })]),
      validConfig,
      { now: NOW },
    );
    expect(codes(report.violations)).toContain('fee-amount-overflow');
  });

  it('flags malformed serviceDate', () => {
    const report = validateBatch(
      batchOf([q310Item({ serviceDate: '04/19/2026' })]),
      validConfig,
      { now: NOW },
    );
    expect(codes(report.violations)).toContain('invalid-service-date');
  });

  it('flags serviceDate before period.start', () => {
    const report = validateBatch(
      {
        ...batchOf([q310Item({ serviceDate: '2026-04-01' })]),
        servicePeriod: { start: '2026-04-19', end: '2026-05-04' },
      },
      validConfig,
      { now: NOW },
    );
    expect(codes(report.violations)).toContain('service-date-before-period');
  });

  it('flags serviceDate after period.end', () => {
    const report = validateBatch(
      {
        ...batchOf([q310Item({ serviceDate: '2026-05-19' })]),
        servicePeriod: { start: '2026-04-19', end: '2026-05-04' },
      },
      validConfig,
      { now: NOW },
    );
    expect(codes(report.violations)).toContain('service-date-after-period');
  });

  it('warns on a stale serviceDate (>6 months old)', () => {
    const stale = {
      ...batchOf([q310Item({ serviceDate: '2025-09-01' })]),
      servicePeriod: { start: '2025-09-01', end: '2025-09-30' },
    };
    const report = validateBatch(stale, validConfig, { now: NOW });
    const warning = find(report.violations, 'stale-service-date');
    expect(warning?.severity).toBe('warning');
  });

  it('flags diagnosticCode with too-long width', () => {
    const report = validateBatch(
      batchOf([q310Item({ diagnosticCode: '12345' })]),
      validConfig,
      { now: NOW },
    );
    expect(codes(report.violations)).toContain('invalid-diagnostic-code-width');
  });

  it('flags lowercase in diagnosticCode', () => {
    const report = validateBatch(
      batchOf([q310Item({ diagnosticCode: 'v70' })]),
      validConfig,
      { now: NOW },
    );
    expect(codes(report.violations)).toContain('lowercase-diagnostic-code');
  });

  it('flags non-ASCII in serviceLocation', () => {
    const report = validateBatch(
      batchOf([q310Item({ serviceLocation: 'CAFÉ' })]),
      validConfig,
      { now: NOW },
    );
    expect(codes(report.violations)).toContain('non-ascii-service-location');
  });

  it('flags too-long serviceLocation', () => {
    const report = validateBatch(
      batchOf([q310Item({ serviceLocation: 'TOOLONG' })]),
      validConfig,
      { now: NOW },
    );
    expect(codes(report.violations)).toContain('invalid-service-location-width');
  });
});

describe('validateBatch — patient-level checks', () => {
  const patient: PatientReference = {
    healthNumber: '1234567890',
    versionCode: 'AB',
    dateOfBirth: '1980-04-19',
  };

  it('passes a clean patient-linked item', () => {
    const report = validateBatch(
      batchOf([q310Item({ feeCode: 'A007A', patient })]),
      validConfig,
      { now: NOW },
    );
    expect(report.violations.filter((v) => v.severity === 'error')).toHaveLength(0);
  });

  it('flags a patient with empty healthNumber', () => {
    const report = validateBatch(
      batchOf([
        q310Item({
          feeCode: 'A007A',
          patient: { ...patient, healthNumber: '' },
        }),
      ]),
      validConfig,
      { now: NOW },
    );
    expect(codes(report.violations)).toContain('patient-missing-health-number');
  });

  it('flags a patient with non-10-digit healthNumber', () => {
    const report = validateBatch(
      batchOf([
        q310Item({
          feeCode: 'A007A',
          patient: { ...patient, healthNumber: '123456789' },
        }),
      ]),
      validConfig,
      { now: NOW },
    );
    expect(codes(report.violations)).toContain('invalid-patient-health-number');
  });

  it('flags a patient with malformed dateOfBirth', () => {
    const report = validateBatch(
      batchOf([
        q310Item({
          feeCode: 'A007A',
          patient: { ...patient, dateOfBirth: '1980/04/19' },
        }),
      ]),
      validConfig,
      { now: NOW },
    );
    expect(codes(report.violations)).toContain('invalid-patient-date-of-birth');
  });

  it('flags a patient with wrong-width versionCode', () => {
    const report = validateBatch(
      batchOf([
        q310Item({
          feeCode: 'A007A',
          patient: { ...patient, versionCode: 'A' },
        }),
      ]),
      validConfig,
      { now: NOW },
    );
    expect(codes(report.violations)).toContain('invalid-patient-version-code');
  });

  it('accepts a patient with no versionCode', () => {
    const report = validateBatch(
      batchOf([
        q310Item({
          feeCode: 'A007A',
          patient: {
            healthNumber: '1234567890',
            dateOfBirth: '1980-04-19',
          },
        }),
      ]),
      validConfig,
      { now: NOW },
    );
    expect(report.violations.filter((v) => v.severity === 'error')).toHaveLength(0);
  });
});

describe('validateBatch — empty-batch check', () => {
  it('flags an empty batch as an error', () => {
    const report = validateBatch(batchOf([]), validConfig, { now: NOW });
    const violation = find(report.violations, 'empty-batch');
    expect(violation?.severity).toBe('error');
  });
});

describe('validateBatch — aggregation (contract obligation 1)', () => {
  it('returns every finding in a batch with multiple violations rather than short-circuiting', () => {
    const badConfig: OntarioMcedtConfig = {
      specVersion: '03',
      identifiers: {
        groupNumber: 'X',
        mohOfficeCode: '07',
        providerRegNumber: '12345A',
        specialtyCode: '0',
      },
      batchId: 'TOOSHORT',
    };
    const badBatch: ClaimBatch = {
      submitterId: 'g',
      servicePeriod: { start: '2026-05-04', end: '2026-04-19' },
      items: [
        q310Item({ feeCode: 'Q310', units: 0, feeSubmittedCents: -1 }),
      ],
    };
    const report = validateBatch(badBatch, badConfig, { now: NOW });

    const seen = new Set(report.violations.map((v) => v.code));
    expect(seen.has('invalid-spec-version-width')).toBe(true);
    expect(seen.has('invalid-batch-id-width')).toBe(true);
    expect(seen.has('invalid-group-number-width')).toBe(true);
    expect(seen.has('invalid-moh-office-code-width')).toBe(true);
    expect(seen.has('invalid-provider-reg-number-format')).toBe(true);
    expect(seen.has('invalid-specialty-code-width')).toBe(true);
    expect(seen.has('invalid-service-period-bounds')).toBe(true);
    expect(seen.has('invalid-fee-code-format')).toBe(true);
    expect(seen.has('units-out-of-range')).toBe(true);
    expect(seen.has('invalid-fee-amount')).toBe(true);
  });

  it('every violation carries a path field for item-level findings', () => {
    const report = validateBatch(
      batchOf([q310Item({ feeCode: 'Q310', units: 0 })]),
      validConfig,
      { now: NOW },
    );
    const itemFindings = report.violations.filter((v) =>
      v.code === 'invalid-fee-code-format' || v.code === 'units-out-of-range',
    );
    expect(itemFindings.length).toBeGreaterThanOrEqual(2);
    for (const v of itemFindings) {
      expect(v.path).toBeDefined();
      expect(v.path).toContain('items[0]');
    }
  });

  it('returns errors AND warnings in the same report — neither severity is dropped', () => {
    const mixed = batchOf([
      q310Item({ feeCode: 'Q310' }),               // error: fee-code format
      q310Item({ feeCode: 'Z999X' }),              // warning: unknown fee code
      q310Item({ serviceDate: '2025-09-01' }),     // warning: stale (>183 days under NOW = 2026-05-04)
    ]);
    const report = validateBatch(
      { ...mixed, servicePeriod: { start: '2025-09-01', end: '2026-05-04' } },
      validConfig,
      { now: NOW },
    );
    const errors = report.violations.filter((v) => v.severity === 'error');
    const warnings = report.violations.filter((v) => v.severity === 'warning');
    expect(errors.length).toBeGreaterThan(0);
    expect(warnings.length).toBeGreaterThan(0);
    expect(errors.map((v) => v.code)).toContain('invalid-fee-code-format');
    expect(warnings.map((v) => v.code)).toContain('unknown-fee-code');
    expect(warnings.map((v) => v.code)).toContain('stale-service-date');
  });

  it('records a missing-item violation rather than silently skipping a sparse-array hole', () => {
    const sparse: ClaimItem[] = [
      q310Item(),
      undefined as unknown as ClaimItem,
      q310Item({ serviceDate: '2026-04-22' }),
    ];
    const report = validateBatch(batchOf(sparse), validConfig, { now: NOW });
    const finding = find(report.violations, 'missing-item');
    expect(finding?.severity).toBe('error');
    expect(finding?.path).toBe('items[1]');
  });

  it('checkAsciiUppercase aggregates every bad character (no per-field short-circuit)', () => {
    const report = validateBatch(
      batchOf([q310Item({ diagnosticCode: 'aBcD' })]),
      validConfig,
      { now: NOW },
    );
    const lowercaseFindings = report.violations.filter(
      (v) => v.code === 'lowercase-diagnostic-code',
    );
    expect(lowercaseFindings.length).toBe(2);
  });
});
