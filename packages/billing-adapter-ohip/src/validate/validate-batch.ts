/**
 * Pre-flight validation for the Ontario MCEDT adapter.
 *
 * Per contract obligation 1, the validator MUST aggregate every finding
 * rather than short-circuiting on the first failure. Consumers surface
 * all violations at once, so the user can fix everything in one pass
 * instead of re-validating after each fix.
 *
 * Out of scope (consumer responsibility):
 *
 * - Domain caps (monthly Q310-Q313 ceilings, indirect/admin ratio,
 *   after-hours premium math). The consuming product owns these
 *   business rules; the adapter validates wire-format correctness only.
 * - Fee eligibility (which fee codes a given physician is contracted
 *   for) — consumer concern.
 *
 * Severity:
 *
 * - `error` — blocks render. Wire format would be malformed or rejected.
 * - `warning` — informational; consumer may proceed but should surface
 *   to the user (stale dates, unknown fee codes, suspicious periods).
 */

import {
  parseIsoDate,
  type ClaimBatch,
  type ClaimItem,
  type PatientReference,
  type ServicePeriod,
  type ValidationReport,
  type ValidationViolation,
} from '@loomantix/billing-adapter';

import { missingItemMessage } from '../emit/errors.js';
import type { OntarioMcedtConfig } from '../emit/index.js';

import { KNOWN_FEE_CODES } from './known-fee-codes.js';

const ANNNS_PATTERN = /^[A-Z][0-9]{3}[A-Z]$/;
const HIN_PATTERN = /^\d{10}$/;
const STALE_THRESHOLD_DAYS = 183;
const TOO_OLD_PERIOD_DAYS = 730;
const FUTURE_PERIOD_GRACE_DAYS = 1;
const UNITS_MIN = 1;
const UNITS_MAX = 99;

interface ViolationContext {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

function pushError(
  violations: ValidationViolation[],
  ctx: ViolationContext,
): void {
  violations.push(
    ctx.path === undefined
      ? { severity: 'error', code: ctx.code, message: ctx.message }
      : {
          severity: 'error',
          code: ctx.code,
          message: ctx.message,
          path: ctx.path,
        },
  );
}

function pushWarning(
  violations: ValidationViolation[],
  ctx: ViolationContext,
): void {
  violations.push(
    ctx.path === undefined
      ? { severity: 'warning', code: ctx.code, message: ctx.message }
      : {
          severity: 'warning',
          code: ctx.code,
          message: ctx.message,
          path: ctx.path,
        },
  );
}

function checkAsciiUppercase(
  value: string,
  fieldCode: string,
  path: string,
  violations: ValidationViolation[],
): void {
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    if (ch < 0x20 || ch > 0x7e) {
      pushError(violations, {
        code: `non-ascii-${fieldCode}`,
        message: `${path} contains non-printable or non-ASCII char at index ${i}`,
        path,
      });
      continue;
    }
    if (ch >= 0x61 && ch <= 0x7a) {
      pushError(violations, {
        code: `lowercase-${fieldCode}`,
        message: `${path} contains lowercase character at index ${i}; MCEDT requires uppercase`,
        path,
      });
      continue;
    }
  }
}

function checkExactWidth(
  value: string,
  width: number,
  fieldCode: string,
  path: string,
  violations: ValidationViolation[],
): void {
  if (value === '') {
    pushError(violations, {
      code: `missing-${fieldCode}`,
      message: `${path} is required`,
      path,
    });
    return;
  }
  if (value.length !== width) {
    pushError(violations, {
      code: `invalid-${fieldCode}-width`,
      message: `${path} must be exactly ${width} chars; got ${value.length}`,
      path,
    });
    return;
  }
  checkAsciiUppercase(value, fieldCode, path, violations);
}

function checkExactWidthDigits(
  value: string,
  width: number,
  fieldCode: string,
  path: string,
  violations: ValidationViolation[],
): void {
  if (value === '') {
    pushError(violations, {
      code: `missing-${fieldCode}`,
      message: `${path} is required`,
      path,
    });
    return;
  }
  if (value.length !== width) {
    pushError(violations, {
      code: `invalid-${fieldCode}-width`,
      message: `${path} must be exactly ${width} digits; got ${value.length}`,
      path,
    });
    return;
  }
  if (!/^\d+$/.test(value)) {
    pushError(violations, {
      code: `invalid-${fieldCode}-format`,
      message: `${path} must be digits only`,
      path,
    });
  }
}

function validateConfig(
  config: OntarioMcedtConfig,
  violations: ValidationViolation[],
): void {
  checkExactWidth(
    config.specVersion,
    3,
    'spec-version',
    'config.specVersion',
    violations,
  );
  checkExactWidth(
    config.batchId,
    12,
    'batch-id',
    'config.batchId',
    violations,
  );

  const ids = config.identifiers;
  checkExactWidth(
    ids.groupNumber,
    4,
    'group-number',
    'config.identifiers.groupNumber',
    violations,
  );
  checkExactWidth(
    ids.mohOfficeCode,
    1,
    'moh-office-code',
    'config.identifiers.mohOfficeCode',
    violations,
  );
  checkExactWidthDigits(
    ids.providerRegNumber,
    6,
    'provider-reg-number',
    'config.identifiers.providerRegNumber',
    violations,
  );
  checkExactWidthDigits(
    ids.specialtyCode,
    2,
    'specialty-code',
    'config.identifiers.specialtyCode',
    violations,
  );
}

