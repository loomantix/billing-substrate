/**
 * `@loomantix/billing-adapter-ohip` — Ontario MCEDT reference adapter.
 *
 * Implements the `ClaimRenderer` tier of the substrate's `JurisdictionAdapter`
 * contract per the [contract spec](https://github.com/loomantix/billing-substrate/blob/main/docs/architecture/contract-design.md):
 * `validate` aggregates every wire-format violation, `render` produces a
 * deterministic byte stream with a verifiable SHA-256 content hash.
 *
 * `ClaimSubmitter` (`submit` / `poll`) lands in Phase 2+ after deployment-side
 * MCEDT conformance testing.
 */

import {
  AdapterErrorException,
  type AdapterError,
  type ClaimBatch,
  type ClaimRenderer,
  type Jurisdiction,
  type RenderedClaim,
  type ValidationReport,
  type ValidationViolation,
} from '@loomantix/billing-adapter';

import {
  emitClaimFile,
  type OntarioMcedtConfig,
} from './emit/emit-claim-file.js';
import { EmitException, type EmitError } from './emit/errors.js';
import { EncodeException } from './records/errors.js';
import {
  validateBatch,
  type ValidateBatchOptions,
} from './validate/validate-batch.js';

export type {
  OntarioMcedtIdentifiers,
} from './types.js';
export { ONTARIO_MCEDT_IDENTIFIER_KEYS } from './types.js';

export {
  encodeBatchHeader,
  encodeClaimHeader,
  encodeItemRecord,
  encodeTrailer,
  EncodeException,
  type BatchHeaderInput,
  type ClaimHeaderInput,
  type ItemRecordInput,
  type TrailerInput,
  type EncodeError,
  type EncodeErrorKind,
  type FieldTooLongError,
  type FieldWrongWidthError,
  type InvalidCharacterClassError,
  type InvalidDateError,
  type InvalidNumericError,
} from './records/index.js';

export {
  emitClaimFile,
  EmitException,
  type OntarioMcedtConfig,
  type EmitError,
  type EmitErrorKind,
  type EmptyBatchError,
  type FileTooLargeError,
  type InconsistentGroupFieldError,
  type PatientMissingRequiredFieldError,
} from './emit/index.js';

export {
  validateBatch,
  KNOWN_FEE_CODES,
  type ValidateBatchOptions,
} from './validate/index.js';

/**
 * Construction-time options for {@link OntarioMcedtAdapter}.
 */
export interface OntarioMcedtAdapterOptions {
  /**
   * Static configuration the adapter holds for the lifetime of the
   * instance: spec version, MOH identifiers, and the caller-assigned
   * batch identifier. Per contract obligation 6, the adapter is
   * stateless across invocations — config goes in the constructor,
   * per-call data goes in the methods.
   */
  readonly config: OntarioMcedtConfig;
  /**
   * Optional clock injection used by validation (stale-date and
   * future-period warnings). Defaults to {@link Date} at call time.
   */
  readonly validationOptions?: ValidateBatchOptions;
}

/**
 * Reference adapter for Ontario's Medical Claims Electronic Data Transfer
 * (MCEDT) channel.
 *
 * - `validate` returns a {@link ValidationReport} aggregating every
 *   wire-format-level finding (per contract obligation 1). Errors block
 *   render; warnings do not.
 * - `render` runs validation first; if any non-warning violation is
 *   present, throws an `AdapterErrorException` wrapping
 *   `{ kind: 'validation', report }`. Otherwise produces a
 *   `RenderedClaim` with deterministic bytes and verifiable SHA-256 hash
 *   (obligations 2 and 3). If the encoder layer detects a wire-format
 *   invariant the validator missed (defense in depth), `render`
 *   translates the internal `EmitException` / `EncodeException` into an
 *   `AdapterErrorException` wrapping `{ kind: 'validation' }` with a
 *   synthesized single-violation report — these are consumer-fixable
 *   input problems, not jurisdiction rejections, so `validation` is the
 *   right contract variant for callers to route. Genuinely unknown
 *   exceptions are wrapped as `{ kind: 'rejected' }` with a generic
 *   message rather than leaking arbitrary internal text (which could
 *   carry PHI from downstream callers). Every throw is the
 *   `AdapterErrorException` Error-subclass wrapper, never the bare
 *   payload — see the substrate's `contract-design.md` Error model.
 *
 * `submit` and `poll` are intentionally absent — this adapter is render-
 * only at this phase. `canSubmit(adapter)` returns `false`.
 */
export class OntarioMcedtAdapter implements ClaimRenderer {
  readonly jurisdiction: Jurisdiction = 'ontario-mcedt';

  private readonly config: OntarioMcedtConfig;
  private readonly validationOptions: ValidateBatchOptions;

  constructor(options: OntarioMcedtAdapterOptions) {
    this.config = Object.freeze({
      ...options.config,
      identifiers: Object.freeze({ ...options.config.identifiers }),
    });
    const incoming = options.validationOptions ?? {};
    this.validationOptions = Object.freeze(
      incoming.now !== undefined
        ? { now: new Date(incoming.now.getTime()) }
        : {},
    );
  }

