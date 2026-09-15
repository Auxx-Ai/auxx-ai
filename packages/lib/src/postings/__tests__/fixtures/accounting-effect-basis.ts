// packages/lib/src/postings/__tests__/fixtures/accounting-effect-basis.ts
import type { AcceptedFulfillmentEffectBasisV1, AccountingWorkBasisInput } from '../../effect-types'

export const SOURCE_HASH = 'a'.repeat(64)
/** Complete current-policy input fixture with decimal quantities and exact integer money. */
export function readyBasis(id: string): Extract<AccountingWorkBasisInput, { status: 'ready' }> {
  return {
    version: 1,
    status: 'ready',
    fulfillmentInstanceId: id,
    sourceHash: SOURCE_HASH,
    effectiveDate: '2026-09-14',
    calculation: {
      version: 1,
      fulfillmentInstanceId: id,
      orderInstanceId: 'order',
      customerInstanceId: null,
      sequence: 1,
      sourceRevision: 'revision1',
      sourceHash: SOURCE_HASH,
      shippedOn: '2026-09-14',
      channel: null,
      sourceStoreId: null,
      processorRouteId: null,
      shippingRegion: null,
      dimensions: {},
      lines: [
        {
          fulfillmentLineId: 'fl1',
          orderLineId: 'ol1',
          productInstanceId: null,
          sku: null,
          quantity: '1',
          orderedQuantity: '1',
          priorShippedQuantity: '0',
          netUnitMinor: '100',
          netLineMinor: '100',
          lineTaxMinor: '0',
        },
      ],
      orderSubtotalMinor: '100',
      orderTaxMinor: '0',
      orderShippingMinor: '0',
      priorShipmentSubtotalMinor: '0',
      shippingAllocationMinor: '0',
      includeShipping: false,
      taxComponents: [],
      debitRoute: { kind: 'role', role: 'clearing_card', reason: 'Current debit route' },
    },
  }
}
/** Balanced accepted contribution matching the ready input fixture. */
export function acceptedBasis(id: string): AcceptedFulfillmentEffectBasisV1 {
  return {
    version: 1,
    sourceBasisVersion: 1,
    sourceHash: SOURCE_HASH,
    policyKey: 'fulfillment_current_v1',
    policyVersion: 1,
    effectiveDate: '2026-09-14',
    bookTimeZone: 'UTC',
    currency: 'USD',
    currencyExponent: 2,
    documentRefs: [
      { resourceKind: 'fulfillment', entityInstanceId: id },
      { resourceKind: 'order', entityInstanceId: 'order' },
    ],
    calculation: readyBasis(id).calculation,
    accountResolution: ['clearing', 'revenue'].map((key) => ({
      lineKey: key,
      glAccountId: key,
      accountRole: null,
      selectedBy: 'org_role',
      configurationHash: SOURCE_HASH,
    })),
    contribution: [
      {
        lineKey: 'clearing',
        glAccountId: 'clearing',
        direction: 'debit',
        amountMinor: '100',
        counterpartyType: null,
        counterpartyId: null,
        dimensions: {},
      },
      {
        lineKey: 'revenue',
        glAccountId: 'revenue',
        direction: 'credit',
        amountMinor: '100',
        counterpartyType: null,
        counterpartyId: null,
        dimensions: {},
      },
    ],
  }
}