function isoDateToDate(value: string): Date | null {
  // The contract type `IsoDate` certifies shape and calendar validity at
  // compile time; this function still re-parses at runtime as
  // defense-in-depth for callers that bypass the type system (JS, `as
  // IsoDate` casts). A successful round-trip yields a Date for the
  // window/staleness arithmetic; failure produces a finding.
  const branded = parseIsoDate(value);
  if (!branded) return null;
  return new Date(branded);
}

function daysBetween(earlier: Date, later: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / 86_400_000);
}

function validatePeriod(
  period: ServicePeriod,
  now: Date,
  violations: ValidationViolation[],
): { start: Date | null; end: Date | null } {
  const start = isoDateToDate(period.start);
  const end = isoDateToDate(period.end);

  if (!start) {
    pushError(violations, {
      code: 'invalid-service-period-start',
      message: `servicePeriod.start must be YYYY-MM-DD; got ${JSON.stringify(period.start)}`,
      path: 'servicePeriod.start',
    });
  }
  if (!end) {
    pushError(violations, {
      code: 'invalid-service-period-end',
      message: `servicePeriod.end must be YYYY-MM-DD; got ${JSON.stringify(period.end)}`,
      path: 'servicePeriod.end',
    });
  }
  if (start && end) {
    if (start.getTime() > end.getTime()) {
      pushError(violations, {
        code: 'invalid-service-period-bounds',
        message: 'servicePeriod.start is after servicePeriod.end',
        path: 'servicePeriod',
      });
    }
    const startInFutureDays = daysBetween(now, start);
    if (startInFutureDays > FUTURE_PERIOD_GRACE_DAYS) {
      pushWarning(violations, {
        code: 'service-period-future',
        message: `servicePeriod.start is ${startInFutureDays} days in the future`,
        path: 'servicePeriod.start',
      });
    }
    const endAgeDays = daysBetween(end, now);
    if (endAgeDays > TOO_OLD_PERIOD_DAYS) {
      pushWarning(violations, {
        code: 'service-period-too-old',
        message: `servicePeriod.end is ${endAgeDays} days old (>${TOO_OLD_PERIOD_DAYS})`,
        path: 'servicePeriod.end',
      });
    }
  }

  return { start, end };
}

function validatePatient(
  patient: PatientReference,
  itemPath: string,
  violations: ValidationViolation[],
): void {
  if (patient.healthNumber === '') {
    pushError(violations, {
      code: 'patient-missing-health-number',
      message: `${itemPath}.patient.healthNumber is empty; omit the patient block for non-patient claims`,
      path: `${itemPath}.patient.healthNumber`,
    });
  } else if (!HIN_PATTERN.test(patient.healthNumber)) {
    pushError(violations, {
      code: 'invalid-patient-health-number',
      message: `${itemPath}.patient.healthNumber must be 10 digits for Ontario`,
      path: `${itemPath}.patient.healthNumber`,
    });
  }

  if (patient.dateOfBirth === '') {
    pushError(violations, {
      code: 'patient-missing-date-of-birth',
      message: `${itemPath}.patient.dateOfBirth is empty`,
      path: `${itemPath}.patient.dateOfBirth`,
    });
  } else if (!isoDateToDate(patient.dateOfBirth)) {
    pushError(violations, {
      code: 'invalid-patient-date-of-birth',
      message: `${itemPath}.patient.dateOfBirth must be YYYY-MM-DD`,
      path: `${itemPath}.patient.dateOfBirth`,
    });
  }

  if (patient.versionCode !== undefined && patient.versionCode !== '') {
    if (patient.versionCode.length !== 2) {
      pushError(violations, {
        code: 'invalid-patient-version-code',
        message: `${itemPath}.patient.versionCode must be exactly 2 chars when present`,
        path: `${itemPath}.patient.versionCode`,
      });
    } else {
      checkAsciiUppercase(
        patient.versionCode,
        'patient-version-code',
        `${itemPath}.patient.versionCode`,
        violations,
      );
    }
  }
}

