/**
 * Smoke tests for the JurisdictionAdapter contract surface. Verifies the
 * type-shape, capability narrowing via canSubmit, and discriminated error
 * variants compile and behave as the contract spec specifies.
 *
 * These are not behavior tests for any concrete adapter — those live in
 * the per-jurisdiction packages (e.g. @loomantix/billing-adapter-ohip).
 */

import { describe, expect, it } from 'vitest';

import { canSubmit } from './adapter.js';
import { SubmitterCredentials } from './credentials.js';
import { AdapterErrorException, describeAdapterError } from './errors.js';
import type {
  AdapterError,
  AdjudicationResult,
  ClaimBatch,
  ClaimRenderer,
  ClaimSubmitter,
  LineOutcome,
  PollOutcome,
  RenderedClaim,
  SubmitReceipt,
  SubmitterIdentity,
  ValidationReport,
} from './index.js';

const emptyBatch: ClaimBatch = {
  submitterId: '00000000-0000-0000-0000-000000000000',
  servicePeriod: { start: '2026-04-19', end: '2026-05-18' },
  items: [],
};

const emptyReport: ValidationReport = { violations: [] };

const stubRendered: RenderedClaim = {
  jurisdiction: 'ontario-mcedt',
  bytes: new Uint8Array(),
  byteCount: 0,
  contentHashSha256Hex: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
};

class RenderOnlyStub implements ClaimRenderer {
  readonly jurisdiction = 'ontario-mcedt';
  validate(_batch: ClaimBatch): ValidationReport {
    return emptyReport;
  }
  async render(_batch: ClaimBatch): Promise<RenderedClaim> {
    return stubRendered;
  }
}

class FullLifecycleStub implements ClaimSubmitter {
  readonly jurisdiction = 'ontario-mcedt';
  validate(_batch: ClaimBatch): ValidationReport {
    return emptyReport;
  }
  async render(_batch: ClaimBatch): Promise<RenderedClaim> {
    return stubRendered;
  }
  async submit(
    _rendered: RenderedClaim,
    _submitter: SubmitterIdentity,
    _credentials: SubmitterCredentials,
  ): Promise<SubmitReceipt> {
    return {
      jurisdiction: 'ontario-mcedt',
      externalId: 'edt-resource-stub',
      submittedAt: '2026-05-02T00:00:00Z',
    };
  }
  async poll(
    _receipt: SubmitReceipt,
    _credentials: SubmitterCredentials,
  ): Promise<PollOutcome> {
    return { kind: 'pending' };
  }
}

