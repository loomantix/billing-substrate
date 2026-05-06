import { describe, expect, it } from 'vitest';

import {
  ONTARIO_MCEDT_IDENTIFIER_KEYS,
  OntarioMcedtAdapter,
  type OntarioMcedtIdentifiers,
} from './index.js';

describe('@loomantix/billing-adapter-ohip — package smoke test', () => {
  it('exports OntarioMcedtAdapter with the ontario-mcedt jurisdiction', () => {
    const adapter = new OntarioMcedtAdapter({
      config: {
        specVersion: '003',
        identifiers: {
          groupNumber: '0A12',
          mohOfficeCode: '7',
          providerRegNumber: '012345',
          specialtyCode: '00',
        },
        batchId: '202604190001',
      },
    });
    expect(adapter.jurisdiction).toBe('ontario-mcedt');
  });

  it('exports the canonical Ontario MCEDT identifier key map', () => {
    expect(ONTARIO_MCEDT_IDENTIFIER_KEYS).toStrictEqual({
      groupNumber: 'groupNumber',
      mohOfficeCode: 'mohOfficeCode',
      providerRegNumber: 'providerRegNumber',
      specialtyCode: 'specialtyCode',
    });
  });

  it('OntarioMcedtIdentifiers structurally accepts the four required fields', () => {
    const identifiers: OntarioMcedtIdentifiers = {
      groupNumber: '1234',
      mohOfficeCode: '7',
      providerRegNumber: '012345',
      specialtyCode: '00',
    };
    expect(Object.keys(identifiers)).toHaveLength(4);
  });
});
