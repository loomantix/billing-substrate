/**
 * MCEDT file orchestrator. Composes the four record encoders into a complete
 * batch file and computes the SHA-256 content hash.
 *
 * Layout produced:
 *
 * ```
 * HEB <CR>
 *   HEH <CR> HET <CR> [HET <CR> ...]    ← one claim envelope
 *   HEH <CR> HET <CR> [HET <CR> ...]
 *   ...
 * HEE <CR>
 * ```
 *
 * Per the contract obligations:
 *
 * - **Obligation 2 (deterministic).** Items are sorted into a total order
 *   over every visible field before grouping; same input → byte-identical
 *   output regardless of caller insertion order. Accounting numbers are
 *   assigned sequentially in this sorted order so they are also stable
 *   across runs.
 * - **Obligation 3 (content hash).** `RenderedClaim.contentHashSha256Hex`
 *   is the SHA-256 hex digest of the final `bytes` (after CR terminators).
 *
 * Pre-flight precondition checks (fail-closed; producing a malformed file
 * silently is worse than a thrown exception in a regulated wire format):
 *
 * - Empty batches rejected.
 * - Files exceeding the MOH 10 MB limit rejected before allocation.
 * - Items in the same claim envelope (same patient + day) that disagree on
 *   `serviceLocation` or `versionCode` rejected — the envelope encodes
 *   each of those fields once, so silently dropping one value would
 *   misroute a claim.
 * - `ClaimItem.patient` blocks with empty `healthNumber` or `dateOfBirth`
 *   rejected — TypeScript's `string` admits `''`, but the wire format
 *   requires real values for patient-linked claims.
 *
 * Claim-envelope grouping:
 *
 * - **Items with no `patient`** (Q310-Q313 hourly per OMA): each item is
 *   its own claim envelope. One HEH + one HET per `ClaimItem`.
 * - **Items with `patient`**: grouped by `(patient.healthNumber,
 *   patient.dateOfBirth, serviceDate)`. One HEH per unique `(patient,
 *   day)` tuple, with all items for that tuple under it as HETs.
 */

import { createHash } from 'node:crypto';

import {
  asBatchItemIndex,
  type BatchItemIndex,
  type ClaimBatch,
  type ClaimItem,
  type PatientReference,
  type RenderedClaim,
} from '@loomantix/billing-adapter';

import {
  encodeBatchHeader,
  encodeClaimHeader,
  encodeItemRecord,
  encodeTrailer,
} from '../records/index.js';
import type { OntarioMcedtIdentifiers } from '../types.js';

import { EmitException, missingItemMessage } from './errors.js';

const CR = 0x0d;
const RECORD_BODY_LENGTH = 79;
const TERMINATED_RECORD_LENGTH = RECORD_BODY_LENGTH + 1;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

const ONTARIO_MCEDT: 'ontario-mcedt' = 'ontario-mcedt';
const Q_HOURLY_PAY_PROGRAM = 'HCP';
const Q_HOURLY_PAYEE = 'P' as const;

/**
 * Static configuration the orchestrator needs but `ClaimBatch` doesn't
 * carry: the wire-format spec version, the submitter's MOH identifiers,
 * and a caller-assigned batch identifier.
 *
 * The adapter constructor (lands in [5/6]) holds this and reuses it
 * across `render` calls.
 */
export interface OntarioMcedtConfig {
  /** 3-char MCEDT specification version (per MOH technical spec). */
  readonly specVersion: string;
  /** MOH-assigned identifiers for this submitter. */
  readonly identifiers: OntarioMcedtIdentifiers;
  /**
   * 12-char caller-assigned batch identifier. Should be deterministic
   * w.r.t. the batch contents so retries produce the same content hash.
   */
  readonly batchId: string;
}

interface ClaimGroup {
  readonly patient: PatientReference | undefined;
  readonly serviceLocation: string | undefined;
  readonly items: readonly ClaimItem[];
}

interface PendingGroup {
  readonly patient: PatientReference | undefined;
  readonly serviceLocation: string | undefined;
  readonly versionCode: string | undefined;
  readonly groupKey: string;
  readonly items: ClaimItem[];
}

function compareNullableStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Total order over `ClaimItem`. The primary order is `(serviceDate,
 * feeCode)`; further keys break ties so caller insertion order never
 * leaks into the byte-level output. Two items that compare equal under
 * this comparator are byte-indistinguishable in the rendered file, so
 * `sort` stability has no observable effect on the content hash.
 */
function compareItems(a: ClaimItem, b: ClaimItem): number {
  if (a.serviceDate !== b.serviceDate) {
    return a.serviceDate < b.serviceDate ? -1 : 1;
  }
  if (a.feeCode !== b.feeCode) {
    return a.feeCode < b.feeCode ? -1 : 1;
  }
  if (a.units !== b.units) return a.units - b.units;
  if (a.feeSubmittedCents !== b.feeSubmittedCents) {
    return a.feeSubmittedCents - b.feeSubmittedCents;
  }
  const cmpHin = compareNullableStrings(
    a.patient?.healthNumber ?? '',
    b.patient?.healthNumber ?? '',
  );
  if (cmpHin !== 0) return cmpHin;
  const cmpDob = compareNullableStrings(
    a.patient?.dateOfBirth ?? '',
    b.patient?.dateOfBirth ?? '',
  );
  if (cmpDob !== 0) return cmpDob;
  const cmpVer = compareNullableStrings(
    a.patient?.versionCode ?? '',
    b.patient?.versionCode ?? '',
  );
  if (cmpVer !== 0) return cmpVer;
  const cmpDx = compareNullableStrings(
    a.diagnosticCode ?? '',
    b.diagnosticCode ?? '',
  );
  if (cmpDx !== 0) return cmpDx;
  return compareNullableStrings(
    a.serviceLocation ?? '',
    b.serviceLocation ?? '',
  );
}

function patientGroupKey(item: ClaimItem): string | null {
  if (!item.patient) return null;
  return `${item.patient.healthNumber}|${item.patient.dateOfBirth}|${item.serviceDate}`;
}

function brandedIndex(i: number): BatchItemIndex {
  // `i` comes from a for-loop iterator over a non-negative-length array,
  // so the brand always succeeds. Throw rather than returning `null` so
  // a future regression that violates the invariant fails loud.
  const branded = asBatchItemIndex(i);
  if (branded === null) {
    throw new Error(`internal: invalid item index ${i}`);
  }
  return branded;
}

function assertItemsPresent(items: readonly ClaimItem[]): void {
  for (let i = 0; i < items.length; i++) {
    if (!items[i]) {
      const itemIndex = brandedIndex(i);
      throw new EmitException({
        kind: 'missing-item',
        itemIndex,
        message: missingItemMessage(itemIndex),
      });
    }
  }
}

function assertPatientFieldsPresent(items: readonly ClaimItem[]): void {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || !item.patient) continue;
    const itemIndex = brandedIndex(i);
    if (item.patient.healthNumber === '') {
      throw new EmitException({
        kind: 'patient-missing-required-field',
        field: 'healthNumber',
        itemIndex,
        message: `items[${i}] carries a patient block with empty healthNumber; use no patient block for non-patient claims`,
      });
    }
    if (item.patient.dateOfBirth === '') {
      throw new EmitException({
        kind: 'patient-missing-required-field',
        field: 'dateOfBirth',
        itemIndex,
        message: `items[${i}] carries a patient block with empty dateOfBirth`,
      });
    }
  }
}

function groupClaimEnvelopes(items: readonly ClaimItem[]): ClaimGroup[] {
  const pending: PendingGroup[] = [];
  const indexByKey = new Map<string, number>();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;
    const key = patientGroupKey(item);
    if (key === null) {
      pending.push({
        patient: undefined,
        serviceLocation: item.serviceLocation,
        versionCode: undefined,
        groupKey: `no-patient/items[${i}]`,
        items: [item],
      });
      continue;
    }
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, pending.length);
      pending.push({
        patient: item.patient,
        serviceLocation: item.serviceLocation,
        versionCode: item.patient?.versionCode,
        groupKey: key,
        items: [item],
      });
      continue;
    }
    const existing = pending[existingIndex];
    if (!existing) {
      throw new Error('internal: group index points to missing entry');
    }
    if ((existing.serviceLocation ?? '') !== (item.serviceLocation ?? '')) {
      throw new EmitException({
        kind: 'inconsistent-group-field',
        field: 'serviceLocation',
        groupKey: key,
        firstValue: existing.serviceLocation ?? '',
        conflictingValue: item.serviceLocation ?? '',
        message: `items in claim envelope ${key} disagree on serviceLocation`,
      });
    }
    const incomingVersion = item.patient?.versionCode;
    if ((existing.versionCode ?? '') !== (incomingVersion ?? '')) {
      throw new EmitException({
        kind: 'inconsistent-group-field',
        field: 'versionCode',
        groupKey: key,
        firstValue: existing.versionCode ?? '',
        conflictingValue: incomingVersion ?? '',
        message: `items in claim envelope ${key} disagree on patient.versionCode`,
      });
    }
    existing.items.push(item);
  }

  return pending.map((p) => ({
    patient: p.patient,
    serviceLocation: p.serviceLocation,
    items: p.items,
  }));
}

