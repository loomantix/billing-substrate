/**
 * Submission lifecycle types — the shapes adapters return from their
 * Phase 2+ methods (`submit`, `poll`).
 *
 * Per the contract obligations:
 * - `SubmitReceipt` is opaque-but-serializable; the consumer persists it
 *   and uses it on later `poll` calls. Adapters MUST be stateless across
 *   invocations — all state required for `poll` lives here.
 * - `submit` is idempotent against the same `RenderedClaim`: re-submitting
 *   the same content produces a receipt referencing the same upstream
 *   resource (or the same receipt) — never a duplicate claim downstream.
 */

import type { Jurisdiction } from './types.js';

/**
 * Receipt issued by the jurisdiction after a successful upload + submit.
 * The consumer persists this and passes it to `poll` to fetch the
 * adjudication outcome later.
 */
export interface SubmitReceipt {
  readonly jurisdiction: Jurisdiction;
  /** Jurisdiction-assigned identifier (e.g. EDT resource ID for Ontario). */
  readonly externalId: string;
  /** ISO 8601 UTC timestamp of jurisdictional acceptance. */
  readonly submittedAt: string;
  /**
   * Adapter-internal opaque state needed to resume `poll` across
   * invocations. The contract requires adapters to be stateless across
   * invocations (obligation 6) — anything the adapter needs at poll
   * time that isn't `externalId` lives here. Examples: pagination
   * cursors for jurisdictions whose remittance API is paged, generation
   * tokens for jurisdictions that issue transient retrieval tickets.
   *
   * Consumers MUST treat this field as opaque: persist it alongside
   * the receipt, pass it through unchanged, and never inspect or log
   * its content. Adapters MUST NOT encode credentials or PHI here —
   * the field crosses the consumer's persistence boundary like the
   * receipt itself.
   */
  readonly opaqueState?: string;
}

/**
 * Outcome of a single poll. Adapters return `pending` until the
 * jurisdiction has produced a result; callers handle their own backoff
 * between polls.
 */
export type PollOutcome =
  | { readonly kind: 'pending' }
  | { readonly kind: 'resolved'; readonly result: AdjudicationResult };

/**
 * Per-line adjudication result aggregated from the jurisdiction's
 * remittance / response artifacts.
 */
export interface AdjudicationResult {
  readonly jurisdiction: Jurisdiction;
  readonly externalId: string;
  /** Per-line outcomes, indexed against the originally submitted batch. */
  readonly lineResults: readonly LineResult[];
}

export interface LineResult {
  /** Index into the originally submitted `ClaimBatch.items`. */
  readonly itemIndex: number;
  readonly outcome: LineOutcome;
}

export type LineOutcome =
  | { readonly kind: 'accepted'; readonly paidCents: number }
  | { readonly kind: 'rejected'; readonly reasonCode: string; readonly message: string };
