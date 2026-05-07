/**
 * `@loomantix/billing-adapter` — contract package for the billing-substrate.
 *
 * Per the [contract spec](https://github.com/loomantix/billing-substrate/blob/main/docs/architecture/contract-design.md),
 * exports the formal contract every jurisdictional adapter implements:
 *
 * - {@link ClaimRenderer} — Phase 1 capability (validate + render)
 * - {@link ClaimSubmitter} — Phase 2+ capability (submit + poll)
 * - {@link JurisdictionAdapter} — union type, narrow via {@link canSubmit}
 *
 * Plus the supporting data shapes ({@link ClaimBatch}, {@link ClaimItem},
 * {@link SubmitterIdentity}, {@link RenderedClaim}, {@link ValidationReport}),
 * the discriminated {@link AdapterError} union, and the
 * {@link AdapterErrorException} wrapper adapters throw to surface it.
 *
 * See [`docs/architecture/contract-design.md`](https://github.com/loomantix/billing-substrate/blob/main/docs/architecture/contract-design.md)
 * for the formal spec.
 */

// Adapter contract
export { canSubmit } from './adapter.js';
export type {
  ClaimRenderer,
  ClaimSubmitter,
  JurisdictionAdapter,
} from './adapter.js';

// Credentials
export { SubmitterCredentials } from './credentials.js';
export type { SubmitterCredentialsInput } from './credentials.js';

// Submission lifecycle
export type {
  AdjudicationResult,
  LineOutcome,
  LineResult,
  OpaqueAdapterState,
  PollOutcome,
  SubmitReceipt,
} from './submission.js';

// Errors
export { AdapterErrorException, describeAdapterError, scrubCause } from './errors.js';
export type { AdapterError, ScrubbedCause } from './errors.js';

// Data shapes
export {
  asBatchItemIndex,
  isBlockingFinding,
  isoDateToUtcMs,
  parseIsoDate,
} from './types.js';
export type {
  BatchItemIndex,
  ClaimBatch,
  ClaimItem,
  IsoDate,
  Jurisdiction,
  PatientReference,
  RenderedClaim,
  ServicePeriod,
  Severity,
  SubmitterIdentity,
  ValidationReport,
  ValidationViolation,
} from './types.js';
