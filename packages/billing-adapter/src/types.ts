/**
 * Shared data types for the billing-substrate contract.
 *
 * This file contains *data shapes only* — the `JurisdictionAdapter` trait
 * lives in `./adapter.ts`. Consumers translate their domain models into
 * `ClaimBatch` shape and pass them to a jurisdictional adapter that
 * operates on these shapes.
 *
 * ## Hard rules
 *
 * - No domain types from any consumer leak into this package. Adapters never
 *   see `Physician`, `TimeEntry`, `FhoGroup`, `Encounter`, etc. — consumers
 *   translate before calling.
 * - These shapes are stable wire-format-agnostic primitives. Adding a field is
 *   a minor version bump; renaming or removing is a major.
 * - Patient-linked claims and non-patient claims share the same shape; the
 *   `patient` field is optional and absent for non-patient (e.g. Q310-Q313
 *   hourly fee codes).
 */

/**
 * The set of jurisdictions the substrate routes to. New jurisdictions ship as
 * new packages (`@loomantix/billing-adapter-<jurisdiction>` or
 * community-published `@<contributor>/billing-adapter-<jurisdiction>`) and
 * register their identifier here when added.
 */
export type Jurisdiction =
  | 'ontario-mcedt'
  // Future: 'bc-msp', 'us-x12-837', 'de-kbv', 'fr-fse', 'za-medical-schemes', etc.
  | (string & { readonly __jurisdictionBrand?: never });

/**
 * Identifies a submitting entity registered with a deployment of the substrate.
 * For Ontario MCEDT under the MSA security model, `identifiers` carries the
 * FHO group's MOH Service User identifier, MOH office code, and group billing
 * number — all of which are asserted on each upload to the ministry.
 *
 * The `identifiers` map is jurisdiction-specific; each adapter validates the
 * keys it needs in the validation step before render/submit.
 */
export interface SubmitterIdentity {
  /** Stable identifier for this submitter within the deployment. */
  readonly id: string;
  readonly jurisdiction: Jurisdiction;
  readonly displayName: string;
  /** Free-form jurisdiction-specific identifiers (group number, etc.). */
  readonly identifiers: Readonly<Record<string, string>>;
}

/**
 * A batch of claims for a single submitter and service period. Adapters
 * render this into the wire format their jurisdiction expects.
 *
 * Most jurisdictions submit monthly; some (Ontario MCEDT) use 18th-to-18th
 * billing cycles, which the consumer computes before sending the batch.
 */
export interface ClaimBatch {
  readonly submitterId: string;
  readonly servicePeriod: ServicePeriod;
  readonly items: readonly ClaimItem[];
}

/**
 * Service period the batch covers, expressed as ISO 8601 date strings
 * (`YYYY-MM-DD`). Inclusive on both ends.
 */
export interface ServicePeriod {
  readonly start: string;
  readonly end: string;
}

/**
 * A single line of claim data. The Ontario MCEDT adapter maps this to one HET
 * item record (with an HEH claim header per item or grouped, depending on
 * patient-linked vs non-patient).
 *
 * Patient-linked claims populate `patient`; non-patient hourly claims (e.g.
 * Q310–Q313) leave it `undefined`.
 *
 * `feeSubmittedCents` is the per-claim total fee in cents (no decimal). The
 * Ontario MCEDT format encodes this as a 6-character right-justified numeric
 * with the last two digits as cents.
 */
export interface ClaimItem {
  /** ISO 8601 date string (`YYYY-MM-DD`). */
  readonly serviceDate: string;
  /** Jurisdiction-specific fee code (e.g. `Q310A`, `A007A`, US CPT codes). */
  readonly feeCode: string;
  /** Number of service units (e.g. 15-minute increments for Ontario hourly). */
  readonly units: number;
  /** Total fee submitted, in cents. */
  readonly feeSubmittedCents: number;
  /** Patient reference for patient-linked claims; absent for non-patient. */
  readonly patient?: PatientReference;
  /** Diagnostic code (e.g. ICD-9/ICD-10) where the jurisdiction requires it. */
  readonly diagnosticCode?: string;
  /** Service location code (jurisdiction-specific format). */
  readonly serviceLocation?: string;
}

/**
 * Patient reference for patient-linked encounter claims. For Ontario MCEDT
 * this becomes the HEH claim header's HIN/version-code/birthdate fields.
 */
export interface PatientReference {
  /** Health insurance number (Ontario: 10 digits; other jurisdictions vary). */
  readonly healthNumber: string;
  /** Version code where the jurisdiction tracks card revisions. */
  readonly versionCode?: string;
  /** ISO 8601 date string (`YYYY-MM-DD`). */
  readonly dateOfBirth: string;
}

/**
 * Output of an adapter's `render` step — opaque wire-format bytes plus the
 * metadata an audit/persistence layer needs to record the rendered artifact.
 */
export interface RenderedClaim {
  readonly jurisdiction: Jurisdiction;
  /** Wire-format bytes ready for transmission to the jurisdiction system. */
  readonly bytes: Uint8Array;
  readonly byteCount: number;
  /** SHA-256 hex digest of `bytes` for audit/dedupe. */
  readonly contentHashSha256Hex: string;
}

/**
 * Severity of a single validation finding.
 */
export type Severity = 'error' | 'warning';

/**
 * One validation finding from an adapter's pre-flight check. Carries enough
 * context that the caller can show the user exactly which line/field failed
 * and why.
 */
export interface ValidationViolation {
  readonly severity: Severity;
  /**
   * Stable machine-readable code (e.g. `'missing-group-number'`,
   * `'unit-count-out-of-range'`). Callers pattern-match on this; the human
   * `message` is for surface display only.
   */
  readonly code: string;
  readonly message: string;
  /** Optional pointer into the batch (e.g. `'items[3].feeCode'`). */
  readonly path?: string;
}

/**
 * Aggregated result of a validation pass. Adapters return *every* violation,
 * not just the first — so the caller can surface them all at once rather
 * than debugging through one-at-a-time errors.
 */
export interface ValidationReport {
  readonly violations: readonly ValidationViolation[];
}
