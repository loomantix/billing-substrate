/**
 * End-to-end integration tests for `OntarioMcedtAdapter`.
 *
 * Exercises the full validate → render flow through the public class
 * surface (vs the per-component tests in `records/`, `emit/`, and
 * `validate/`). These tests are the closest thing this package has to a
 * consumer-side contract acceptance test.
 */

import {
  AdapterErrorException,
  asBatchItemIndex,
  canSubmit,
  type AdapterError,
  type ClaimBatch,
  type ClaimItem,
  type ClaimRenderer,
} from '@loomantix/billing-adapter';
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';

import { EmitException } from './emit/errors.js';
import {
  OntarioMcedtAdapter,
  translateRenderException,
  type OntarioMcedtAdapterOptions,
} from './index.js';
import { EncodeException } from './records/errors.js';

const NOW = new Date('2026-05-04T00:00:00Z');

const validOptions: OntarioMcedtAdapterOptions = {
  config: {
    specVersion: '003',
    identifiers: {
      groupNumber: '0A12',
      mohOfficeCode: '7',
      providerRegNumber: '012345',
      specialtyCode: '00',
    },
    batchId: '202604190001',
  },
  validationOptions: { now: NOW },
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

describe('OntarioMcedtAdapter — happy path', () => {
  it('validates a clean batch with zero error-severity violations', () => {
    const adapter = new OntarioMcedtAdapter(validOptions);
    const report = adapter.validate(batchOf([q310Item()]));
    const errors = report.violations.filter((v) => v.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('renders a clean batch into a RenderedClaim with non-empty bytes and a SHA-256 hash', async () => {
    const adapter = new OntarioMcedtAdapter(validOptions);
    const rendered = await adapter.render(batchOf([q310Item()]));

    expect(rendered.jurisdiction).toBe('ontario-mcedt');
    expect(rendered.bytes.length).toBeGreaterThan(0);
    expect(rendered.byteCount).toBe(rendered.bytes.length);
    expect(rendered.contentHashSha256Hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces byte-identical output across two consecutive render calls', async () => {
    const adapter = new OntarioMcedtAdapter(validOptions);
    const items = [
      q310Item({ feeCode: 'Q313A', units: 4, feeSubmittedCents: 8000 }),
      q310Item({ serviceDate: '2026-04-22', units: 2, feeSubmittedCents: 4000 }),
    ];
    const a = await adapter.render(batchOf(items));
    const b = await adapter.render(batchOf(items));
    expect(b.bytes).toEqual(a.bytes);
    expect(b.contentHashSha256Hex).toBe(a.contentHashSha256Hex);
  });
});

describe('OntarioMcedtAdapter — capability narrowing', () => {
  it('returns false from canSubmit (render-only adapter at this phase)', () => {
    const adapter: ClaimRenderer = new OntarioMcedtAdapter(validOptions);
    expect(canSubmit(adapter)).toBe(false);
  });
});

async function captureAdapterError(
  promise: Promise<unknown>,
): Promise<AdapterError> {
  try {
    await promise;
  } catch (caught) {
    if (caught instanceof AdapterErrorException) {
      return caught.error;
    }
    // util.inspect handles BigInt, Symbol, and circular references without
    // throwing — JSON.stringify would mask the original failure on any of
    // those shapes. Cap depth so a deeply nested cause chain doesn't
    // dominate the test failure output.
    const description =
      caught instanceof Error
        ? `${caught.name}: ${caught.message}`
        : `non-Error throw of typeof ${typeof caught}: ${inspect(caught, { depth: 3 })}`;
    throw new Error(`expected an AdapterErrorException; got ${description}`);
  }
  throw new Error('expected the promise to reject; it resolved');
}

describe('OntarioMcedtAdapter — render rejects on validation errors', () => {
  it('throws AdapterErrorException wrapping kind="validation" with the full report', async () => {
    const adapter = new OntarioMcedtAdapter(validOptions);
    const badBatch = batchOf([q310Item({ feeCode: 'Q310', units: 0 })]);

    const e = await captureAdapterError(adapter.render(badBatch));
    expect(e.kind).toBe('validation');
    if (e.kind !== 'validation') return;
    const codes = e.report.violations.map((v) => v.code);
    expect(codes).toContain('invalid-fee-code-format');
    expect(codes).toContain('units-out-of-range');
  });

  it('rejection is an Error subclass with stack and instanceof for observability (validation early-return path)', async () => {
    const adapter = new OntarioMcedtAdapter(validOptions);
    const badBatch = batchOf([q310Item({ feeCode: 'Q310', units: 0 })]);

    let caught: unknown;
    try {
      await adapter.render(badBatch);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).toBeInstanceOf(AdapterErrorException);
    if (caught instanceof AdapterErrorException) {
      expect(caught.name).toBe('AdapterErrorException');
      // Stack must reference the subclass — pins that the prototype chain
      // is correctly configured (a hand-rolled class that sets stack='' or
      // stack='stub' would pass a typeof check but fail this).
      expect(caught.stack).toContain('AdapterErrorException');
      expect(caught.message).toMatch(/^validation: /);
      expect(caught.error.kind).toBe('validation');
    }
  });

  it('wraps EmitException rethrow path in AdapterErrorException with no cause leak (PHI defense)', async () => {
    // Forces the encoder-error rethrow path by supplying a batch that
    // passes validate (per-item shape is OK) but fails emit (two items in
    // the same envelope disagree on serviceLocation — by design the
    // validator can't catch this; see emit/errors.ts JSDoc on EmitError).
    //
    // Asserts the wrapper does NOT carry the inner `EmitException` via
    // `Error.cause`. The inner exception's `groupKey` is
    // `${HIN}|${DoB}|${date}` (PHI) and `Error.cause` crosses the public
    // adapter boundary. The wrapper's own stack + the synthesized
    // violation's `code` are sufficient for server-side debugging. If a
    // future change ever attaches `cause` here, this test fails closed.
    const adapter = new OntarioMcedtAdapter(validOptions);
    const patient = {
      healthNumber: '1234567890',
      versionCode: 'AB',
      dateOfBirth: '1980-04-19',
    } as const;
    const conflictingBatch = batchOf([
      {
        serviceDate: '2026-04-19',
        feeCode: 'A007A',
        units: 1,
        feeSubmittedCents: 3500,
        patient,
        serviceLocation: 'HOSP',
      },
      {
        serviceDate: '2026-04-19',
        feeCode: 'G365A',
        units: 1,
        feeSubmittedCents: 1200,
        patient,
        serviceLocation: 'OFFC',
      },
    ]);

    let caught: unknown;
    try {
      await adapter.render(conflictingBatch);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AdapterErrorException);
    if (caught instanceof AdapterErrorException) {
      expect(caught.error.kind).toBe('validation');
      if (caught.error.kind === 'validation') {
        const codes = caught.error.report.violations.map((v) => v.code);
        expect(codes).toContain('inconsistent-group-field');
      }
      // Cause MUST be undefined — the inner EmitException carries PHI
      // (groupKey = HIN|DoB|date) and Error.cause is serialized across
      // the boundary by default loggers.
      expect(caught.cause).toBeUndefined();
      // The wrapper's message must not echo the PHI either.
      expect(caught.message).not.toContain('1234567890');
      expect(caught.message).not.toContain('1980-04-19');
    }
  });

  it('renders despite warnings (warnings do not block render)', async () => {
    const adapter = new OntarioMcedtAdapter(validOptions);
    const warningBatch = batchOf([q310Item({ feeCode: 'Z999X' })]);
    const report = adapter.validate(warningBatch);
    const errors = report.violations.filter((v) => v.severity === 'error');
    const warnings = report.violations.filter((v) => v.severity === 'warning');
    expect(errors).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);

    const rendered = await adapter.render(warningBatch);
    expect(rendered.bytes.length).toBeGreaterThan(0);
  });

  it('throws validation-variant exception for misconfigured adapter (caught at validate)', async () => {
    const adapter = new OntarioMcedtAdapter({
      ...validOptions,
      config: {
        ...validOptions.config,
        identifiers: {
          ...validOptions.config.identifiers,
          mohOfficeCode: '07',
        },
      },
    });

    const e = await captureAdapterError(adapter.render(batchOf([q310Item()])));
    expect(e.kind).toBe('validation');
    if (e.kind !== 'validation') return;
    const codes = e.report.violations.map((v) => v.code);
    expect(codes).toContain('invalid-moh-office-code-width');
  });
});

describe('translateRenderException — defense-in-depth contract translation', () => {
  it('translates EmitException empty-batch into kind="validation" with a synthesized report', () => {
    const inner = new EmitException({
      kind: 'empty-batch',
      message: 'cannot emit an MCEDT file with zero claim items',
    });
    const result = translateRenderException(inner);
    expect(result.kind).toBe('validation');
    if (result.kind !== 'validation') return;
    expect(result.report.violations).toHaveLength(1);
    const v = result.report.violations[0]!;
    expect(v.severity).toBe('error');
    expect(v.code).toBe('empty-batch');
    expect(v.message).toContain('zero claim items');
  });

  it('sanitizes inconsistent-group-field — does NOT echo groupKey (HIN|DoB|date) or values (versionCode is PHI-adjacent)', () => {
    const inner = new EmitException({
      kind: 'inconsistent-group-field',
      field: 'versionCode',
      groupKey: '1234567890|1980-04-19|2026-04-19',
      firstValue: 'AB',
      conflictingValue: 'CD',
      message:
        'items in claim envelope 1234567890|1980-04-19|2026-04-19 disagree on versionCode',
    });
    const result = translateRenderException(inner);
    expect(result.kind).toBe('validation');
    if (result.kind !== 'validation') return;
    const v = result.report.violations[0]!;
    expect(v.code).toBe('inconsistent-group-field');
    expect(v.message).not.toContain('1234567890');
    expect(v.message).not.toContain('1980-04-19');
    expect(v.message).not.toContain('AB');
    expect(v.message).not.toContain('CD');
    expect(v.message).toContain('versionCode');
  });

  it('EmitException.message itself does NOT carry PHI — only the structured kind summary', () => {
    const inner = new EmitException({
      kind: 'inconsistent-group-field',
      field: 'serviceLocation',
      groupKey: '1234567890|1980-04-19|2026-04-19',
      firstValue: 'HOSP',
      conflictingValue: 'OFFC',
      message:
        'items in claim envelope 1234567890|1980-04-19|2026-04-19 disagree on serviceLocation',
    });
    expect(inner.message).not.toContain('1234567890');
    expect(inner.message).not.toContain('1980-04-19');
    expect(inner.message).not.toContain('HOSP');
    expect(inner.message).not.toContain('OFFC');
    expect(inner.message).toContain('inconsistent-group-field');
  });

  it('EmitException survives JSON.stringify and util.inspect without leaking the structured payload', async () => {
    const { inspect } = await import('node:util');
    const inner = new EmitException({
      kind: 'inconsistent-group-field',
      field: 'serviceLocation',
      groupKey: '1234567890|1980-04-19|2026-04-19',
      firstValue: 'HOSP',
      conflictingValue: 'OFFC',
      message: 'should not appear',
    });
    const json = JSON.stringify(inner);
    expect(json).not.toContain('1234567890');
    expect(json).not.toContain('groupKey');
    expect(json).not.toContain('HOSP');

    const inspected = inspect(inner);
    expect(inspected).not.toContain('1234567890');
    expect(inspected).not.toContain('HOSP');
  });

  it('EncodeException survives JSON.stringify and util.inspect without leaking the raw value', async () => {
    const { inspect } = await import('node:util');
    const inner = new EncodeException({
      kind: 'invalid-date',
      path: 'items[0].patient.dateOfBirth',
      value: '1980-04-19',
      message: 'expected YYYY-MM-DD, got "1980-04-19"',
    });
    const json = JSON.stringify(inner);
    expect(json).not.toContain('1980-04-19');
    expect(json).not.toContain('expected YYYY-MM-DD');

    const inspected = inspect(inner);
    expect(inspected).not.toContain('1980-04-19');
  });

  it('EncodeException.toJSON exposes name + message + kind + path positively (path is structural, never PHI)', () => {
    // Pin the shape so a regression that drops `path` (which is needed
    // for caller debugging) or accidentally adds `value` (which leaks)
    // fails the test. The path field is always a field name like
    // `items[0].patient.dateOfBirth` — structural, never PHI.
    const inner = new EncodeException({
      kind: 'field-too-long',
      path: 'items[3].patient.healthNumber',
      value: '12345678901',
      width: 10,
      message: 'value of length 11 exceeds field width 10',
    });
    expect(JSON.parse(JSON.stringify(inner))).toEqual({
      name: 'EncodeException',
      message: 'field-too-long: items[3].patient.healthNumber',
      kind: 'field-too-long',
      path: 'items[3].patient.healthNumber',
    });
  });

  it('EmitException.toJSON exposes name + message + kind positively (no path field on EmitError union)', () => {
    const inner = new EmitException({
      kind: 'missing-item',
      itemIndex: asBatchItemIndex(0)!,
      message: 'items[0] is missing',
    });
    expect(JSON.parse(JSON.stringify(inner))).toEqual({
      name: 'EmitException',
      message: 'missing-item: items[0]',
      kind: 'missing-item',
    });
  });

  it('translates file-too-large with size context but no PHI', () => {
    const inner = new EmitException({
      kind: 'file-too-large',
      fileSize: 11_000_000,
      maxSize: 10 * 1024 * 1024,
      message: 'oversize',
    });
    const result = translateRenderException(inner);
    expect(result.kind).toBe('validation');
    if (result.kind !== 'validation') return;
    const v = result.report.violations[0]!;
    expect(v.code).toBe('file-too-large');
    expect(v.message).toContain('11000000');
  });

  it('translates patient-missing-required-field with structured path', () => {
    const inner = new EmitException({
      kind: 'patient-missing-required-field',
      field: 'healthNumber',
      itemIndex: 3,
      message: 'items[3] carries a patient block with empty healthNumber',
    });
    const result = translateRenderException(inner);
    expect(result.kind).toBe('validation');
    if (result.kind !== 'validation') return;
    const v = result.report.violations[0]!;
    expect(v.code).toBe('patient-missing-required-field');
    expect(v.path).toBe('items[3].patient.healthNumber');
  });

  it('translates EncodeException into kind="validation" carrying the field path with a scrubbed message', () => {
    const inner = new EncodeException({
      kind: 'field-wrong-width',
      path: 'mohOfficeCode',
      value: '07',
      expectedWidth: 1,
      actualWidth: 2,
      message: 'value of length 2 does not match required width 1',
    });
    const result = translateRenderException(inner);
    expect(result.kind).toBe('validation');
    if (result.kind !== 'validation') return;
    const v = result.report.violations[0]!;
    expect(v.code).toBe('field-wrong-width');
    expect(v.path).toBe('mohOfficeCode');
    expect(v.message).toContain('width 1');
    expect(v.message).not.toContain('07');
  });

  it('sanitizes EncodeException invalid-date — does NOT echo the raw value (PHI: dateOfBirth)', () => {
    const inner = new EncodeException({
      kind: 'invalid-date',
      path: 'items[0].patient.dateOfBirth',
      value: '1980-04-19',
      message: 'expected YYYY-MM-DD (or empty for unpopulated), got "1980-04-19"',
    });
    const result = translateRenderException(inner);
    expect(result.kind).toBe('validation');
    if (result.kind !== 'validation') return;
    const v = result.report.violations[0]!;
    expect(v.code).toBe('invalid-date');
    expect(v.path).toBe('items[0].patient.dateOfBirth');
    expect(v.message).not.toContain('1980-04-19');
    expect(v.message).not.toContain('1980');
  });

  it('sanitizes EncodeException field-too-long — does NOT echo the raw value (PHI: HIN, name)', () => {
    const inner = new EncodeException({
      kind: 'field-too-long',
      path: 'items[0].patient.healthNumber',
      value: '12345678901',
      width: 10,
      message: 'value of length 11 exceeds field width 10',
    });
    const result = translateRenderException(inner);
    expect(result.kind).toBe('validation');
    if (result.kind !== 'validation') return;
    const v = result.report.violations[0]!;
    expect(v.code).toBe('field-too-long');
    expect(v.path).toBe('items[0].patient.healthNumber');
    expect(v.message).not.toContain('12345678901');
    expect(v.message).toContain('width 10');
  });

  it('sanitizes EncodeException invalid-numeric — does NOT echo the raw value', () => {
    const inner = new EncodeException({
      kind: 'invalid-numeric',
      path: 'items[0].patient.healthNumber',
      value: '12345abc90',
      message: 'non-digit character at index 5',
    });
    const result = translateRenderException(inner);
    expect(result.kind).toBe('validation');
    if (result.kind !== 'validation') return;
    const v = result.report.violations[0]!;
    expect(v.code).toBe('invalid-numeric');
    expect(v.message).not.toContain('12345abc90');
    expect(v.message).not.toContain('abc');
  });

  it('sanitizes EncodeException invalid-character-class — does NOT echo the raw value (PHI: HIN, name)', () => {
    const inner = new EncodeException({
      kind: 'invalid-character-class',
      path: 'items[0].patient.healthNumber',
      value: '1234567890',
      badCharCode: 49,
      badCharIndex: 0,
      message: "lowercase character '1' at index 0; MCEDT requires uppercase",
    });
    const result = translateRenderException(inner);
    expect(result.kind).toBe('validation');
    if (result.kind !== 'validation') return;
    const v = result.report.violations[0]!;
    expect(v.code).toBe('invalid-character-class');
    expect(v.path).toBe('items[0].patient.healthNumber');
    expect(v.message).not.toContain('1234567890');
  });

  it('translates an unknown Error into kind="rejected" with a generic message (no PHI leak)', () => {
    const result = translateRenderException(
      new Error('this could mention HIN 1234567890 in some random library'),
    );
    expect(result.kind).toBe('rejected');
    if (result.kind !== 'rejected') return;
    expect(result.code).toBe('internal-error');
    expect(result.message).not.toContain('1234567890');
  });

  it('translates non-Error throws into kind="rejected" without echoing the value', () => {
    for (const cause of ['string-throw', null, undefined, { kind: 'something' }]) {
      const result = translateRenderException(cause);
      expect(result.kind).toBe('rejected');
      if (result.kind !== 'rejected') continue;
      expect(result.code).toBe('internal-error');
    }
  });
});

describe('OntarioMcedtAdapter — caller mutation defense (Object.freeze + Date clone)', () => {
  it('renders byte-identically after the caller mutates the original config object', async () => {
    const mutableConfig = {
      specVersion: '003',
      identifiers: {
        groupNumber: '0A12',
        mohOfficeCode: '7',
        providerRegNumber: '012345',
        specialtyCode: '00',
      },
      batchId: '202604190001',
    };
    const adapter = new OntarioMcedtAdapter({
      config: mutableConfig,
      validationOptions: { now: NOW },
    });

    const before = await adapter.render(batchOf([q310Item()]));

    // Caller mutates the live reference. Narrow casts strip the
    // compile-time `readonly` so we exercise the runtime freeze
    // defense rather than getting a TS error.
    (mutableConfig as { batchId: string }).batchId = '999999999999';
    (mutableConfig.identifiers as { groupNumber: string }).groupNumber = 'XXXX';

    const after = await adapter.render(batchOf([q310Item()]));
    expect(after.bytes).toEqual(before.bytes);
    expect(after.contentHashSha256Hex).toBe(before.contentHashSha256Hex);
  });

  it('survives caller mutating the now Date after construction (Date.setTime)', async () => {
    const mutableNow = new Date('2026-05-04T00:00:00Z');
    const adapter = new OntarioMcedtAdapter({
      config: validOptions.config,
      validationOptions: { now: mutableNow },
    });

    const stale = q310Item({ serviceDate: '2025-09-01' });
    const staleBatch: ClaimBatch = {
      submitterId: 'group-0A12',
      servicePeriod: { start: '2025-09-01', end: '2025-09-30' },
      items: [stale],
    };

    const reportBefore = adapter.validate(staleBatch);
    const staleBefore = reportBefore.violations.find(
      (v) => v.code === 'stale-service-date',
    );
    expect(staleBefore?.severity).toBe('warning');

    // Caller advances "now" by 5 years. If the adapter held a live
    // reference, the staleness math would change. The clone makes
    // this a no-op.
    mutableNow.setTime(new Date('2031-05-04T00:00:00Z').getTime());

    const reportAfter = adapter.validate(staleBatch);
    expect(reportAfter.violations.map((v) => v.code)).toEqual(
      reportBefore.violations.map((v) => v.code),
    );
  });
});

describe('OntarioMcedtAdapter — statelessness (contract obligation 6)', () => {
  it('does not mutate config across calls (multiple renders against the same instance)', async () => {
    const adapter = new OntarioMcedtAdapter(validOptions);
    const batchA = batchOf([q310Item({ feeCode: 'Q310A' })]);
    const batchB = batchOf([q310Item({ feeCode: 'Q313A' })]);

    const renderA1 = await adapter.render(batchA);
    const renderB = await adapter.render(batchB);
    const renderA2 = await adapter.render(batchA);

    expect(renderA2.bytes).toEqual(renderA1.bytes);
    expect(renderA2.contentHashSha256Hex).toBe(renderA1.contentHashSha256Hex);
    expect(renderB.contentHashSha256Hex).not.toBe(renderA1.contentHashSha256Hex);
  });
});
