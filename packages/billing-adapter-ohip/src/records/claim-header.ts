/**
 * MCEDT HEH (Claim Header 1) record encoder.
 *
 * Layout — 79 bytes:
 *
 * | Pos    | Width | Field                | Format / Pad                          |
 * | ------ | ----- | -------------------- | ------------------------------------- |
 * | 1-2    | 2     | Transaction ID       | literal `'HE'`                        |
 * | 3      | 1     | Record Type          | literal `'H'`                         |
 * | 4-13   | 10    | Health Number (HIN)  | left-justify space-pad; 10 spaces if absent |
 * | 14-15  | 2     | Version Code         | left-justify space-pad; 2 spaces if absent  |
 * | 16-23  | 8     | Date of Birth        | `YYYYMMDD`; 8 spaces if absent        |
 * | 24-31  | 8     | Accounting Number    | right-justify zero-fill; digits       |
 * | 32-34  | 3     | Pay Program          | exact width (e.g. `'HCP'`, `'RMB'`)   |
 * | 35     | 1     | Payee                | exact width (`'P'` or `'S'`)          |
 * | 36-41  | 6     | Referring Provider   | right-justify space-pad; 6 spaces if absent |
 * | 42-45  | 4     | Facility Number      | right-justify space-pad; 4 spaces if absent |
 * | 46-53  | 8     | Admission Date       | `YYYYMMDD`; 8 spaces if absent        |
 * | 54-57  | 4     | Referring Lab Number | right-justify space-pad; 4 spaces if absent |
 * | 58     | 1     | Manual Review        | `'Y'` or `' '`                        |
 * | 59-62  | 4     | Service Location     | left-justify space-pad; 4 spaces if absent  |
 * | 63-79  | 17    | (spaces filler)      | spaces                                |
 *
 * For Q310-Q313 hourly claims, HIN, version, and DoB are all blank
 * (per INFOBulletin 260309). Pass empty strings — the encoder pads to
 * the field width with spaces.
 *
 * Field widths verified against OSCAR's `JdbcBillingCreateBillingFile.java`
 * lines 173-190 (clean-room reference; facts only).
 */

import {
  asciiBytes,
  encodeIntegerZeroFill,
  encodeIsoDate,
  exactWidth,
  leftJustifyText,
  rightJustify,
  spaces,
} from './encoding.js';
import { EncodeException, type InvalidCharacterClassError } from './errors.js';

export interface ClaimHeaderInput {
  /** Health Insurance Number. Empty string for Q310-Q313 / RMB. */
  readonly hin: string;
  /** Health card version code. Empty string for Q310-Q313 / RMB. */
  readonly versionCode: string;
  /** ISO 8601 date `YYYY-MM-DD`. Empty string for Q310-Q313. */
  readonly dateOfBirth: string;
  /** Caller-assigned accounting reference, non-negative integer. */
  readonly accountingNumber: number;
  /** 3-char pay program code (e.g. `'HCP'`, `'RMB'`). */
  readonly payProgram: string;
  /** `'P'` (provider) or `'S'` (subscriber). */
  readonly payee: 'P' | 'S';
  /** Optional 6-digit referring provider number; empty string omits. */
  readonly referringProvider: string;
  /** Optional 4-char facility number; empty string omits. */
  readonly facilityNumber: string;
  /** Optional ISO 8601 admission date; empty string omits. */
  readonly admissionDate: string;
  /** Optional 4-char referring lab number; empty string omits. */
  readonly referringLabNumber: string;
  /** `true` flags the claim for manual review (`'Y'`); `false` is space. */
  readonly manualReview: boolean;
  /** Optional 4-char service location code; empty string omits. */
  readonly serviceLocation: string;
}

const HEH_LENGTH = 79;

function encodePayee(payee: 'P' | 'S'): string {
  // Defense-in-depth for JS callers and `as` casts: TypeScript's `'P' | 'S'`
  // narrowing is gone at runtime, and any non-{P,S} character that's still
  // 1 byte (e.g. `'X'`) would silently produce a 79-char record where the
  // payee position carries garbage — `record.length` invariant wouldn't fire.
  if (payee !== 'P' && payee !== 'S') {
    const error: InvalidCharacterClassError = {
      kind: 'invalid-character-class',
      path: 'payee',
      value: String(payee),
      badCharCode: String(payee).charCodeAt(0),
      badCharIndex: 0,
      message: `payee must be 'P' or 'S'`,
    };
    throw new EncodeException(error);
  }
  return payee;
}

export function encodeClaimHeader(input: ClaimHeaderInput): Uint8Array {
  const record =
    'HE' +
    'H' +
    leftJustifyText(input.hin, 10, 'hin') +
    leftJustifyText(input.versionCode, 2, 'versionCode') +
    encodeIsoDate(input.dateOfBirth, 'dateOfBirth') +
    encodeIntegerZeroFill(input.accountingNumber, 8, 'accountingNumber') +
    exactWidth(input.payProgram, 3, 'payProgram') +
    encodePayee(input.payee) +
    rightJustify(input.referringProvider, 6, ' ', 'referringProvider') +
    rightJustify(input.facilityNumber, 4, ' ', 'facilityNumber') +
    encodeIsoDate(input.admissionDate, 'admissionDate') +
    rightJustify(input.referringLabNumber, 4, ' ', 'referringLabNumber') +
    (input.manualReview ? 'Y' : ' ') +
    leftJustifyText(input.serviceLocation, 4, 'serviceLocation') +
    spaces(17);

  if (record.length !== HEH_LENGTH) {
    throw new Error(
      `internal: HEH length ${record.length}, expected ${HEH_LENGTH}`,
    );
  }
  return asciiBytes(record);
}
