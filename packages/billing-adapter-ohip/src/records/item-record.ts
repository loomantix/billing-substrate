/**
 * MCEDT HET (Item / Service) record encoder.
 *
 * Layout — 79 bytes:
 *
 * | Pos   | Width | Field              | Format / Pad                            |
 * | ----- | ----- | ------------------ | --------------------------------------- |
 * | 1-2   | 2     | Transaction ID     | literal `'HE'`                          |
 * | 3     | 1     | Record Type        | literal `'T'`                           |
 * | 4-8   | 5     | Service Code       | exact width, ASCII uppercase (`ANNNS`)  |
 * | 9-10  | 2     | (spaces filler)    | spaces                                  |
 * | 11-16 | 6     | Fee Submitted      | right-justify zero-fill; cents          |
 * | 17-18 | 2     | Number of Services | right-justify zero-fill; units          |
 * | 19-26 | 8     | Service Date       | `YYYYMMDD` (required, never blank)      |
 * | 27-30 | 4     | Diagnostic Code    | left-justify space-pad; 4 spaces if absent |
 * | 31-79 | 49    | (spaces filler)    | spaces                                  |
 *
 * Fee Submitted: cents in last 2 digits, no decimal. `$80.00 = 008000`.
 *
 * Service Date is required for every item record. The fee field accepts
 * non-negative integers; the units field is 1–99 (encoder enforces width
 * rather than range — semantic range checks belong in the validator).
 *
 * Field widths verified against OSCAR's `JdbcBillingCreateBillingFile.java`
 * line 339 (clean-room reference; facts only).
 */

import {
  asciiBytes,
  encodeIntegerZeroFill,
  encodeIsoDate,
  exactWidth,
  leftJustifyText,
  spaces,
} from './encoding.js';
import { EncodeException, type InvalidDateError } from './errors.js';

export interface ItemRecordInput {
  /** 5-char service code, e.g. `'Q310A'`, `'A007A'`. */
  readonly serviceCode: string;
  /** Total fee submitted in cents (e.g. `8000` for $80.00). 0–999_999. */
  readonly feeSubmittedCents: number;
  /** Number of service units (15-min increments for Q310-Q313). 0–99. */
  readonly units: number;
  /** ISO 8601 service date `YYYY-MM-DD`. Required; empty string is rejected. */
  readonly serviceDate: string;
  /** Optional diagnostic code (≤4 chars). Empty string omits. */
  readonly diagnosticCode: string;
}

const HET_LENGTH = 79;

function encodeRequiredDate(value: string, path: string): string {
  if (value === '') {
    const error: InvalidDateError = {
      kind: 'invalid-date',
      path,
      value,
      message: 'service date is required for HET records',
    };
    throw new EncodeException(error);
  }
  return encodeIsoDate(value, path);
}

export function encodeItemRecord(input: ItemRecordInput): Uint8Array {
  const record =
    'HE' +
    'T' +
    exactWidth(input.serviceCode, 5, 'serviceCode') +
    spaces(2) +
    encodeIntegerZeroFill(input.feeSubmittedCents, 6, 'feeSubmittedCents') +
    encodeIntegerZeroFill(input.units, 2, 'units') +
    encodeRequiredDate(input.serviceDate, 'serviceDate') +
    leftJustifyText(input.diagnosticCode, 4, 'diagnosticCode') +
    spaces(49);

  if (record.length !== HET_LENGTH) {
    throw new Error(
      `internal: HET length ${record.length}, expected ${HET_LENGTH}`,
    );
  }
  return asciiBytes(record);
}
