/**
 * MCEDT HEE (Batch Trailer) record encoder.
 *
 * Layout — 79 bytes:
 *
 * | Pos   | Width | Field              | Format / Pad             |
 * | ----- | ----- | ------------------ | ------------------------ |
 * | 1-2   | 2     | Transaction ID     | literal `'HE'`           |
 * | 3     | 1     | Record Type        | literal `'E'`            |
 * | 4-7   | 4     | Claim Header Count | right-justify zero-fill  |
 * | 8-11  | 4     | HER Record Count   | right-justify zero-fill  |
 * | 12-16 | 5     | Item Record Count  | right-justify zero-fill  |
 * | 17-79 | 63    | (spaces filler)    | spaces                   |
 *
 * Counts are non-negative integers populated by the file orchestrator
 * after iterating the batch.
 *
 * Field widths verified against OSCAR's `JdbcBillingCreateBillingFile.java`
 * line 345 (clean-room reference; facts only). The counter variable names
 * in OSCAR (`pCount`, `hcCount`, `rCount`) map to `claimHeaderCount`,
 * `herRecordCount`, `itemRecordCount` here per OSCAR's increment sites.
 */

import { asciiBytes, encodeIntegerZeroFill, spaces } from './encoding.js';

export interface TrailerInput {
  /** Total HEH records in the batch. */
  readonly claimHeaderCount: number;
  /** Total HER records in the batch (out-of-province RMB; 0 for Q310-Q313). */
  readonly herRecordCount: number;
  /** Total HET records in the batch. */
  readonly itemRecordCount: number;
}

const HEE_LENGTH = 79;

export function encodeTrailer(input: TrailerInput): Uint8Array {
  const record =
    'HE' +
    'E' +
    encodeIntegerZeroFill(input.claimHeaderCount, 4, 'claimHeaderCount') +
    encodeIntegerZeroFill(input.herRecordCount, 4, 'herRecordCount') +
    encodeIntegerZeroFill(input.itemRecordCount, 5, 'itemRecordCount') +
    spaces(63);

  if (record.length !== HEE_LENGTH) {
    throw new Error(
      `internal: HEE length ${record.length}, expected ${HEE_LENGTH}`,
    );
  }
  return asciiBytes(record);
}
