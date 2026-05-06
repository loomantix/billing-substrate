/**
 * MCEDT file orchestrator surface. Wraps the record encoders to produce a
 * complete `.ohip` byte stream from a `ClaimBatch`.
 */

export {
  emitClaimFile,
  type OntarioMcedtConfig,
} from './emit-claim-file.js';
export {
  EmitException,
  type EmitError,
  type EmitErrorKind,
  type EmptyBatchError,
  type FileTooLargeError,
  type InconsistentGroupFieldError,
  type PatientMissingRequiredFieldError,
} from './errors.js';
