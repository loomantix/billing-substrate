import { createHash } from 'node:crypto';

import type {
  ClaimBatch,
  ClaimItem,
  PatientReference,
} from '@loomantix/billing-adapter';
import { describe, expect, it } from 'vitest';

import { emitClaimFile, type OntarioMcedtConfig } from './emit-claim-file.js';
import { EmitException } from './errors.js';

const config: OntarioMcedtConfig = {
  specVersion: '003',
  identifiers: {
    groupNumber: '0A12',
    mohOfficeCode: '7',
    providerRegNumber: '012345',
    specialtyCode: '00',
  },
  batchId: '202604190001',
};

function q310Item(serviceDate: string, units: number): ClaimItem {
  return {
    serviceDate,
    feeCode: 'Q310A',
    units,
    feeSubmittedCents: 2000 * units,
  };
}

function q313Item(serviceDate: string, units: number): ClaimItem {
  return {
    serviceDate,
    feeCode: 'Q313A',
    units,
    feeSubmittedCents: 2000 * units,
  };
}

function batchOf(items: ClaimItem[]): ClaimBatch {
  return {
    submitterId: 'group-0A12',
    servicePeriod: { start: '2026-04-19', end: '2026-05-18' },
    items,
  };
}

function decode(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

describe('emitClaimFile — basic structure', () => {
  it('emits HEB → HEH → HET → HEE for a single-item batch', async () => {
    const rendered = await emitClaimFile(
      batchOf([q310Item('2026-04-19', 4)]),
      config,
    );

    expect(rendered.bytes.length).toBe(80 * 4);
    const text = decode(rendered.bytes);
    expect(text.slice(0, 3)).toBe('HEB');
    expect(text.slice(80, 83)).toBe('HEH');
    expect(text.slice(160, 163)).toBe('HET');
    expect(text.slice(240, 243)).toBe('HEE');
  });

  it('terminates every record with CR (0x0D)', async () => {
    const rendered = await emitClaimFile(
      batchOf([q310Item('2026-04-19', 4)]),
      config,
    );

    for (let i = 79; i < rendered.bytes.length; i += 80) {
      expect(rendered.bytes[i]).toBe(0x0d);
    }
  });

  it('reports byteCount equal to bytes.length', async () => {
    const rendered = await emitClaimFile(
      batchOf([q310Item('2026-04-19', 4)]),
      config,
    );
    expect(rendered.byteCount).toBe(rendered.bytes.length);
  });

  it('sets jurisdiction to ontario-mcedt', async () => {
    const rendered = await emitClaimFile(
      batchOf([q310Item('2026-04-19', 4)]),
      config,
    );
    expect(rendered.jurisdiction).toBe('ontario-mcedt');
  });
});

describe('emitClaimFile — Q310-Q313 hourly grouping', () => {
  it('emits one HEH per item when no patient (each Q-code is its own claim)', async () => {
    const rendered = await emitClaimFile(
      batchOf([
        q310Item('2026-04-19', 2),
        q313Item('2026-04-19', 4),
      ]),
      config,
    );

    // HEB + 2*(HEH+HET) + HEE = 6 records = 480 bytes
    expect(rendered.bytes.length).toBe(80 * 6);
    const text = decode(rendered.bytes);
    expect(text.slice(80, 83)).toBe('HEH');
    expect(text.slice(160, 163)).toBe('HET');
    expect(text.slice(240, 243)).toBe('HEH');
    expect(text.slice(320, 323)).toBe('HET');
    expect(text.slice(400, 403)).toBe('HEE');
  });

  it('reports correct claim and item counts in HEE', async () => {
    const rendered = await emitClaimFile(
      batchOf([
        q310Item('2026-04-19', 2),
        q313Item('2026-04-19', 4),
        q310Item('2026-04-20', 1),
      ]),
      config,
    );

    const text = decode(rendered.bytes);
    const hee = text.slice(text.length - 80, text.length - 1);
    expect(hee.slice(3, 7)).toBe('0003');
    expect(hee.slice(7, 11)).toBe('0000');
    expect(hee.slice(11, 16)).toBe('00003');
  });

  it('assigns sequential accountingNumbers per HEH', async () => {
    const rendered = await emitClaimFile(
      batchOf([
        q310Item('2026-04-19', 2),
        q313Item('2026-04-19', 4),
      ]),
      config,
    );

    const text = decode(rendered.bytes);
    const heh1 = text.slice(80, 159);
    const heh2 = text.slice(240, 319);
    expect(heh1.slice(23, 31)).toBe('00000001');
    expect(heh2.slice(23, 31)).toBe('00000002');
  });
});

describe('emitClaimFile — patient-linked grouping', () => {
  const patient = {
    healthNumber: '1234567890',
    versionCode: 'AB',
    dateOfBirth: '1980-04-19',
  };

  it('groups items for same patient + same day under one HEH', async () => {
    const rendered = await emitClaimFile(
      batchOf([
        { serviceDate: '2026-04-19', feeCode: 'A007A', units: 1, feeSubmittedCents: 3500, patient },
        { serviceDate: '2026-04-19', feeCode: 'G365A', units: 1, feeSubmittedCents: 1200, patient },
      ]),
      config,
    );

    // HEB + 1*(HEH+2*HET) + HEE = 5 records
    expect(rendered.bytes.length).toBe(80 * 5);
    const text = decode(rendered.bytes);
    expect(text.slice(80, 83)).toBe('HEH');
    expect(text.slice(160, 163)).toBe('HET');
    expect(text.slice(240, 243)).toBe('HET');
    expect(text.slice(320, 323)).toBe('HEE');
  });

  it('separates same patient across different days into distinct HEHs', async () => {
    const rendered = await emitClaimFile(
      batchOf([
        { serviceDate: '2026-04-19', feeCode: 'A007A', units: 1, feeSubmittedCents: 3500, patient },
        { serviceDate: '2026-04-22', feeCode: 'A007A', units: 1, feeSubmittedCents: 3500, patient },
      ]),
      config,
    );

    // 2 visits = 2 HEHs + 2 HETs
    expect(rendered.bytes.length).toBe(80 * 6);
    const text = decode(rendered.bytes);
    expect(text.slice(80, 83)).toBe('HEH');
    expect(text.slice(160, 163)).toBe('HET');
    expect(text.slice(240, 243)).toBe('HEH');
    expect(text.slice(320, 323)).toBe('HET');
  });
});

describe('emitClaimFile — determinism (contract obligation 2)', () => {
  it('produces byte-identical output across N renders of the same input', async () => {
    const items = [
      q313Item('2026-04-22', 4),
      q310Item('2026-04-19', 2),
      q313Item('2026-04-19', 4),
      q310Item('2026-04-22', 1),
    ];
    const renders = await Promise.all(
      Array.from({ length: 5 }, () => emitClaimFile(batchOf(items), config)),
    );

    const first = renders[0]!;
    for (const r of renders.slice(1)) {
      expect(r.bytes).toEqual(first.bytes);
      expect(r.contentHashSha256Hex).toBe(first.contentHashSha256Hex);
    }
  });

  it('sorts items by serviceDate ascending then feeCode ascending', async () => {
    const unsorted = [
      q313Item('2026-04-22', 4),
      q310Item('2026-04-19', 2),
      q313Item('2026-04-19', 4),
      q310Item('2026-04-22', 1),
    ];
    const rendered = await emitClaimFile(batchOf(unsorted), config);
    const text = decode(rendered.bytes);

    const hetSlots = [160, 320, 480, 640];
    const serviceDates = hetSlots.map((slot) =>
      text.slice(slot + 18, slot + 26),
    );
    expect(serviceDates).toEqual([
      '20260419',
      '20260419',
      '20260422',
      '20260422',
    ]);

    const feeCodes = hetSlots.map((slot) => text.slice(slot + 3, slot + 8));
    expect(feeCodes).toEqual(['Q310A', 'Q313A', 'Q310A', 'Q313A']);
  });
});

describe('emitClaimFile — content hash (contract obligation 3)', () => {
  it('contentHashSha256Hex equals SHA-256 of bytes', async () => {
    const rendered = await emitClaimFile(
      batchOf([q310Item('2026-04-19', 4), q313Item('2026-04-19', 4)]),
      config,
    );
    const expected = createHash('sha256').update(rendered.bytes).digest('hex');
    expect(rendered.contentHashSha256Hex).toBe(expected);
  });

  it('different inputs produce different hashes', async () => {
    const a = await emitClaimFile(
      batchOf([q310Item('2026-04-19', 4)]),
      config,
    );
    const b = await emitClaimFile(
      batchOf([q310Item('2026-04-19', 5)]),
      config,
    );
    expect(a.contentHashSha256Hex).not.toBe(b.contentHashSha256Hex);
  });
});

describe('emitClaimFile — error handling', () => {
  it('rejects an empty batch with empty-batch error', async () => {
    try {
      await emitClaimFile(batchOf([]), config);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(EmitException);
      const err = (e as EmitException).error;
      expect(err.kind).toBe('empty-batch');
    }
  });

  it('rejects a sparse-array hole in items with missing-item rather than silently dropping', async () => {
    // Defends against the silent-skip pattern that previously lived
    // in groupClaimEnvelopes and assertPatientFieldsPresent. Dropping
    // a hole would break LineResult.itemIndex correlation downstream.
    const items: ClaimItem[] = [
      q310Item('2026-04-19', 4),
      undefined as unknown as ClaimItem,
      q310Item('2026-04-22', 2),
    ];
    try {
      await emitClaimFile(batchOf(items), config);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(EmitException);
      const err = (e as EmitException).error;
      expect(err.kind).toBe('missing-item');
      if (err.kind === 'missing-item') {
        expect(err.itemIndex).toBe(1);
      }
    }
  });

  it('rejects a batch that would exceed the 10MB MOH limit', async () => {
    const itemCount = Math.ceil((10 * 1024 * 1024) / 80) + 100;
    const items: ClaimItem[] = Array.from({ length: itemCount }, (_, i) =>
      q310Item('2026-04-19', (i % 99) + 1),
    );

    try {
      await emitClaimFile(batchOf(items), config);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(EmitException);
      const err = (e as EmitException).error;
      expect(err.kind).toBe('file-too-large');
      if (err.kind === 'file-too-large') {
        expect(err.fileSize).toBeGreaterThan(err.maxSize);
      }
    }
  });

  it('propagates encoder failures (e.g. lowercase service code)', async () => {
    await expect(
      emitClaimFile(
        batchOf([
          {
            serviceDate: '2026-04-19',
            feeCode: 'q310a',
            units: 4,
            feeSubmittedCents: 8000,
          },
        ]),
        config,
      ),
    ).rejects.toThrow();
  });

  it('rejects a patient block with empty healthNumber', async () => {
    const item: ClaimItem = {
      serviceDate: '2026-04-19',
      feeCode: 'A007A',
      units: 1,
      feeSubmittedCents: 3500,
      patient: {
        healthNumber: '',
        versionCode: 'AB',
        dateOfBirth: '1980-04-19',
      },
    };
    try {
      await emitClaimFile(batchOf([item]), config);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(EmitException);
      const err = (e as EmitException).error;
      expect(err.kind).toBe('patient-missing-required-field');
      if (err.kind === 'patient-missing-required-field') {
        expect(err.field).toBe('healthNumber');
        expect(err.itemIndex).toBe(0);
      }
    }
  });

  it('rejects a patient block with empty dateOfBirth', async () => {
    const item: ClaimItem = {
      serviceDate: '2026-04-19',
      feeCode: 'A007A',
      units: 1,
      feeSubmittedCents: 3500,
      patient: {
        healthNumber: '1234567890',
        versionCode: 'AB',
        dateOfBirth: '',
      },
    };
    await expect(emitClaimFile(batchOf([item]), config)).rejects.toThrow(
      EmitException,
    );
  });

  it('rejects a group whose items disagree on serviceLocation', async () => {
    const patient: PatientReference = {
      healthNumber: '1234567890',
      versionCode: 'AB',
      dateOfBirth: '1980-04-19',
    };
    try {
      await emitClaimFile(
        batchOf([
          {
            serviceDate: '2026-04-19',
            feeCode: 'A007A',
            units: 1,
            feeSubmittedCents: 3500,
            patient,
            serviceLocation: 'HOSP',
          },
          {
            serviceDate: '2026-04-19',
            feeCode: 'G365A',
            units: 1,
            feeSubmittedCents: 1200,
            patient,
            serviceLocation: 'OFFC',
          },
        ]),
        config,
      );
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(EmitException);
      const err = (e as EmitException).error;
      expect(err.kind).toBe('inconsistent-group-field');
      if (err.kind === 'inconsistent-group-field') {
        expect(err.field).toBe('serviceLocation');
        expect(err.firstValue).toBe('HOSP');
        expect(err.conflictingValue).toBe('OFFC');
      }
    }
  });

  it('rejects a group whose items disagree on patient.versionCode', async () => {
    try {
      await emitClaimFile(
        batchOf([
          {
            serviceDate: '2026-04-19',
            feeCode: 'A007A',
            units: 1,
            feeSubmittedCents: 3500,
            patient: {
              healthNumber: '1234567890',
              versionCode: 'AB',
              dateOfBirth: '1980-04-19',
            },
          },
          {
            serviceDate: '2026-04-19',
            feeCode: 'G365A',
            units: 1,
            feeSubmittedCents: 1200,
            patient: {
              healthNumber: '1234567890',
              versionCode: 'CD',
              dateOfBirth: '1980-04-19',
            },
          },
        ]),
        config,
      );
      throw new Error('should have thrown');
    } catch (e) {
      const err = (e as EmitException).error;
      expect(err.kind).toBe('inconsistent-group-field');
      if (err.kind === 'inconsistent-group-field') {
        expect(err.field).toBe('versionCode');
      }
    }
  });
});

describe('emitClaimFile — coverage gaps surfaced by review (PR #20)', () => {
  const patient: PatientReference = {
    healthNumber: '1234567890',
    versionCode: 'AB',
    dateOfBirth: '1980-04-19',
  };

  it('writes serviceLocation into HEH bytes 58-62 when present', async () => {
    const rendered = await emitClaimFile(
      batchOf([
        {
          serviceDate: '2026-04-19',
          feeCode: 'A007A',
          units: 1,
          feeSubmittedCents: 3500,
          patient,
          serviceLocation: 'HDS',
        },
      ]),
      config,
    );
    const heh = decode(rendered.bytes).slice(80, 159);
    expect(heh.slice(58, 62)).toBe('HDS ');
  });

  it('encodes a patient claim with no versionCode (HEH bytes 13-15 blank)', async () => {
    const noVersion: PatientReference = {
      healthNumber: '1234567890',
      dateOfBirth: '1980-04-19',
    };
    const rendered = await emitClaimFile(
      batchOf([
        {
          serviceDate: '2026-04-19',
          feeCode: 'A007A',
          units: 1,
          feeSubmittedCents: 3500,
          patient: noVersion,
        },
      ]),
      config,
    );
    const heh = decode(rendered.bytes).slice(80, 159);
    expect(heh.slice(3, 13)).toBe('1234567890');
    expect(heh.slice(13, 15)).toBe('  ');
    expect(heh.slice(15, 23)).toBe('19800419');
  });

  it('attaches diagnosticCode to the correct HET after sort reordering', async () => {
    const rendered = await emitClaimFile(
      batchOf([
        {
          serviceDate: '2026-04-19',
          feeCode: 'G365A',
          units: 1,
          feeSubmittedCents: 1200,
          patient,
          diagnosticCode: '496',
        },
        {
          serviceDate: '2026-04-19',
          feeCode: 'A007A',
          units: 1,
          feeSubmittedCents: 3500,
          patient,
          diagnosticCode: '799',
        },
      ]),
      config,
    );
    const text = decode(rendered.bytes);
    expect(text.slice(160 + 3, 160 + 8)).toBe('A007A');
    expect(text.slice(160 + 26, 160 + 30)).toBe('799 ');
    expect(text.slice(240 + 3, 240 + 8)).toBe('G365A');
    expect(text.slice(240 + 26, 240 + 30)).toBe('496 ');
  });

  it('produces identical content hash regardless of caller insertion order (sort is total)', async () => {
    const items: ClaimItem[] = [
      {
        serviceDate: '2026-04-19',
        feeCode: 'Q313A',
        units: 4,
        feeSubmittedCents: 8000,
      },
      {
        serviceDate: '2026-04-19',
        feeCode: 'Q313A',
        units: 4,
        feeSubmittedCents: 7900,
      },
      {
        serviceDate: '2026-04-19',
        feeCode: 'Q310A',
        units: 2,
        feeSubmittedCents: 4000,
      },
    ];

    const a = await emitClaimFile(batchOf(items), config);
    const b = await emitClaimFile(batchOf([...items].reverse()), config);
    const c = await emitClaimFile(
      batchOf([items[2]!, items[0]!, items[1]!]),
      config,
    );

    expect(b.contentHashSha256Hex).toBe(a.contentHashSha256Hex);
    expect(c.contentHashSha256Hex).toBe(a.contentHashSha256Hex);
    expect(b.bytes).toEqual(a.bytes);
    expect(c.bytes).toEqual(a.bytes);
  });
});

describe('emitClaimFile — golden bytes', () => {
  it('renders a known fixture (single Q313, 4 units, 1 hour)', async () => {
    const rendered = await emitClaimFile(
      batchOf([q313Item('2026-04-19', 4)]),
      config,
    );
    const text = decode(rendered.bytes);

    const heb = text.slice(0, 79);
    expect(heb.slice(0, 3)).toBe('HEB');
    expect(heb.slice(3, 6)).toBe('003');
    expect(heb.slice(6, 7)).toBe('7');
    expect(heb.slice(7, 19)).toBe('202604190001');
    expect(heb.slice(25, 29)).toBe('0A12');
    expect(heb.slice(29, 35)).toBe('012345');
    expect(heb.slice(35, 37)).toBe('00');

    const heh = text.slice(80, 159);
    expect(heh.slice(0, 3)).toBe('HEH');
    expect(heh.slice(3, 13)).toBe('          ');
    expect(heh.slice(15, 23)).toBe('        ');
    expect(heh.slice(23, 31)).toBe('00000001');
    expect(heh.slice(31, 34)).toBe('HCP');
    expect(heh.slice(34, 35)).toBe('P');

    const het = text.slice(160, 239);
    expect(het.slice(0, 3)).toBe('HET');
    expect(het.slice(3, 8)).toBe('Q313A');
    expect(het.slice(10, 16)).toBe('008000');
    expect(het.slice(16, 18)).toBe('04');
    expect(het.slice(18, 26)).toBe('20260419');

    const hee = text.slice(240, 319);
    expect(hee.slice(0, 3)).toBe('HEE');
    expect(hee.slice(3, 7)).toBe('0001');
    expect(hee.slice(7, 11)).toBe('0000');
    expect(hee.slice(11, 16)).toBe('00001');
  });
});