function appendRecord(
  buffer: Uint8Array,
  offset: number,
  record: Uint8Array,
): number {
  buffer.set(record, offset);
  buffer[offset + record.length] = CR;
  return offset + TERMINATED_RECORD_LENGTH;
}

export async function emitClaimFile(
  batch: ClaimBatch,
  config: OntarioMcedtConfig,
): Promise<RenderedClaim> {
  if (batch.items.length === 0) {
    throw new EmitException({
      kind: 'empty-batch',
      message: 'cannot emit an MCEDT file with zero claim items',
    });
  }

  assertItemsPresent(batch.items);
  assertPatientFieldsPresent(batch.items);

  const sortedItems = [...batch.items].sort(compareItems);
  const groups = groupClaimEnvelopes(sortedItems);

  const recordCount = 2 + groups.length + sortedItems.length;
  const expectedSize = recordCount * TERMINATED_RECORD_LENGTH;
  if (expectedSize > MAX_FILE_SIZE_BYTES) {
    throw new EmitException({
      kind: 'file-too-large',
      fileSize: expectedSize,
      maxSize: MAX_FILE_SIZE_BYTES,
      message: `assembled file would be ${expectedSize} bytes, exceeds MOH 10 MB limit`,
    });
  }

  const bytes = new Uint8Array(expectedSize);
  let offset = 0;

  offset = appendRecord(
    bytes,
    offset,
    encodeBatchHeader({
      specVersion: config.specVersion,
      mohOfficeCode: config.identifiers.mohOfficeCode,
      batchId: config.batchId,
      groupNumber: config.identifiers.groupNumber,
      providerRegNumber: config.identifiers.providerRegNumber,
      specialtyCode: config.identifiers.specialtyCode,
    }),
  );

  let accountingNumber = 1;
  for (const group of groups) {
    offset = appendRecord(
      bytes,
      offset,
      encodeClaimHeader({
        hin: group.patient?.healthNumber ?? '',
        versionCode: group.patient?.versionCode ?? '',
        dateOfBirth: group.patient?.dateOfBirth ?? '',
        accountingNumber,
        payProgram: Q_HOURLY_PAY_PROGRAM,
        payee: Q_HOURLY_PAYEE,
        referringProvider: '',
        facilityNumber: '',
        admissionDate: '',
        referringLabNumber: '',
        manualReview: false,
        serviceLocation: group.serviceLocation ?? '',
      }),
    );
    accountingNumber++;

    for (const item of group.items) {
      offset = appendRecord(
        bytes,
        offset,
        encodeItemRecord({
          serviceCode: item.feeCode,
          feeSubmittedCents: item.feeSubmittedCents,
          units: item.units,
          serviceDate: item.serviceDate,
          diagnosticCode: item.diagnosticCode ?? '',
        }),
      );
    }
  }

  offset = appendRecord(
    bytes,
    offset,
    encodeTrailer({
      claimHeaderCount: groups.length,
      herRecordCount: 0,
      itemRecordCount: sortedItems.length,
    }),
  );

  if (offset !== expectedSize) {
    throw new Error(
      `internal: emitted ${offset} bytes, expected ${expectedSize} ` +
        `(records=${recordCount}, groups=${groups.length}, items=${sortedItems.length}, batchId=${config.batchId})`,
    );
  }

  const contentHashSha256Hex = createHash('sha256').update(bytes).digest('hex');

  return {
    jurisdiction: ONTARIO_MCEDT,
    bytes,
    byteCount: bytes.length,
    contentHashSha256Hex,
  };
}
