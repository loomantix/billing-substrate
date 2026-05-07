/**
 * Discriminated `EmitError` union for orchestrator-level failures.
 *
 * Encoder failures surface via `EncodeException` (see `../records/errors.ts`).
 * Orchestrator failures are conditions the encoders don't see — empty
 * batches, file-size precondition violations, and structural input bugs the
 * encoders can't detect (because by the time bytes are being assembled, the
 * caller's structural mistake has already collapsed into a valid-but-wrong
 * value).
 */

interface EmitErrorBase {
  readonly message: string;
}

/** Render was called with no items. The encoder refuses to produce an empty file. */
export interface EmptyBatchError extends EmitErrorBase {
  readonly kind: 'empty-batch';
}

/** The assembled file would exceed the MOH-imposed 10 MB size limit. */
export interface FileTooLargeError extends EmitErrorBase {
  readonly kind: 'file-too-large';
  readonly fileSize: number;
  readonly maxSize: number;
}

/**
 * Two `ClaimItem`s belong to the same claim envelope (same patient + day)
 * but disagree on a field the envelope encodes only once. Without this
 * check, the orchestrator would silently keep one value and drop the other,
 * producing a wire artifact that doesn't reflect the caller's data.
 */
export interface InconsistentGroupFieldError extends EmitErrorBase {
  readonly kind: 'inconsistent-group-field';
  readonly field: 'serviceLocation' | 'versionCode';
  readonly groupKey: string;
  readonly firstValue: string;
  readonly conflictingValue: string;
}

/**
 * A `ClaimItem` carries a `patient` block but a structurally required
 * `PatientReference` field (`healthNumber`, `dateOfBirth`) is the empty
 * string. TypeScript can't catch this — `string` includes `''`. Without
 * this check the orchestrator would silently emit a Q-code-style HEH
 * (blank HIN/DoB) for what the caller intended as a patient-linked claim.
 */
export interface PatientMissingRequiredFieldError extends EmitErrorBase {
  readonly kind: 'patient-missing-required-field';
  readonly field: 'healthNumber' | 'dateOfBirth';
  readonly itemIndex: number;
}

/**
 * The caller-supplied `ClaimBatch.items` array contains a falsy slot at
 * `itemIndex`. TypeScript's `readonly ClaimItem[]` admits sparse arrays
 * and `null`/`undefined` values at runtime; silently skipping them
 * would drop a claim the caller submitted without surfacing it as a
 * finding — and would also break the `LineResult.itemIndex` mapping
 * downstream when poll results come back from the jurisdiction.
 */
export interface MissingItemError extends EmitErrorBase {
  readonly kind: 'missing-item';
  readonly itemIndex: number;
}

/**
 * Canonical human message for the `missing-item` finding, used by both
 * the validator (as a `ValidationViolation.message`) and the emit
 * layer (as the `MissingItemError.message`). Single source of truth so
 * the two can't drift.
 */
export function missingItemMessage(itemIndex: number): string {
  return `items[${itemIndex}] is missing (null, undefined, or sparse-array hole)`;
}

export type EmitError =
  | EmptyBatchError
  | FileTooLargeError
  | InconsistentGroupFieldError
  | PatientMissingRequiredFieldError
  | MissingItemError;

export type EmitErrorKind = EmitError['kind'];

/**
 * Build a PHI-free `Error.message` summary from the structured payload.
 * The `message` field on each `EmitError` variant CAN carry PHI (e.g.
 * the `inconsistent-group-field` variant interpolates `groupKey =
 * HIN|DoB|date`), so the exception's `.message` MUST NOT mirror it
 * directly — anything that catches and logs `e.message` (Sentry's
 * default fingerprint, `util.inspect`, `e.toString()`) leaks.
 *
 * The structured payload remains accessible via `.error` for
 * in-package handlers (e.g. `translateRenderException`).
 */
function buildEmitExceptionMessage(error: EmitError): string {
  switch (error.kind) {
    case 'empty-batch':
      return 'empty-batch: zero claim items';
    case 'file-too-large':
      return `file-too-large: ${error.fileSize} > ${error.maxSize}`;
    case 'inconsistent-group-field':
      return `inconsistent-group-field: ${error.field}`;
    case 'patient-missing-required-field':
      return `patient-missing-required-field: items[${error.itemIndex}].${error.field}`;
    case 'missing-item':
      return `missing-item: items[${error.itemIndex}]`;
  }
}

export class EmitException extends Error {
  readonly error: EmitError;

  constructor(error: EmitError) {
    super(buildEmitExceptionMessage(error));
    this.name = 'EmitException';
    this.error = error;
  }
}
