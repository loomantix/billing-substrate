/**
 * Record-level encoders for Ontario MCEDT files.
 *
 * Each encoder is a pure function (`Input → Uint8Array`) producing the
 * exact 79-byte record body. File-level orchestration (CR terminators,
 * record ordering, count derivation) lands in [3/6].
 */

export { encodeBatchHeader, type BatchHeaderInput } from './batch-header.js';
export { encodeClaimHeader, type ClaimHeaderInput } from './claim-header.js';
export { encodeItemRecord, type ItemRecordInput } from './item-record.js';
export { encodeTrailer, type TrailerInput } from './trailer.js';

export {
  EncodeException,
  type EncodeError,
  type EncodeErrorKind,
  type FieldTooLongError,
  type FieldWrongWidthError,
  type InvalidCharacterClassError,
  type InvalidDateError,
  type InvalidNumericError,
} from './errors.js';
