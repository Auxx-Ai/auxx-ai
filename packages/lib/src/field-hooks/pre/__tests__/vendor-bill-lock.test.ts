// packages/lib/src/field-hooks/pre/__tests__/vendor-bill-lock.test.ts
//
// 73 D4's lock. Three rules:
//
//  1. A `posted` bill with no `editOpen` flag refuses a header write, a line
//     write, a line create and a line delete.
//  2. The flag LIFTS it — every one of those goes through untouched.
//  3. It never fires on a bill that is not posted, and it is registered on
//     nothing the match or the payment writer touches (asserted in
//     `register-hooks` by the attribute lists this file re-reads).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityPreCreateEvent, EntityPreDeleteEvent, FieldPreHookEvent } from '../../types'

const h = vi.hoisted(() => ({
  fields: {} as Record<string, { id: string } | undefined>,
  billRows: [] as Array<{ fieldId: string; optionId: string | null; valueText: string | null }>,
  lineParentRows: [] as Array<{ relatedEntityId: string | null }>,
  editOpen: null as { openedAt: string; byUserId: string } | null,
}))

vi.mock('../../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({ bySystemAttributes: async () => h.fields }),
  }),
}))
vi.mock('../../../accounting/purchasing/bill-edit-flag', () => ({
  readBillEditOpen: async () => h.editOpen,
}))

// Two chains: the bill's own values (`where` resolves) and the line's parent
// relation (`where().limit()` resolves).
vi.mock('@auxx/database', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@auxx/database')
  const chain: Record<string, unknown> = {}
  chain.from = () => chain
  chain.where = () => {
    const withLimit = Object.assign(Promise.resolve(h.billRows), {
      limit: async () => h.lineParentRows,
    })
    return withLimit
  }
  return { ...actual, database: { select: () => chain } }
})

import { ConflictError } from '../../../errors'
import {
  guardPostedVendorBillFields,
  guardPostedVendorBillLineCreate,
  guardPostedVendorBillLineDelete,
  guardPostedVendorBillLineFields,
} from '../vendor-bill-lock'

const ORG = 'abgwpa1l81reht2zmwrcihfu'
const BILL_DEF = 'v5hzr4xbn1fhznih3u74gtza'
const BILL_ID = 'b1ll00000000000000000001'
const LINE_DEF = 'l1nedef00000000000000001'
const LINE_ID = 'l1ne00000000000000000001'

const STATUS_FIELD = 'f_status'
const NUMBER_FIELD = 'f_internal'
const PARENT_FIELD = 'f_parent'

