/**
 * Ontario MCEDT-specific shapes layered on top of the wire-neutral primitives
 * in `@loomantix/billing-adapter`.
 *
 * The contract's `SubmitterIdentity.identifiers` is a free-form string map; this
 * file types the keys Ontario MCEDT requires so `validate` can fail-closed
 * with structured violations rather than ad-hoc string lookups.
 *
 * Field references trace to the MCEDT HEB/HEH/HET/HEE record layout documented
 * at `docs/architecture/ohip-record-format.md` (substrate-internal canonical
 * spec mirror).
 */

/**
 * The identifiers the ministry requires on every MCEDT upload, asserted by
 * the FHO group's MOH Service User on their behalf.
 *
 * Consumer products populate these into `SubmitterIdentity.identifiers` under
 * the matching keys; the OHIP adapter reads and validates them in `validate`.
 */
export interface OntarioMcedtIdentifiers {
  /**
   * Group billing number. Four characters, assigned by the ministry to the
   * FHO group at enrolment. Encoded into the HEB header.
   */
  readonly groupNumber: string;

  /**
   * MOH office code identifying the regional ministry office that adjudicates
   * the group's claims. One character (per OSCAR's runtime length check in
   * `JdbcBillingCreateBillingFile.java:153`).
   */
  readonly mohOfficeCode: string;

  /**
   * Rendering provider's MOH registration number. Six digits, identifies the
   * physician on whose behalf each HEH claim header is submitted.
   */
  readonly providerRegNumber: string;

  /**
   * Provider's MOH specialty code. Two digits — encoded into the HEB header
   * to identify the rendering provider's specialty (e.g. `'00'` for general
   * / family practice, `'13'` for general surgery).
   */
  readonly specialtyCode: string;
}

/**
 * Keys under which {@link OntarioMcedtIdentifiers} fields live inside the
 * contract's `SubmitterIdentity.identifiers` map. Exported so consumers and
 * tests can reference the canonical key names without string duplication.
 */
export const ONTARIO_MCEDT_IDENTIFIER_KEYS = {
  groupNumber: 'groupNumber',
  mohOfficeCode: 'mohOfficeCode',
  providerRegNumber: 'providerRegNumber',
  specialtyCode: 'specialtyCode',
} as const satisfies Record<keyof OntarioMcedtIdentifiers, string>;