  validate(batch: ClaimBatch): ValidationReport {
    return validateBatch(batch, this.config, this.validationOptions);
  }

  async render(batch: ClaimBatch): Promise<RenderedClaim> {
    const report = this.validate(batch);
    const hasBlockingViolation = report.violations.some(
      (v) => v.severity !== 'warning',
    );
    if (hasBlockingViolation) {
      throw new AdapterErrorException({ kind: 'validation', report });
    }
    try {
      return await emitClaimFile(batch, this.config);
    } catch (cause) {
      // Do NOT attach `cause` to the wrapper. The internal exception
      // payloads expose structured fields that carry PHI:
      // `EmitException.error.groupKey` is `${HIN}|${DoB}|${date}` for the
      // `inconsistent-group-field` variant, and `EncodeException.error.value`
      // is the raw field that failed encoding (which may itself be PHI —
      // a HIN, DoB, name, etc.). `translateRenderException` formats the
      // wrapper's surface message for known shapes via `describeEmitError`
      // (which omits these fields by construction), but it does NOT
      // recursively sanitize the inner exception object. `Error.cause`
      // crosses the public adapter boundary and structured loggers
      // (Sentry, OTel, util.inspect) serialize the chain by default, so
      // attaching the raw cause would re-expose the structured PHI fields
      // even though the surface message is sanitized. The wrapper's own
      // stack frame plus the synthesized ValidationReport's `code` and
      // `path` are sufficient for server-side debugging — each `code` is
      // unique to one check site.
      throw new AdapterErrorException(translateRenderException(cause));
    }
  }
}

/**
 * Sanitized human-readable summary of an `EmitError`. PHI-scrubbing
 * happens here: the original `EmitException.message` for the
 * `inconsistent-group-field` variant interpolates `groupKey`, which is
 * a `${HIN}|${DoB}|${serviceDate}` triple and therefore PHI. The output
 * of this function is what crosses the public adapter boundary, so it
 * MUST NOT echo identifiers.
 */
function describeEmitError(error: EmitError): string {
  switch (error.kind) {
    case 'empty-batch':
      return error.message;
    case 'file-too-large':
      return `assembled file would exceed the MOH 10 MB limit (${error.fileSize} bytes > ${error.maxSize})`;
    case 'inconsistent-group-field':
      return `items in a single claim envelope disagree on ${error.field}: ${JSON.stringify(error.firstValue)} vs ${JSON.stringify(error.conflictingValue)}`;
    case 'patient-missing-required-field':
      return `items[${error.itemIndex}] has a patient block with empty ${error.field}`;
  }
}

function pathForEmitError(error: EmitError): string | undefined {
  if (error.kind === 'patient-missing-required-field') {
    return `items[${error.itemIndex}].patient.${error.field}`;
  }
  return undefined;
}

/**
 * Translate an exception thrown beneath `render` into a contract
 * `AdapterError`. Defense in depth: the validator should have caught
 * any constraint that would cause an encoder to throw, but if one
 * slips through the consumer must still see an `AdapterError` shape —
 * never an OHIP-internal exception type and never a raw `Error`.
 *
 * - Known `EmitException` / `EncodeException` → `kind: 'validation'`
 *   carrying a synthesized single-violation report. These are
 *   structural input problems the consumer can fix, not jurisdiction
 *   rejections, so the `validation` variant is the right contract
 *   surface for caller routing.
 * - Unknown exceptions → `kind: 'rejected'` with a stable generic
 *   message. The public message is intentionally sparse to avoid PHI
 *   leakage from arbitrary downstream sources.
 *
 * The original exception is intentionally NOT propagated through
 * `Error.cause` at the throw site. Internal exception payloads carry
 * PHI (`EmitException.groupKey`, `EncodeException.value`) and
 * `Error.cause` crosses the public adapter boundary — structured
 * loggers serialize cause chains by default. Server-side debugging
 * uses the wrapper's own stack frame plus the synthesized violation's
 * `code` / `path`; the inner stack frame is recoverable from those
 * since each `code` is unique to a specific check site.
 *
 * Exported for direct testing.
 */
export function translateRenderException(cause: unknown): AdapterError {
  if (cause instanceof EmitException) {
    const violation: ValidationViolation = pathForEmitError(cause.error) !== undefined
      ? {
          severity: 'error',
          code: cause.error.kind,
          message: describeEmitError(cause.error),
          path: pathForEmitError(cause.error) as string,
        }
      : {
          severity: 'error',
          code: cause.error.kind,
          message: describeEmitError(cause.error),
        };
    return { kind: 'validation', report: { violations: [violation] } };
  }
  if (cause instanceof EncodeException) {
    const violation: ValidationViolation = {
      severity: 'error',
      code: cause.error.kind,
      message: cause.error.message,
      path: cause.error.path,
    };
    return { kind: 'validation', report: { violations: [violation] } };
  }
  return {
    kind: 'rejected',
    code: 'internal-error',
    message:
      'unexpected internal error in render; consult adapter logs for details',
  };
}
