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

declare const scrubbedCauseBrand: unique symbol;

/**
 * Sanitized cause attached to a `transport`-variant `AdapterError`.
 * The brand is constructed only by {@link scrubCause} — the raw
 * exception cannot satisfy it structurally, even via spread or
 * `Object.assign`, so a fetch/TLS error carrying request headers,
 * bodies, or stack frames cannot reach `Error.cause` accidentally.
 */
export interface ScrubbedCause {
  readonly name: string;
  readonly message: string;
  readonly status?: number;
  readonly [scrubbedCauseBrand]: true;
}

/**
 * Construct a {@link ScrubbedCause} from arbitrary input. The only
 * legitimate constructor — adapters MUST route raw `fetch`/TLS
 * failures through this. Returns the brand on success, `null` if
 * input has no usable surface (e.g. `null`, primitive, or an object
 * with neither `name` nor `message`).
 */
export function scrubCause(input: unknown): ScrubbedCause | null {
  if (input === null || typeof input !== 'object') return null;
  const src = input as { name?: unknown; message?: unknown; status?: unknown };
  const name = typeof src.name === 'string' ? src.name : 'Error';
  const message = typeof src.message === 'string' ? src.message : '';
  if (name === 'Error' && message === '') return null;
  const out: { name: string; message: string; status?: number } = { name, message };
  if (typeof src.status === 'number' && Number.isFinite(src.status)) {
    out.status = src.status;
  }
  return out as ScrubbedCause;
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
 * sanitize. (See `describeEmitError` / `describeEncodeError` in
 * `@loomantix/billing-adapter-ohip` for the OHIP-side scrubbing pattern.)
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
    default:
      throw new Error(`unhandled AdapterError variant: ${(error as { kind?: unknown }).kind}`);
  }
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
function safeError(error: AdapterError): AdapterError {
  // Re-scrub `cause` defensively. The compile-time `ScrubbedCause`
  // brand is the first line; `scrubCause` runtime-rebuilds the value
  // so a forged `as`-cast can't carry hostile fields onto `this.error`.
  if (error.kind !== 'transport' || error.cause === undefined) return error;
  const rescrubbed = scrubCause(error.cause);
  return rescrubbed === null
    ? { kind: 'transport', message: error.message }
    : { kind: 'transport', message: error.message, cause: rescrubbed };
}

export class AdapterErrorException extends Error {
  readonly error: AdapterError;

  constructor(error: AdapterError) {
    const safe = safeError(error);
    const options =
      safe.kind === 'transport' && safe.cause !== undefined
        ? { cause: safe.cause }
        : undefined;
    super(`${safe.kind}: ${describeAdapterError(safe)}`, options);
    this.name = 'AdapterErrorException';
    this.error = safe;
  }

  toJSON(): { readonly name: string; readonly message: string; readonly kind: AdapterError['kind'] } {
    return { name: this.name, message: this.message, kind: this.error.kind };
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `${this.name}: ${this.message}`;
  }
}