function validateItem(
  item: ClaimItem,
  index: number,
  period: { start: Date | null; end: Date | null },
  now: Date,
  violations: ValidationViolation[],
): void {
  const itemPath = `items[${index}]`;

  if (item.feeCode === '') {
    pushError(violations, {
      code: 'missing-fee-code',
      message: `${itemPath}.feeCode is required`,
      path: `${itemPath}.feeCode`,
    });
  } else if (!ANNNS_PATTERN.test(item.feeCode)) {
    pushError(violations, {
      code: 'invalid-fee-code-format',
      message: `${itemPath}.feeCode must match ANNNS shape (e.g. 'Q310A'); got ${JSON.stringify(item.feeCode)}`,
      path: `${itemPath}.feeCode`,
    });
  } else if (!KNOWN_FEE_CODES.has(item.feeCode)) {
    pushWarning(violations, {
      code: 'unknown-fee-code',
      message: `${itemPath}.feeCode '${item.feeCode}' is not in the curated known-codes set`,
      path: `${itemPath}.feeCode`,
    });
  }

  if (!Number.isInteger(item.units) || item.units < UNITS_MIN || item.units > UNITS_MAX) {
    pushError(violations, {
      code: 'units-out-of-range',
      message: `${itemPath}.units must be an integer in [${UNITS_MIN}, ${UNITS_MAX}]; got ${item.units}`,
      path: `${itemPath}.units`,
    });
  }

  if (
    !Number.isInteger(item.feeSubmittedCents) ||
    item.feeSubmittedCents <= 0
  ) {
    pushError(violations, {
      code: 'invalid-fee-amount',
      message: `${itemPath}.feeSubmittedCents must be a positive integer (cents); got ${item.feeSubmittedCents}`,
      path: `${itemPath}.feeSubmittedCents`,
    });
  } else if (item.feeSubmittedCents > 999_999) {
    pushError(violations, {
      code: 'fee-amount-overflow',
      message: `${itemPath}.feeSubmittedCents ${item.feeSubmittedCents} exceeds 6-digit field width`,
      path: `${itemPath}.feeSubmittedCents`,
    });
  }

  const serviceDate = isoDateToDate(item.serviceDate);
  if (!serviceDate) {
    pushError(violations, {
      code: 'invalid-service-date',
      message: `${itemPath}.serviceDate must be YYYY-MM-DD; got ${JSON.stringify(item.serviceDate)}`,
      path: `${itemPath}.serviceDate`,
    });
  } else {
    if (period.start && serviceDate.getTime() < period.start.getTime()) {
      pushError(violations, {
        code: 'service-date-before-period',
        message: `${itemPath}.serviceDate is before servicePeriod.start`,
        path: `${itemPath}.serviceDate`,
      });
    }
    if (period.end && serviceDate.getTime() > period.end.getTime()) {
      pushError(violations, {
        code: 'service-date-after-period',
        message: `${itemPath}.serviceDate is after servicePeriod.end`,
        path: `${itemPath}.serviceDate`,
      });
    }
    const ageDays = daysBetween(serviceDate, now);
    if (ageDays > STALE_THRESHOLD_DAYS) {
      pushWarning(violations, {
        code: 'stale-service-date',
        message: `${itemPath}.serviceDate is ${ageDays} days old (>${STALE_THRESHOLD_DAYS}); MOH may reject`,
        path: `${itemPath}.serviceDate`,
      });
    }
  }

  if (item.diagnosticCode !== undefined && item.diagnosticCode !== '') {
    if (item.diagnosticCode.length > 4) {
      pushError(violations, {
        code: 'invalid-diagnostic-code-width',
        message: `${itemPath}.diagnosticCode must be at most 4 chars; got ${item.diagnosticCode.length}`,
        path: `${itemPath}.diagnosticCode`,
      });
    } else {
      checkAsciiUppercase(
        item.diagnosticCode,
        'diagnostic-code',
        `${itemPath}.diagnosticCode`,
        violations,
      );
    }
  }

  if (item.serviceLocation !== undefined && item.serviceLocation !== '') {
    if (item.serviceLocation.length > 4) {
      pushError(violations, {
        code: 'invalid-service-location-width',
        message: `${itemPath}.serviceLocation must be at most 4 chars; got ${item.serviceLocation.length}`,
        path: `${itemPath}.serviceLocation`,
      });
    } else {
      checkAsciiUppercase(
        item.serviceLocation,
        'service-location',
        `${itemPath}.serviceLocation`,
        violations,
      );
    }
  }

  if (item.patient !== undefined) {
    validatePatient(item.patient, itemPath, violations);
  }
}

/**
 * Optional injection point used by tests to pin "now" for stale-date and
 * future-period checks. Production code passes through to {@link Date}.
 */
export interface ValidateBatchOptions {
  readonly now?: Date;
}

/**
 * Aggregate every wire-format-level violation in `batch` against the
 * adapter's static `config`. Never short-circuits.
 */
export function validateBatch(
  batch: ClaimBatch,
  config: OntarioMcedtConfig,
  options: ValidateBatchOptions = {},
): ValidationReport {
  const violations: ValidationViolation[] = [];
  const now = options.now ?? new Date();

  validateConfig(config, violations);

  if (batch.items.length === 0) {
    pushError(violations, {
      code: 'empty-batch',
      message: 'batch contains zero items; render would refuse',
    });
  }

  const period = validatePeriod(batch.servicePeriod, now, violations);

  for (let i = 0; i < batch.items.length; i++) {
    const item = batch.items[i];
    if (!item) {
      pushError(violations, {
        code: 'missing-item',
        message: missingItemMessage(i),
        path: `items[${i}]`,
      });
      continue;
    }
    validateItem(item, i, period, now, violations);
  }

  return { violations };
}
