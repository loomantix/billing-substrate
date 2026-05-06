/**
 * MCEDT HEB (Batch Header) record encoder.
 *
 * Layout — 79 bytes (CR terminator delivered by file orchestrator):
 *
 * | Pos    | Width | Field            | Format / Pad                 |
 * | ------ | ----- | ---------------- | ---------------------------- |
 * | 1-2    | 2     | Transaction ID   | literal `'HE'`               |
 * | 3      | 1     | Record Type      | literal `'B'`                |
 * | 4-6    | 3     | Spec Version     | exact width, ASCII uppercase |
 * | 7      | 1     | MOH Office Code  | exact width, ASCII uppercase |
 * | 8-19   | 12    | Batch ID         | exact width, ASCII uppercase |
 * | 20-25  | 6     | (spaces filler)  | spaces                       |
 * | 26-29  | 4     | Group Number     | exact width, ASCII uppercase |
 * | 30-35  | 6     | Provider Reg #   | exact width, digits          |
 * | 36-37  | 2     | Specialty Code   | exact width, digits          |
 * | 38-79  | 42    | (spaces filler)  | spaces                       |
 *
 * Field widths verified against OSCAR's runtime length checks at
 * `oscar/oscarBilling/ca/on/data/JdbcBillingCreateBillingFile.java`
 * lines 145-162 (clean-room reference; no code copied — facts only).
 */

import {
  asciiBytes,
  exactWidth,
  spaces,
} from './encoding.js';

export interface BatchHeaderInput {
  /** 3-char specification version code from the MOH technical spec. */
  readonly specVersion: string;
  /** Single-character MOH regional office code. */
  readonly mohOfficeCode: string;
  /** 12-char batch identifier. Caller-assigned; deterministic per batch. */
  readonly batchId: string;
  /** 4-char OHIP billing group number. */
  readonly groupNumber: string;
  /** 6-digit OHIP provider registration number. */
  readonly providerRegNumber: string;
  /** 2-digit MOH provider specialty code. */
  readonly specialtyCode: string;
}

const HEB_LENGTH = 79;

export function encodeBatchHeader(input: BatchHeaderInput): Uint8Array {
  const record =
    'HE' +
    'B' +
    exactWidth(input.specVersion, 3, 'specVersion') +
    exactWidth(input.mohOfficeCode, 1, 'mohOfficeCode') +
    exactWidth(input.batchId, 12, 'batchId') +
    spaces(6) +
    exactWidth(input.groupNumber, 4, 'groupNumber') +
    exactWidth(input.providerRegNumber, 6, 'providerRegNumber') +
    exactWidth(input.specialtyCode, 2, 'specialtyCode') +
    spaces(42);

  if (record.length !== HEB_LENGTH) {
    throw new Error(
      `internal: HEB length ${record.length}, expected ${HEB_LENGTH}`,
    );
  }
  return asciiBytes(record);
}
