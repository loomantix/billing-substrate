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

export type EmitError =
  | EmptyBatchError
  | FileTooLargeError
  | InconsistentGroupFieldError
  | PatientMissingRequiredFieldError;

export type EmitErrorKind = EmitError['kind'];

export class EmitException extends Error {
  readonly error: EmitError;

  constructor(error: EmitError) {
    super(`${error.kind}: ${error.message}`);
    this.name = 'EmitException';
    this.error = error;
  }
}
