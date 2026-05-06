/**
 * Discriminated `EncodeError` union for record-level encoding failures.
 *
 * Per contract obligation 1, `validate` aggregates every finding for the caller.
 * Encoders run *after* validation has passed, so reaching an encoder error
 * means the caller bypassed `validate` or the validator missed a constraint.
 * Encoders fail-closed: the wire format is regulated and silent corruption
 * costs more than a thrown exception.
 *
 * Each variant carries enough context to surface the failure to the user:
 * the offending field path (e.g. `'items[3].feeCode'`), a stable machine
 * code, and the value that failed.
 */

interface EncodeErrorBase {
  readonly path: string;
  readonly message: string;
}

/**
 * The field contains a character outside the MCEDT-permitted ASCII set, or
 * a lowercase alphabetic character. Per the format reference: "All
 * alphabetic characters must be UPPER-CASE."
 */
export interface InvalidCharacterClassError extends EncodeErrorBase {
  readonly kind: 'invalid-character-class';
  readonly value: string;
  readonly badCharCode: number;
  readonly badCharIndex: number;
}

/** The field's value exceeds the field's fixed wire-format width. */
export interface FieldTooLongError extends EncodeErrorBase {
  readonly kind: 'field-too-long';
  readonly value: string;
  readonly width: number;
}

/**
 * The field requires an exact width (e.g. `groupNumber` is exactly 4 chars,
 * not "up to 4") and the supplied value is the wrong length.
 */
export interface FieldWrongWidthError extends EncodeErrorBase {
  readonly kind: 'field-wrong-width';
  readonly value: string;
  readonly expectedWidth: number;
  readonly actualWidth: number;
}

/** A numeric field received a non-digit character. */
export interface InvalidNumericError extends EncodeErrorBase {
  readonly kind: 'invalid-numeric';
  readonly value: string;
}

/** A date field is not in `YYYY-MM-DD` form, or has out-of-range components. */
export interface InvalidDateError extends EncodeErrorBase {
  readonly kind: 'invalid-date';
  readonly value: string;
}

export type EncodeError =
  | InvalidCharacterClassError
  | FieldTooLongError
  | FieldWrongWidthError
  | InvalidNumericError
  | InvalidDateError;

/**
 * Stable, machine-readable codes for encoder failures, derived from the
 * discriminated `EncodeError` union so the two cannot drift apart.
 */
export type EncodeErrorKind = EncodeError['kind'];

/**
 * Thrown by record encoders. Wraps a discriminated `EncodeError` payload so
 * callers can `instanceof EncodeException` then narrow on `error.kind`.
 */
export class EncodeException extends Error {
  readonly error: EncodeError;

  constructor(error: EncodeError) {
    super(`${error.path}: ${error.message}`);
    this.name = 'EncodeException';
    this.error = error;
  }
}
