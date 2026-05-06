# Ontario MCEDT Record Format Reference

Authoritative byte-layout specification for the four record types the `@loomantix/billing-adapter-ohip` package emits. This is a substrate-side mirror that contributors and integrators can read without access to any other repo.

**Status.** v1 — covers HEB / HEH / HET / HEE. The HER (out-of-province RMB) record is intentionally deferred; its layout is documented at the end as a forward reference.

## Provenance

Field widths, justification, and pad characters were verified clean-room against publicly available references:

- **OSCAR EMR source** — `src/main/java/oscar/oscarBilling/ca/on/data/JdbcBillingCreateBillingFile.java` in `scoophealth/oscar`, lines 145-162 (HEB length checks), 173-190 (HEH), 339 (HET), 345 (HEE). OSCAR is GPL — only **factual** field widths and positions were extracted (facts are not copyrightable). No code was copied; the encoder implementation in this package is independent.
- **MOH MCEDT Technical Specifications** — referenced via the OMA Billing Information Manual.
- **OMA FHO+ FAQ** — Q310-Q313 hourly-rate handling rules.
- **INFOBulletin 260309 (April 2026)** — confirmed Q310-Q313 hourly claims leave HIN, version code, and date of birth blank.

## File-level structure

Fixed-width text file. Records are 79 bytes. Each record terminates with a CR (`0x0D`); some records have a leading LF (`0x0A`) separator. The orchestrator (lands in [3/6]) handles separators; the encoders in this package emit the **79-byte record body only**.

Record ordering inside a file:

```
HEB                              ← batch header (one)
  HEH HET [HET ...]              ← per claim: one HEH then one or more HETs
  HEH HET [HET ...]
  ...
HEE                              ← batch trailer (one)
```

For Q310-Q313 hourly batches there is one HEH per `(physician, day)` (not per patient — these claims are not patient-linked) followed by one HET per fee code on that day.

## Character set

7-bit ASCII (`0x20`–`0x7E`). All alphabetic characters MUST be uppercase. Lowercase or non-ASCII input is rejected by the encoders with `EncodeError.kind = 'invalid-character-class'`. Encoders never silently up-case input — that masks the source of bad data.

## Numeric and text encoding rules

- **Numeric fields** — right-justified, zero-fill (`'0'`). No decimal point. Cents go in the last two digits of fee fields.
- **Text fields** — left-justified, space-fill.
- **Optional / blank-fillable fields** — pad with spaces over the entire field width.
- **Dates** — accepted as ISO 8601 (`YYYY-MM-DD`); emitted as `YYYYMMDD`. Empty input emits 8 spaces (allowed for optional dates and Q310-Q313 DoB).

## HEB — Batch Header

79 bytes.

| Pos    | Width | Field            | Encoding                     |
| ------ | ----- | ---------------- | ---------------------------- |
| 1-2    | 2     | Transaction ID   | literal `HE`                 |
| 3      | 1     | Record Type      | literal `B`                  |
| 4-6    | 3     | Spec Version     | exact width, ASCII uppercase |
| 7      | 1     | MOH Office Code  | exact width, ASCII uppercase |
| 8-19   | 12    | Batch ID         | exact width, ASCII uppercase |
| 20-25  | 6     | (filler)         | spaces                       |
| 26-29  | 4     | Group Number     | exact width, ASCII uppercase |
| 30-35  | 6     | Provider Reg #   | exact width, digits          |
| 36-37  | 2     | Specialty Code   | exact width, digits          |
| 38-79  | 42    | (filler)         | spaces                       |

## HEH — Claim Header

79 bytes.

| Pos    | Width | Field                | Encoding                                                |
| ------ | ----- | -------------------- | ------------------------------------------------------- |
| 1-2    | 2     | Transaction ID       | literal `HE`                                            |
| 3      | 1     | Record Type          | literal `H`                                             |
| 4-13   | 10    | Health Number        | left-justify, space-pad. **Blank for Q310-Q313 / RMB.** |
| 14-15  | 2     | Version Code         | left-justify, space-pad. Blank for Q310-Q313 / RMB.     |
| 16-23  | 8     | Date of Birth        | `YYYYMMDD`. Blank for Q310-Q313.                        |
| 24-31  | 8     | Accounting Number    | right-justify, zero-fill. Caller-assigned identifier.   |
| 32-34  | 3     | Pay Program          | exact width (`HCP`, `RMB`, `WCB`, …)                    |
| 35     | 1     | Payee                | exact width (`P` provider, `S` subscriber)              |
| 36-41  | 6     | Referring Provider   | right-justify, space-pad. Optional.                     |
| 42-45  | 4     | Facility Number      | right-justify, space-pad. Optional.                     |
| 46-53  | 8     | Admission Date       | `YYYYMMDD` or 8 spaces. Optional.                       |
| 54-57  | 4     | Referring Lab Number | right-justify, space-pad. Optional.                     |
| 58     | 1     | Manual Review        | `Y` (true) or space (false)                             |
| 59-62  | 4     | Service Location     | left-justify, space-pad. Optional.                      |
| 63-79  | 17    | (filler)             | spaces                                                  |

