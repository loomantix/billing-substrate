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

import type { BatchItemIndex } from '@loomantix/billing-adapter';

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
  readonly itemIndex: BatchItemIndex;
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
  readonly itemIndex: BatchItemIndex;
}

/** Shared between the validator finding and the emit-layer exception. */
export function missingItemMessage(itemIndex: BatchItemIndex | number): string {
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
 * PHI-free `Error.message`. The `message` field on each variant can
 * carry PHI (e.g. `inconsistent-group-field`'s `groupKey =
 * HIN|DoB|date`); the structured payload stays accessible via `.error`.
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
    default:
      throw new Error(`unhandled EmitError variant: ${(error as { kind?: unknown }).kind}`);
  }
}

export class EmitException extends Error {
  readonly error: EmitError;

  constructor(error: EmitError) {
    super(buildEmitExceptionMessage(error));
    this.name = 'EmitException';
    this.error = error;
  }

  toJSON(): { readonly name: string; readonly message: string; readonly kind: EmitError['kind'] } {
    return { name: this.name, message: this.message, kind: this.error.kind };
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `${this.name}: ${this.message}`;
  }
}
