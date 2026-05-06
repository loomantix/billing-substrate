/**
 * The set of MCEDT fee codes this adapter recognizes by name. A code not
 * in this set is *not* an error — codes evolve and a community contributor
 * adding a new one shouldn't need to touch every consumer. Unknown codes
 * yield a `severity: 'warning'` violation so the caller can surface an
 * informational hint without blocking submission.
 *
 * Curated for the FHO+ hourly use case (Q310-Q313) plus a handful of the
 * most common patient-linked codes we see in test fixtures. Extend as
 * adoption broadens. Do NOT use this set as an authoritative billing
 * eligibility list — that belongs in the consumer product.
 */
export const KNOWN_FEE_CODES: ReadonlySet<string> = new Set([
  // FHO+ hourly rate (per OMA + INFOBulletin 260309)
  'Q310A',
  'Q311A',
  'Q312A',
  'Q313A',
  // Common patient-linked codes used in fixtures
  'A007A',
  'A001A',
  'A003A',
  'A004A',
  'A005A',
  'A006A',
  'G365A',
  'K005A',
  'K013A',
  'K017A',
  'K030A',
]);