## HET — Item / Service Record

79 bytes.

| Pos   | Width | Field              | Encoding                                                                           |
| ----- | ----- | ------------------ | ---------------------------------------------------------------------------------- |
| 1-2   | 2     | Transaction ID     | literal `HE`                                                                       |
| 3     | 1     | Record Type        | literal `T`                                                                        |
| 4-8   | 5     | Service Code       | exact width, ASCII uppercase. `ANNNS` shape (e.g. `Q310A`, `A007A`).               |
| 9-10  | 2     | (filler)           | spaces                                                                             |
| 11-16 | 6     | Fee Submitted      | right-justify, zero-fill. Cents in last 2 digits, no decimal (e.g. `008000` = $80). |
| 17-18 | 2     | Number of Services | right-justify, zero-fill. 0–99.                                                    |
| 19-26 | 8     | Service Date       | `YYYYMMDD`. **Required** — encoder rejects empty.                                  |
| 27-30 | 4     | Diagnostic Code    | left-justify, space-pad. Optional.                                                 |
| 31-79 | 49    | (filler)           | spaces                                                                             |

## HEE — Batch Trailer

79 bytes.

| Pos   | Width | Field              | Encoding                  |
| ----- | ----- | ------------------ | ------------------------- |
| 1-2   | 2     | Transaction ID     | literal `HE`              |
| 3     | 1     | Record Type        | literal `E`               |
| 4-7   | 4     | Claim Header Count | right-justify, zero-fill  |
| 8-11  | 4     | HER Record Count   | right-justify, zero-fill  |
| 12-16 | 5     | Item Record Count  | right-justify, zero-fill  |
| 17-79 | 63    | (filler)           | spaces                    |

The three counts are computed by the file orchestrator from the records it emits — encoders don't see the batch shape.

## Q310-Q313 hourly-rate claim specifics

Q310-Q313 claims are not patient-linked and follow special rules per OMA and INFOBulletin 260309:

1. **HIN, version code, and date of birth are blank** in the HEH (10, 2, 8 spaces respectively).
2. **One HEH per `(physician, day)`**, followed by one HET per fee code on that day.
3. **Units are 15-minute increments.** One hour of Q313 = 4 units.
4. **Fees per unit:** Q310 / Q312 / Q313 = $20.00; Q311 = $17.00.
5. **No after-hours premium applies** (INFOBulletin 260308; Q310-Q313 are not on the eligible-codes list).
6. **Service code format:** `Q310A`, `Q311A`, `Q312A`, `Q313A` — 5 chars including the trailing `A` suffix.
7. **Pay program:** `HCP` (standard OHIP claim).

The encoder enforces wire-format correctness only. Domain rules (per-day caps, eligible day-of-week, indirect/admin ratio) belong in the consuming product, not in this adapter — see [`contract-design.md`](./contract-design.md) for the full contract obligations.

## HER (forward reference, not yet implemented)

The HER record is required only for Reciprocal Medical Billing — claims for non-Ontario patients. Its layout differs from the four primary records:

- 81 bytes (not 79)
- Carries patient registration number, name, sex, and province code

Phase 1 of this adapter intentionally defers HER. The first consumer does not emit out-of-province claims in its current scope. HER lands as a separate package extension when a consumer needs it.

## References

- [`contract-design.md`](./contract-design.md) — adapter contract spec
- [MOH Technical Specifications Index](https://health.gov.on.ca/en/pro/publications/ohip/ebs_mcedt_specs.aspx)
- [MOH Claims Submission Guide](https://www.ontario.ca/document/resources-for-physicians/claims-submission)
- [OMA FHO+ Hourly Rate FAQ](https://www.oma.org/practice-professional-support/starting-your-practice/fho-is-the-future-of-family-medicine/fho-hourly-rate-frequently-asked-questions/)
