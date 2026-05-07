/**
 * Discriminated `AdapterError` data shape and the `AdapterErrorException`
 * Error subclass adapters throw to surface it.
 *
 * Per the contract obligations:
 * - Adapters MUST exhaust these variants and never collapse failure modes
 *   into `{ kind: 'transport', message: string }` when a more specific
 *   variant applies.
 * - Consumers are expected to handle `validation`, `rejected`, and
 *   `not-supported` distinctly from transient-retry variants
 *   (`transport`, `rate-limited`, `timeout`).
 *
 * Adapters surface failures by throwing `new AdapterErrorException(error)`,
 * not by throwing the bare payload. The wrapper subclasses `Error` so stack
 * traces are captured, `instanceof Error` is true, and structured loggers
 * (pino, Sentry, OpenTelemetry exporters) fingerprint the throw correctly.
 * Consumers narrow on `caught.error.kind`.
 */

import type { ValidationReport } from './types.js';

/**
 * Sanitized cause information attached to a `transport`-variant
 * `AdapterError`. The contract requires adapters to scrub raw exception
 * objects before surfacing them: a raw `fetch` failure or TLS error
 * carries request headers (Authorization, mTLS material), request
 * bodies (PHI from the rendered claim), or response payloads — all of
 * which `Error.cause` would propagate to consumer loggers (Sentry,
 * OpenTelemetry, pino) by default.
 *
 * Adapters MUST construct this shape from the underlying failure
 * deliberately, copying only the fields listed below. `name` and
 * `message` are required; `status` is optional for HTTP-style failures.
 *
 * If you need richer context for server-side debugging, log it
 * separately (with appropriate scrubbing) — do not stuff it into the
 * surfaced cause.
 */
export interface ScrubbedCause {
  readonly name: string;
  readonly message: string;
  readonly status?: number;
}

export type AdapterError =
  | {
      readonly kind: 'validation';
      readonly report: ValidationReport;
    }
  | {
      readonly kind: 'transport';
      readonly message: string;
      readonly cause?: ScrubbedCause;
    }
  | {
      readonly kind: 'auth';
      readonly message: string;
    }
  | {
      readonly kind: 'rejected';
      readonly code: string;
      readonly message: string;
    }
  | {
      readonly kind: 'rate-limited';
      readonly retryAfterMs?: number;
    }
  | {
      readonly kind: 'timeout';
      readonly afterMs: number;
    }
  | {
      readonly kind: 'not-supported';
      readonly operation: string;
    };

/**
 * Variant-specific description of an `AdapterError` payload. Used to
 * build the `Error.message` of `AdapterErrorException`, which prefixes
 * the kind: `<kind>: <describeAdapterError(error)>`.
 *
 * Always returns a non-empty string. For variants where the adapter
 * supplies a free-text `message` (`transport`, `auth`, `rejected`), an
 * empty author-supplied message falls back to a placeholder so the final
 * `Error.message` never collapses to the bare kind label — defending
 * against the same silent-failure shape this wrapper exists to fix.
 *
 * Adapters MUST scrub PHI from any string they surface through
 * `AdapterError.message` / `ValidationViolation.message` *before* the
 * payload reaches this helper. This helper just formats; it does not
 * sanitize. (See `describeEmitError` in `@loomantix/billing-adapter-ohip`
 * for the OHIP-side scrubbing pattern.)
 */
export function describeAdapterError(error: AdapterError): string {
  switch (error.kind) {
    case 'validation': {
      const errorCount = error.report.violations.filter(
        (v) => v.severity === 'error',
      ).length;
      return `${errorCount} blocking violation${errorCount === 1 ? '' : 's'}`;
    }
    case 'transport':
      return error.message || '(no message supplied)';
    case 'auth':
      return error.message || '(no message supplied)';
    case 'rejected':
      return `${error.code}: ${error.message || '(no message supplied)'}`;
    case 'rate-limited':
      return error.retryAfterMs !== undefined
        ? `retry after ${error.retryAfterMs} ms`
        : 'no retry hint supplied';
    case 'timeout':
      return `after ${error.afterMs} ms`;
    case 'not-supported':
      return error.operation;
    default: {
      const exhaustive: never = error;
      return exhaustive;
    }
  }
}

function narrowScrubbedCause(cause: ScrubbedCause): ScrubbedCause {
  const narrowed: { name: string; message: string; status?: number } = {
    name: typeof cause.name === 'string' ? cause.name : 'Error',
    message: typeof cause.message === 'string' ? cause.message : '',
  };
  if (typeof cause.status === 'number') {
    narrowed.status = cause.status;
  }
  return narrowed;
}

/**
 * Error thrown by adapter methods to surface an `AdapterError` payload.
 *
 * Subclasses `Error` so stack traces, `instanceof Error`, and structured
 * loggers behave as Node operators expect. The discriminated payload is
 * available as `.error`; consumers narrow on `.error.kind`.
 *
 * Mirrors the `EmitException` / `EncodeException` pattern used internally
 * by adapters (e.g. `@loomantix/billing-adapter-ohip`) for the same
 * stack-trace / instanceof reasons. The contract-package wrapper is the
 * one that crosses the public adapter boundary; adapter-internal
 * exception types stay private to their package.
 *
 * @example
 * ```ts
 * try {
 *   await adapter.render(batch);
 * } catch (e) {
 *   if (e instanceof AdapterErrorException) {
 *     if (e.error.kind === 'validation') {
 *       surfaceReport(e.error.report);
 *     }
 *   }
 * }
 * ```
 */
export class AdapterErrorException extends Error {
  readonly error: AdapterError;

  constructor(error: AdapterError) {
    // Propagate a narrowed copy of the underlying cause into
    // `Error.cause` so structured loggers (util.inspect, Sentry, OTel)
    // render the chain. The compile-time `ScrubbedCause` type narrows
    // adapters' input; this runtime copy defends against `as` casts
    // and JS-bypass callers that satisfy the type structurally with a
    // raw fetch error / Response / TLS failure carrying credentials
    // or PHI in `.config`, `.request.headers`, `.stack`, etc.
    const options =
      error.kind === 'transport' && error.cause !== undefined
        ? { cause: narrowScrubbedCause(error.cause) }
        : undefined;
    super(`${error.kind}: ${describeAdapterError(error)}`, options);
    this.name = 'AdapterErrorException';
    this.error = error;
  }
}