function fieldEvent(recordId: string, systemAttribute: string, value: unknown): FieldPreHookEvent {
  return {
    recordId: recordId as FieldPreHookEvent['recordId'],
    entityDefinitionId: recordId.split(':')[0]!,
    entityType: null,
    entitySlug: 'vendor-bills',
    fieldId: 'f_whatever',
    systemAttribute: systemAttribute as FieldPreHookEvent['systemAttribute'],
    field: {} as FieldPreHookEvent['field'],
    newValue: value as FieldPreHookEvent['newValue'],
    existingValue: undefined,
    allValues: new Map(),
    organizationId: ORG,
    bypass: new Set(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.fields = {
    vendor_bill_status: { id: STATUS_FIELD },
    vendor_bill_internal_number: { id: NUMBER_FIELD },
    vendor_bill_number: undefined,
    vendor_bill_line_vendor_bill: { id: PARENT_FIELD },
  }
  h.billRows = [
    { fieldId: STATUS_FIELD, optionId: 'posted', valueText: null },
    { fieldId: NUMBER_FIELD, optionId: null, valueText: 'BILL-0007' },
  ]
  h.lineParentRows = [{ relatedEntityId: BILL_ID }]
  h.editOpen = null
})

describe('the header lock', () => {
  it('refuses a total write on a posted bill, naming it', async () => {
    await expect(
      guardPostedVendorBillFields(
        fieldEvent(`${BILL_DEF}:${BILL_ID}`, 'vendor_bill_total', { type: 'number', value: 1 })
      )
    ).rejects.toThrow(/BILL-0007/)
  })

  it('lifts once the bill is open for editing', async () => {
    h.editOpen = { openedAt: '2026-09-18T00:00:00.000Z', byUserId: 'u1' }
    const value = { type: 'number', value: 1 }
    await expect(
      guardPostedVendorBillFields(fieldEvent(`${BILL_DEF}:${BILL_ID}`, 'vendor_bill_total', value))
    ).resolves.toEqual(value)
  })

  it('does nothing on a draft bill', async () => {
    h.billRows = [{ fieldId: STATUS_FIELD, optionId: 'draft', valueText: null }]
    const value = { type: 'number', value: 1 }
    await expect(
      guardPostedVendorBillFields(
        fieldEvent(`${BILL_DEF}:${BILL_ID}`, 'vendor_bill_billed_at', value)
      )
    ).resolves.toEqual(value)
  })

  it('does nothing when the org has no status field materialised', async () => {
    h.fields = { ...h.fields, vendor_bill_status: undefined }
    const value = { type: 'number', value: 1 }
    await expect(
      guardPostedVendorBillFields(fieldEvent(`${BILL_DEF}:${BILL_ID}`, 'vendor_bill_total', value))
    ).resolves.toEqual(value)
  })
})

describe('the line lock', () => {
  it('refuses a quantity write on a posted bill’s line', async () => {
    await expect(
      guardPostedVendorBillLineFields(
        fieldEvent(`${LINE_DEF}:${LINE_ID}`, 'vendor_bill_line_quantity_billed', {
          type: 'number',
          value: 4,
        })
      )
    ).rejects.toThrow(ConflictError)
  })

  it('lifts with the flag', async () => {
    h.editOpen = { openedAt: '2026-09-18T00:00:00.000Z', byUserId: 'u1' }
    const value = { type: 'number', value: 4 }
    await expect(
      guardPostedVendorBillLineFields(
        fieldEvent(`${LINE_DEF}:${LINE_ID}`, 'vendor_bill_line_quantity_billed', value)
      )
    ).resolves.toEqual(value)
  })

  it('lets an unattached draft row through — it belongs to no bill', async () => {
    h.lineParentRows = []
    const value = { type: 'number', value: 4 }
    await expect(
      guardPostedVendorBillLineFields(
        fieldEvent(`${LINE_DEF}:${LINE_ID}`, 'vendor_bill_line_quantity_billed', value)
      )
    ).resolves.toEqual(value)
  })

  it('refuses a new line on a posted bill', async () => {
    const event: EntityPreCreateEvent = {
      entityDefinitionId: LINE_DEF,
      entityType: 'vendor_bill_line',
      entitySlug: 'vendor-bill-lines',
      values: { vendor_bill_line_vendor_bill: `${BILL_DEF}:${BILL_ID}` },
      organizationId: ORG,
      userId: 'u1',
    }
    await expect(guardPostedVendorBillLineCreate(event)).rejects.toThrow(/add a line/)
  })

  it('refuses a line delete on a posted bill, and allows it once open', async () => {
    const event: EntityPreDeleteEvent = {
      recordId: `${LINE_DEF}:${LINE_ID}` as EntityPreDeleteEvent['recordId'],
      entityDefinitionId: LINE_DEF,
      entityType: 'vendor_bill_line',
      entitySlug: 'vendor-bill-lines',
      // The capture chain arrays every relationship, even a to-one.
      values: { vendor_bill_line_vendor_bill: [`${BILL_DEF}:${BILL_ID}`] },
      organizationId: ORG,
      userId: 'u1',
      bypass: new Set(),
    }
    await expect(guardPostedVendorBillLineDelete(event)).rejects.toThrow(/remove a line/)

    h.editOpen = { openedAt: '2026-09-18T00:00:00.000Z', byUserId: 'u1' }
    await expect(guardPostedVendorBillLineDelete(event)).resolves.toBeUndefined()
  })
})
