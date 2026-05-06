/**
 * The `JurisdictionAdapter` contract.
 *
 * Two-tier composed-trait pattern with capability narrowing via property
 * test (see `canSubmit`). Adapters declare their tier by which interface
 * they implement; consumers narrow to access tier-specific methods.
 *
 * Per the contract spec:
 * - Phase 1 of every adapter ships as `ClaimRenderer` (validate + render
 *   only). Sufficient for file-emitter use cases where the consumer hands
 *   the rendered file to the jurisdiction through an existing channel.
 * - Phase 2+ tier upgrades to `ClaimSubmitter` after the deployment passes
 *   the jurisdiction's conformance testing.
 *
 * Hard rules every adapter MUST enforce (binding contract obligations):
 * 1. `validate` returns *every* violation, not just the first.
 * 2. `render` is deterministic (same input → same bytes).
 * 3. `RenderedClaim.contentHashSha256Hex` is the SHA-256 of `bytes`.
 * 4. `submit` is idempotent against the same `rendered` artifact.
 * 5. Adapter does not persist `SubmitterCredentials.material` to disk,
 *    log, or any non-volatile store.
 * 6. Adapter is stateless across invocations; all state required for
 *    `poll` lives in the persisted `SubmitReceipt`.
 */

import type { SubmitterCredentials } from './credentials.js';
import type { PollOutcome, SubmitReceipt } from './submission.js';
import type {
  ClaimBatch,
  Jurisdiction,
  RenderedClaim,
  SubmitterIdentity,
  ValidationReport,
} from './types.js';

/**
 * Phase 1 capability: validate + render. Every adapter implements this
 * tier; it is the minimum useful surface.
 */
export interface ClaimRenderer {
  readonly jurisdiction: Jurisdiction;

  /**
   * Pre-flight validation. Returns a structured report aggregating *every*
   * finding (not first-error short-circuit) so callers can surface all
   * issues at once. A report with no `severity: 'error'` violations means
   * the batch is renderable.
   */
  validate(batch: ClaimBatch): ValidationReport;

  /**
   * Render the batch into the jurisdiction's wire format. Pure, no side
   * effects — same input MUST produce same bytes (deterministic).
   *
   * MAY throw `AdapterErrorException` (typically `kind: 'validation'`) if
   * validation passed at validate-time but the renderer detects a
   * constraint violation downstream. Always throws the exception wrapper,
   * never the bare `AdapterError` payload — consumers rely on
   * `instanceof Error` and on `Error.stack` for observability.
   */
  render(batch: ClaimBatch): Promise<RenderedClaim>;
}

/**
 * Phase 2+ capability: full submission lifecycle. An adapter ships this
 * tier only after the deployment that runs it has passed the
 * jurisdiction's conformance testing.
 */
export interface ClaimSubmitter extends ClaimRenderer {
  /**
   * Upload + submit the rendered batch to the jurisdiction's adjudication
   * system. Caller persists the returned `SubmitReceipt` and uses it on
   * later `poll` calls.
   *
   * Idempotent on the receipt level: re-submitting the same `rendered`
   * MUST produce a receipt referencing the same upstream resource (or
   * the same receipt) — never a duplicate claim downstream.
   *
   * MAY throw `AdapterErrorException` for `transport`, `auth`, `rejected`,
   * `rate-limited`, `timeout`, or `not-supported` failure modes. Always
   * the wrapper, never the bare `AdapterError` payload.
   */
  submit(
    rendered: RenderedClaim,
    submitter: SubmitterIdentity,
    credentials: SubmitterCredentials,
  ): Promise<SubmitReceipt>;

  /**
   * Poll the jurisdiction for adjudication status. Returns `pending`
   * until the jurisdiction has produced a result, then `resolved` with
   * an `AdjudicationResult`. Callers manage their own polling cadence
   * and backoff.
   *
   * MAY throw `AdapterErrorException` for the same failure modes as
   * `submit` (transport / auth / rate-limited / timeout). Always the
   * wrapper, never the bare `AdapterError` payload.
   */
  poll(
    receipt: SubmitReceipt,
    credentials: SubmitterCredentials,
  ): Promise<PollOutcome>;
}

/**
 * Umbrella type. An adapter is either render-only or full-lifecycle;
 * narrow via {@link canSubmit}.
 */
export type JurisdictionAdapter = ClaimRenderer | ClaimSubmitter;

/**
 * Type guard for capability narrowing. Returns true if the adapter
 * implements the Phase 2+ {@link ClaimSubmitter} tier.
 */
export function canSubmit(a: ClaimRenderer): a is ClaimSubmitter {
  return 'submit' in a && typeof (a as ClaimSubmitter).submit === 'function';
}
