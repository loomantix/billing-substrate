/**
 * Smoke tests for the contract package data shapes. These aren't validation
 * tests — they exist to keep the package compiling against its own public
 * API surface and catch unintended type-shape changes via TS errors at
 * `pnpm typecheck`.
 */

import { describe, expect, it } from 'vitest';

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