describe('JurisdictionAdapter contract', () => {
  it('ClaimRenderer-only adapter implements validate + render', async () => {
    const adapter = new RenderOnlyStub();
    expect(adapter.jurisdiction).toBe('ontario-mcedt');
    expect(adapter.validate(emptyBatch).violations).toHaveLength(0);
    const rendered = await adapter.render(emptyBatch);
    expect(rendered.byteCount).toBe(0);
  });

  it('ClaimSubmitter adapter implements full lifecycle', async () => {
    const adapter = new FullLifecycleStub();
    const rendered = await adapter.render(emptyBatch);
    const submitter: SubmitterIdentity = {
      id: '00000000-0000-0000-0000-000000000000',
      jurisdiction: 'ontario-mcedt',
      displayName: 'Test',
      identifiers: { groupNumber: '0A12' },
    };
    const credentials = new SubmitterCredentials({
      jurisdiction: 'ontario-mcedt',
      material: { certificatePem: 'stub' },
    });
    const receipt = await adapter.submit(rendered, submitter, credentials);
    expect(receipt.externalId).toBe('edt-resource-stub');
    const outcome = await adapter.poll(receipt, credentials);
    expect(outcome.kind).toBe('pending');
  });

  describe('canSubmit type guard', () => {
    it('returns false for ClaimRenderer-only adapters', () => {
      const adapter: ClaimRenderer = new RenderOnlyStub();
      expect(canSubmit(adapter)).toBe(false);
    });

    it('returns true for ClaimSubmitter adapters', () => {
      const adapter: ClaimRenderer = new FullLifecycleStub();
      expect(canSubmit(adapter)).toBe(true);
    });

    it('narrows the type for downstream method access', () => {
      const adapter: ClaimRenderer = new FullLifecycleStub();
      if (canSubmit(adapter)) {
        // TypeScript narrows to ClaimSubmitter here; .submit is callable
        expect(typeof adapter.submit).toBe('function');
        expect(typeof adapter.poll).toBe('function');
      } else {
        throw new Error('expected adapter to be a ClaimSubmitter');
      }
    });
  });

  describe('AdapterError variants', () => {
    it('validation error carries the violation report', () => {
      const err: AdapterError = {
        kind: 'validation',
        report: { violations: [{ severity: 'error', code: 'x', message: 'y' }] },
      };
      expect(err.kind).toBe('validation');
      expect(err.report.violations[0]?.code).toBe('x');
    });

    it('rejected error distinguishes from transport error', () => {
      const rejected: AdapterError = { kind: 'rejected', code: 'V001', message: 'invalid HIN' };
      const transport: AdapterError = { kind: 'transport', message: 'connection refused' };
      expect(rejected.kind).not.toBe(transport.kind);
    });

    it('rate-limited error carries optional retry hint', () => {
      const err: AdapterError = { kind: 'rate-limited', retryAfterMs: 30_000 };
      expect(err.retryAfterMs).toBe(30_000);
    });

    it('not-supported error names the operation', () => {
      const err: AdapterError = { kind: 'not-supported', operation: 'submit' };
      expect(err.operation).toBe('submit');
    });

    it('exhaustive switch over all variants compiles', () => {
      const handle = (err: AdapterError): string => {
        switch (err.kind) {
          case 'validation':
            return 'val';
          case 'transport':
            return 'tr';
          case 'auth':
            return 'au';
          case 'rejected':
            return 'rj';
          case 'rate-limited':
            return 'rl';
          case 'timeout':
            return 'to';
          case 'not-supported':
            return 'ns';
        }
      };
      expect(handle({ kind: 'auth', message: '' })).toBe('au');
    });
  });

  describe('AdapterErrorException wrapper', () => {
    it('is an Error subclass with stack and instanceof', () => {
      const e = new AdapterErrorException({
        kind: 'rejected',
        code: 'X1',
        message: 'rejected by jurisdiction',
      });
      expect(e).toBeInstanceOf(Error);
      expect(e).toBeInstanceOf(AdapterErrorException);
      expect(e.name).toBe('AdapterErrorException');
      expect(typeof e.stack).toBe('string');
      expect(e.stack).toContain('AdapterErrorException');
    });

    it('exposes the discriminated payload via .error for caller narrowing', () => {
      const report: ValidationReport = {
        violations: [{ severity: 'error', code: 'x', message: 'y' }],
      };
      const e = new AdapterErrorException({ kind: 'validation', report });
      expect(e.error.kind).toBe('validation');
      if (e.error.kind === 'validation') {
        expect(e.error.report.violations[0]?.code).toBe('x');
      }
    });

    it('formats Error.message as "<kind>: <description>" for each variant', () => {
      const cases: ReadonlyArray<readonly [AdapterError, string]> = [
        [
          { kind: 'validation', report: { violations: [{ severity: 'error', code: 'x', message: 'y' }] } },
          'validation: 1 blocking violation',
        ],
        [{ kind: 'transport', message: 'connection refused' }, 'transport: connection refused'],
        [{ kind: 'auth', message: 'cert expired' }, 'auth: cert expired'],
        [
          { kind: 'rejected', code: 'V01', message: 'bad payload' },
          'rejected: V01: bad payload',
        ],
        [{ kind: 'rate-limited', retryAfterMs: 30_000 }, 'rate-limited: retry after 30000 ms'],
        [{ kind: 'rate-limited' }, 'rate-limited: no retry hint supplied'],
        [{ kind: 'timeout', afterMs: 5000 }, 'timeout: after 5000 ms'],
        [{ kind: 'not-supported', operation: 'submit' }, 'not-supported: submit'],
      ];
      for (const [err, expected] of cases) {
        expect(new AdapterErrorException(err).message).toBe(expected);
      }
    });

    it('pluralizes the validation violation count correctly', () => {
      const e2 = new AdapterErrorException({
        kind: 'validation',
        report: {
          violations: [
            { severity: 'error', code: 'a', message: '' },
            { severity: 'error', code: 'b', message: '' },
            { severity: 'warning', code: 'c', message: '' },
          ],
        },
      });
      expect(e2.message).toBe('validation: 2 blocking violations');
    });

    it('falls back to a placeholder when adapter supplies an empty message string', () => {
      // Defends against a silent-failure shape: bare `Error.message === ''`
      // would surface as a blank line in pino/Sentry. The kind prefix +
      // placeholder ensures every throw produces an operator-readable
      // first line.
      expect(new AdapterErrorException({ kind: 'transport', message: '' }).message).toBe(
        'transport: (no message supplied)',
      );
      expect(new AdapterErrorException({ kind: 'auth', message: '' }).message).toBe(
        'auth: (no message supplied)',
      );
      expect(
        new AdapterErrorException({ kind: 'rejected', code: 'V99', message: '' }).message,
      ).toBe('rejected: V99: (no message supplied)');

      expect(describeAdapterError({ kind: 'transport', message: '' })).not.toBe('');
      expect(describeAdapterError({ kind: 'auth', message: '' })).not.toBe('');
    });

    it('propagates a scrubbed transport cause into Error.cause for chained-exception logging', () => {
      // The contract types `cause` as `ScrubbedCause` ({ name, message,
      // status? }), not `unknown`. Adapters MUST scrub before throwing —
      // a raw `fetch` failure or TLS error would carry request headers
      // (Authorization, mTLS material) and bodies (rendered claim PHI)
      // through default cause-chain serialization in pino/Sentry/OTel.
      const scrubbed = {
        name: 'TransportError',
        message: 'EHOSTUNREACH',
        status: 503,
      };
      const e = new AdapterErrorException({
        kind: 'transport',
        message: 'connection refused',
        cause: scrubbed,
      });
      expect(e.cause).toEqual(scrubbed);
    });

    it('runtime-narrows cause to {name, message, status?} even when caller bypasses the type via as-cast', () => {
      // Defense-in-depth: a JS caller or `as unknown as ScrubbedCause`
      // cast can satisfy the compile-time type structurally with an
      // Error / Response / fetch-failure object that carries
      // headers, bodies, stacks, or nested .cause / .config /
      // .request properties. The constructor must not propagate any
      // of those.
      const dangerous = {
        name: 'AxiosError',
        message: 'Request failed with status code 401',
        status: 401,
        // Hostile fields that must NOT reach Error.cause:
        config: { headers: { Authorization: 'Bearer SECRET-TOKEN' } },
        request: { _header: 'POST / HTTP/1.1\nAuthorization: Bearer SECRET' },
        stack: 'Error: ...\n  at /path/to/secret-file.ts:42',
      } as unknown as import('./errors.js').ScrubbedCause;

      const e = new AdapterErrorException({
        kind: 'transport',
        message: 'auth failed',
        cause: dangerous,
      });

      expect(e.cause).toEqual({
        name: 'AxiosError',
        message: 'Request failed with status code 401',
        status: 401,
      });
      // Pointer inequality proves the constructor copied rather than
      // forwarded the live object.
      expect(e.cause).not.toBe(dangerous);
      const inspected = JSON.stringify(e.cause);
      expect(inspected).not.toContain('SECRET-TOKEN');
      expect(inspected).not.toContain('Authorization');
      expect(inspected).not.toContain('secret-file');
    });

    it('omits Error.cause when the transport variant supplies no cause', () => {
      const e = new AdapterErrorException({
        kind: 'transport',
        message: 'unspecified network failure',
      });
      expect(e.cause).toBeUndefined();
    });

    it('omits Error.cause for variants that do not carry one in the union', () => {
      const e = new AdapterErrorException({
        kind: 'rejected',
        code: 'V99',
        message: 'jurisdiction said no',
      });
      expect(e.cause).toBeUndefined();
    });

    describe('SubmitterCredentials redaction', () => {
      it('redacts material under JSON.stringify', () => {
        const creds = new SubmitterCredentials({
          jurisdiction: 'ontario-mcedt',
          material: {
            certificatePem: '-----BEGIN CERTIFICATE-----\nSECRET\n-----END CERTIFICATE-----',
            privateKeyPem: '-----BEGIN PRIVATE KEY-----\nSECRET\n-----END PRIVATE KEY-----',
          },
        });
        const json = JSON.stringify(creds);
        expect(json).not.toContain('SECRET');
        expect(json).not.toContain('BEGIN CERTIFICATE');
        expect(json).toContain('[redacted]');
      });

      it('redacts material under util.inspect (console.log path)', async () => {
        const { inspect } = await import('node:util');
        const creds = new SubmitterCredentials({
          jurisdiction: 'ontario-mcedt',
          material: {
            certificatePem: 'SECRET-CERT',
            privateKeyPem: 'SECRET-KEY',
          },
        });
        const inspected = inspect(creds);
        expect(inspected).not.toContain('SECRET-CERT');
        expect(inspected).not.toContain('SECRET-KEY');
        expect(inspected).toContain('[redacted]');
      });

      it('redacts material when wrapped in a plain object that is logged', async () => {
        // Common shape: a structured logger receives `{ creds, op: 'submit' }`.
        // Both the JSON path and the inspect path must redact.
        const { inspect } = await import('node:util');
        const creds = new SubmitterCredentials({
          jurisdiction: 'ontario-mcedt',
          material: { certificatePem: 'SECRET-WRAPPED' },
        });
        const wrapped = { op: 'submit', creds };
        expect(JSON.stringify(wrapped)).not.toContain('SECRET-WRAPPED');
        expect(inspect(wrapped)).not.toContain('SECRET-WRAPPED');
      });

      it('exposes material only through the get accessor', () => {
        const creds = new SubmitterCredentials({
          jurisdiction: 'ontario-mcedt',
          material: { certificatePem: 'value' },
        });
        expect(creds.get('certificatePem')).toBe('value');
        expect(creds.get('missing')).toBeUndefined();
        expect(creds.has('certificatePem')).toBe(true);
        // No `material` field on the surface — adapters cannot accidentally
        // template-string the bag's contents into an error message.
        expect((creds as unknown as { material?: unknown }).material).toBeUndefined();
      });
    });

    it('throws and catches as Error (consumer ergonomics)', () => {
      const throwIt = () => {
        throw new AdapterErrorException({
          kind: 'transport',
          message: 'EHOSTUNREACH',
        });
      };
      try {
        throwIt();
        expect.fail('expected throw');
      } catch (caught) {
        expect(caught).toBeInstanceOf(Error);
        expect(caught).toBeInstanceOf(AdapterErrorException);
        if (caught instanceof AdapterErrorException) {
          expect(caught.error.kind).toBe('transport');
        }
      }
    });
  });

  describe('PollOutcome variants', () => {
    it('pending outcome has no result field', () => {
      const outcome: PollOutcome = { kind: 'pending' };
      expect(outcome.kind).toBe('pending');
    });

    it('resolved outcome carries an AdjudicationResult', () => {
      const result: AdjudicationResult = {
        jurisdiction: 'ontario-mcedt',
        externalId: 'edt-1',
        lineResults: [
          { itemIndex: 0, outcome: { kind: 'accepted', paidCents: 8000 } },
        ],
      };
      const outcome: PollOutcome = { kind: 'resolved', result };
      if (outcome.kind === 'resolved') {
        expect(outcome.result.lineResults).toHaveLength(1);
      }
    });
  });

  describe('LineOutcome variants', () => {
    it('accepted outcome carries paid amount', () => {
      const outcome: LineOutcome = { kind: 'accepted', paidCents: 2000 };
      expect(outcome.paidCents).toBe(2000);
    });

    it('rejected outcome carries reason code + message', () => {
      const outcome: LineOutcome = {
        kind: 'rejected',
        reasonCode: 'V51',
        message: 'service date out of range',
      };
      expect(outcome.reasonCode).toBe('V51');
    });
  });
});
