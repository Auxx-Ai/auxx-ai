// packages/lib/src/purchasing/bill-intake/__tests__/create.int.test.ts

/**
 * Real PostgreSQL coverage for the intake create seam. Unit tests prove the
 * ordering with a fake handler; this test proves that the generic CRUD path
 * creates a bill and absorbed bill line, and that the billed PO roll-up is
 * visible in the database after the post-commit recalculation.
 */

import { type Database, schema } from '@auxx/database'
import { getTestDb } from '@auxx/test-utils'
import { parseRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toRecordId } from '../../../resources/resource-id'
import type { TranscribedInvoice } from '../client'
import { createBillFromIntake } from '../create'
import type { StoredBillIntakeRun } from '../run-store'
import { type BillFixture, fieldId, seedBillOrg } from './support/bill-fixture'

const db = () => getTestDb() as unknown as Database

// These queue-backed side effects are outside the CRUD and roll-up claim. The
// production publisher is awaited by generic writes and would otherwise need a
// live Redis connection in this database-only integration test.
vi.mock('../../../events/publisher', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, publisher: { publish: async () => {}, publishLater: async () => {} } }
})
vi.mock('../../../dedup/enqueue-scan', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, enqueueDuplicateScan: async () => {} }
})
vi.mock('../../../files/assets/asset-mutations', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    convertTempAssetToPermanent: async () => ok(undefined),
  }
})
vi.mock('../../match-hook', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../match-hook')>()
  return {
    ...actual,
    rematchBill: async () => {},
    rematchOnBillChange: async () => {},
    rematchOnBillLineChange: async () => {},
    rematchAfterBillLineDelete: async () => {},
  }
})
vi.mock('../run-store', async () => {
  const { ok } = await import('neverthrow')
  return { markBillIntakeRunCreated: async () => ok(undefined) }
})

const invoice: TranscribedInvoice = {
  vendorName: 'Acme Supplies Ltd',
  vendorEmail: null,
  vendorAddress: null,
  invoiceNumber: 'INV-INT-1',
  invoiceDate: '2026-09-01',
  dueDate: '2026-10-01',
  paymentTerms: 'Net 30',
  purchaseOrderReference: null,
  currency: 'USD',
  subtotalText: '12.60',
  shippingText: null,
  taxText: null,
  discountText: null,
  totalText: '12.60',
  lines: [
    {
      lineNumber: 1,
      vendorCode: 'V-AF-4420',
      customerCode: 'AF-4420',
      description: 'Hex bolt M8x40',
      quantity: 3,
      unit: 'ea',
      unitPriceText: '4.20',
      lineTotalText: '12.60',
    },
  ],
} as const

function run(fixture: BillFixture): StoredBillIntakeRun {
  const vendorRecordId = toRecordId(fixture.companyDefId, fixture.vendorId)
  const orderLineRecordId = toRecordId(fixture.purchaseOrderLineDefId, fixture.purchaseOrderLineId)
  const partRecordId = toRecordId(fixture.partDefId, fixture.partId)
  return {
    id: 'run-integration',
    organizationId: fixture.organizationId,
    createdById: fixture.userId,
    status: 'reading',
    phase: 'bill',
    assetRef: 'asset:temporary-integration-asset',
    fileName: 'invoice.pdf',
    mimeType: 'application/pdf',
    vendorRecordId,
    vendorCandidates: [],
    purchaseOrderRecordId: toRecordId(fixture.purchaseOrderDefId, fixture.purchaseOrderId),
    transcription: invoice,
    extractedText: null,
    proposals: [
      {
        lineId: '0',
        tier: 'vendor_sku',
        candidates: [
          {
            orderLineRecordId,
            partRecordId,
            label: 'Hex bolt M8x40',
            tier: 'vendor_sku',
            reasons: ['vendor code matches'],
            score: 1000,
          },
        ],
        linkedOrderLineRecordId: orderLineRecordId,
        hint: 'goods',
      },
    ],
    warnings: [],
    vendorBillInstanceId: null,
    vendorBillRecordId: null,
    vendorBillLineRecordIds: [],
    existingBillRecordId: null,
    error: null,
    createdAt: '2026-09-14T00:00:00.000Z',
  }
}

async function valueFor(
  fixture: BillFixture,
  attribute: string,
  entityId: string
): Promise<{
  valueText: string | null
  valueNumber: number | null
  relatedEntityId: string | null
} | null> {
  const id = await fieldId(fixture, attribute)
  const [value] = await db()
    .select({
      valueText: schema.FieldValue.valueText,
      valueNumber: schema.FieldValue.valueNumber,
      relatedEntityId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, fixture.organizationId),
        eq(schema.FieldValue.fieldId, id),
        eq(schema.FieldValue.entityId, entityId)
      )
    )
    .limit(1)
  return value ?? null
}

let fixture: BillFixture

beforeEach(async () => {
  fixture = await seedBillOrg()
})

describe('createBillFromIntake with real CRUD', () => {
  it('creates the bill and updates the purchase order billed roll-up', async () => {
    const result = await createBillFromIntake(
      db(),
      fixture.organizationId,
      fixture.userId,
      run(fixture)
    )
    expect(result.isOk()).toBe(true)
    const created = result._unsafeUnwrap()

    const bill = await valueFor(fixture, 'vendor_bill_number', created.vendorBillInstanceId)
    expect(bill?.valueText).toBe('INV-INT-1')

    const billLine = await valueFor(
      fixture,
      'vendor_bill_line_quantity_billed',
      parseRecordId(created.vendorBillLineRecordIds[0]!).entityInstanceId
    )
    expect(billLine?.valueNumber).toBe(3)

    const billed = await valueFor(
      fixture,
      'purchase_order_line_quantity_billed',
      fixture.purchaseOrderLineId
    )
    expect(billed?.valueNumber).toBe(3)

    const linked = await valueFor(
      fixture,
      'vendor_bill_line_purchase_order_line',
      parseRecordId(created.vendorBillLineRecordIds[0]!).entityInstanceId
    )
    expect(linked?.relatedEntityId).toBe(fixture.purchaseOrderLineId)
  })
})
