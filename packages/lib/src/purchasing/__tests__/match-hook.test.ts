// packages/lib/src/purchasing/__tests__/match-hook.test.ts
//
// `matchBill` was written and tested to exhaustion and then nothing called it, so
// `vendor_bill_status`, `_match_variance` and `_match_notes` — all three declared
// `creatable: false` with "the three-way match hook is the only writer" — stayed empty
// and the exception queue rendered stored values that were never stored. These tests pin
// the wiring rather than the math.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityFieldChangeEvent, EntityPostDeleteEvent } from '../../field-hooks/types'

const h = vi.hoisted(() => ({
  bySystemAttributes: vi.fn(),
  getFieldValues: vi.fn(),
  listFiltered: vi.fn(),
  setValuesForEntity: vi.fn(),
}))

vi.mock('../../cache', () => ({
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
}))
vi.mock('../../resources/crud', () => ({
  UnifiedCrudHandler: class {
    getFieldValues = h.getFieldValues
    listFiltered = h.listFiltered
  },
}))
vi.mock('../../field-values/field-value-service', () => ({
  FieldValueService: class {
    setValuesForEntity = h.setValuesForEntity
  },
}))

import {
  BILL_LINE_MATCH_TRIGGER_ATTRS,
  BILL_MATCH_TRIGGER_ATTRS,
  rematchAfterBillLineDelete,
  rematchBill,
  rematchOnBillLineChange,
} from '../match-hook'

const FIELDS: Record<string, { id: string; type: string }> = {
  vendor_bill_status: { id: 'f-status', type: 'SINGLE_SELECT' },
  vendor_bill_currency: { id: 'f-currency', type: 'STRING' },
  vendor_bill_match_variance: { id: 'f-variance', type: 'CURRENCY' },
  vendor_bill_match_notes: { id: 'f-notes', type: 'TEXT' },
  vendor_bill_line_quantity_billed: { id: 'f-bl-qty', type: 'NUMBER' },
  vendor_bill_line_unit_price: { id: 'f-bl-price', type: 'CURRENCY' },
  vendor_bill_line_purchase_order_line: { id: 'f-bl-pol', type: 'RELATIONSHIP' },
  vendor_bill_line_vendor_bill: { id: 'f-bl-bill', type: 'RELATIONSHIP' },
  purchase_order_line_quantity_received: { id: 'f-pol-recv', type: 'NUMBER' },
  purchase_order_line_expected_unit_price: { id: 'f-pol-price', type: 'CURRENCY' },
}

/** Field values keyed by recordId, assembled per test. */
let recordValues: Record<string, Record<string, unknown>> = {}

function written(fieldId: string): unknown {
  const call = h.setValuesForEntity.mock.calls.at(-1)?.[0] as
    | { values: Array<{ fieldId: string; value: unknown }> }
    | undefined
  return call?.values.find((v) => v.fieldId === fieldId)?.value
}

function writtenIds(): string[] {
  const call = h.setValuesForEntity.mock.calls.at(-1)?.[0] as
    | { values: Array<{ fieldId: string }> }
    | undefined
  return (call?.values ?? []).map((v) => v.fieldId)
}

beforeEach(() => {
  vi.clearAllMocks()
  recordValues = {}
  h.bySystemAttributes.mockImplementation(async (attrs: string[]) =>
    Object.fromEntries(attrs.filter((a) => FIELDS[a]).map((a) => [a, FIELDS[a]]))
  )
  h.getFieldValues.mockImplementation(
    async (recordId: string) => new Map(Object.entries(recordValues[recordId] ?? {}))
  )
  h.listFiltered.mockResolvedValue({ ids: [] })
  h.setValuesForEntity.mockResolvedValue(undefined)
})

function billIsDraft() {
  recordValues['vendor_bill:bill-1'] = {
    'f-status': { type: 'option', optionId: 'draft' },
  }
}

function line(
  id: string,
  poLineId: string,
  billed: number,
  price: number,
  received: number,
  expected: number
) {
  recordValues[`vendor_bill_line:${id}`] = {
    'f-bl-qty': { type: 'number', value: billed },
    'f-bl-price': { type: 'number', value: price },
    'f-bl-pol': { type: 'relationship', recordId: `purchase_order_line:${poLineId}` },
  }
  recordValues[`purchase_order_line:${poLineId}`] = {
    'f-pol-recv': { type: 'number', value: received },
    'f-pol-price': { type: 'number', value: expected },
  }
}

const rematch = () =>
  rematchBill({ organizationId: 'org_1', userId: 'usr_1', vendorBillInstanceId: 'bill-1' })

describe('rematchBill', () => {
  it('writes `matched` and a zero variance when the bill agrees with the receipts', async () => {
    billIsDraft()
    h.listFiltered.mockResolvedValue({ ids: ['bl-1'] })
    line('bl-1', 'pol-1', 10, 500, 10, 500)

    await rematch()

    expect(written('f-status')).toBe('matched')
    expect(written('f-variance')).toBe(0)
    expect(written('f-notes')).toBeNull()
  })

  it('writes `exception` with the reason in words when the vendor over-bills', async () => {
    billIsDraft()
    h.listFiltered.mockResolvedValue({ ids: ['bl-1'] })
    line('bl-1', 'pol-1', 10, 500, 4, 500)

    await rematch()

    expect(written('f-status')).toBe('exception')
    // 10 * 500 billed against 4 * 500 received — the variance uses RECEIVED on the
    // expected side, so over-billing cannot net itself out.
    expect(written('f-variance')).toBe(3000)
    expect(written('f-notes')).toContain('billed 10 but only 4 received')
  })

  it("renders the notes in the bill's own currency scale", async () => {
    // The prose the queue reads is written once, here — so the exponent has to
    // come off the bill rather than be assumed to be 2. 1000 yen is 1000.
    recordValues['vendor_bill:bill-1'] = {
      'f-status': { type: 'option', optionId: 'draft' },
      'f-currency': { type: 'text', value: 'JPY' },
    }
    h.listFiltered.mockResolvedValue({ ids: ['bl-1'] })
    line('bl-1', 'pol-1', 1, 0, 1, 1000)

    await rematch()

    expect(written('f-notes')).toContain('an agreed 1000 ')
  })

  it('falls back to a 2-decimal scale when the bill carries no currency', async () => {
    billIsDraft()
    h.listFiltered.mockResolvedValue({ ids: ['bl-1'] })
    line('bl-1', 'pol-1', 1, 0, 1, 1000)

    await rematch()

    expect(written('f-notes')).toContain('an agreed 10.00 ')
  })

  it('never un-posts a settled bill', async () => {
    for (const status of ['posted', 'paid', 'void']) {
      h.setValuesForEntity.mockClear()
      recordValues['vendor_bill:bill-1'] = { 'f-status': { type: 'option', optionId: status } }
      h.listFiltered.mockResolvedValue({ ids: ['bl-1'] })
      line('bl-1', 'pol-1', 10, 500, 0, 500)

      await rematch()

      expect(h.setValuesForEntity).not.toHaveBeenCalled()
    }
  })

  it('treats a bill with no status yet as a fresh draft', async () => {
    recordValues['vendor_bill:bill-1'] = {}
    h.listFiltered.mockResolvedValue({ ids: ['bl-1'] })
    line('bl-1', 'pol-1', 10, 500, 10, 500)

    await rematch()

    expect(written('f-status')).toBe('matched')
  })

  it('clears the verdict — and drops back to draft — when no line is matchable', async () => {
    recordValues['vendor_bill:bill-1'] = {
      'f-status': { type: 'option', optionId: 'exception' },
    }
    h.listFiltered.mockResolvedValue({ ids: ['bl-1'] })
    recordValues['vendor_bill_line:bl-1'] = {
      'f-bl-qty': { type: 'number', value: 1 },
      'f-bl-price': { type: 'number', value: 900 },
    }

    await rematch()

    expect(written('f-variance')).toBeNull()
    expect(written('f-notes')).toBeNull()
    expect(written('f-status')).toBe('draft')
  })

  it('leaves a draft bill with no matchable lines as a draft', async () => {
    billIsDraft()
    h.listFiltered.mockResolvedValue({ ids: [] })

    await rematch()

    expect(writtenIds()).toEqual(['f-variance', 'f-notes'])
  })

  it('counts an unlinked line in the notes without making it an exception', async () => {
    billIsDraft()
    h.listFiltered.mockResolvedValue({ ids: ['bl-1', 'bl-freight'] })
    line('bl-1', 'pol-1', 10, 500, 10, 500)
    recordValues['vendor_bill_line:bl-freight'] = {
      'f-bl-qty': { type: 'number', value: 1 },
      'f-bl-price': { type: 'number', value: 2500 },
    }

    await rematch()

    expect(written('f-status')).toBe('matched')
    expect(written('f-notes')).toBe('1 line not matched to a purchase order line')
  })

  it('reads the received quantity from the PO LINE, not from the bill line', async () => {
    billIsDraft()
    h.listFiltered.mockResolvedValue({ ids: ['bl-1'] })
    line('bl-1', 'pol-1', 5, 100, 5, 100)

    await rematch()

    expect(h.getFieldValues).toHaveBeenCalledWith(
      'purchase_order_line:pol-1',
      expect.arrayContaining(['f-pol-recv', 'f-pol-price'])
    )
  })
})

describe('the trigger vocabulary', () => {
  it('never contains a field the hook itself writes — that would recurse', () => {
    for (const attr of [
      'vendor_bill_status',
      'vendor_bill_match_variance',
      'vendor_bill_match_notes',
    ]) {
      expect(BILL_MATCH_TRIGGER_ATTRS.has(attr as never)).toBe(false)
      expect(BILL_LINE_MATCH_TRIGGER_ATTRS.has(attr as never)).toBe(false)
    }
  })

  it('re-matches the parent bill when a line’s billed quantity moves', async () => {
    billIsDraft()
    recordValues['vendor_bill_line:bl-1'] = {
      'f-bl-bill': { type: 'relationship', recordId: 'vendor_bill:bill-1' },
      'f-bl-qty': { type: 'number', value: 10 },
      'f-bl-price': { type: 'number', value: 500 },
      'f-bl-pol': { type: 'relationship', recordId: 'purchase_order_line:pol-1' },
    }
    recordValues['purchase_order_line:pol-1'] = {
      'f-pol-recv': { type: 'number', value: 10 },
      'f-pol-price': { type: 'number', value: 500 },
    }
    h.listFiltered.mockResolvedValue({ ids: ['bl-1'] })

    await rematchOnBillLineChange({
      recordId: 'vendor_bill_line:bl-1',
      organizationId: 'org_1',
      userId: 'usr_1',
      field: { id: 'f-bl-qty', systemAttribute: 'vendor_bill_line_quantity_billed' },
    } as unknown as EntityFieldChangeEvent)

    expect(written('f-status')).toBe('matched')
  })

  it('ignores a line write the match does not depend on', async () => {
    await rematchOnBillLineChange({
      recordId: 'vendor_bill_line:bl-1',
      organizationId: 'org_1',
      userId: 'usr_1',
      field: { id: 'f-desc', systemAttribute: 'vendor_bill_line_description' },
    } as unknown as EntityFieldChangeEvent)

    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })
})

describe('rematchAfterBillLineDelete', () => {
  // Deletes fire no field-change hook, so without this door a removed over-billed line
  // leaves the bill in the exception queue for a reason that no longer exists.
  it('re-matches the parent named in the captured delete values', async () => {
    billIsDraft()
    h.listFiltered.mockResolvedValue({ ids: [] })

    await rematchAfterBillLineDelete({
      recordId: 'vendor_bill_line:bl-1',
      organizationId: 'org_1',
      userId: 'usr_1',
      values: { vendor_bill_line_vendor_bill: 'vendor_bill:bill-1' },
    } as unknown as EntityPostDeleteEvent)

    expect(h.setValuesForEntity).toHaveBeenCalled()
  })

  it('no-ops when the delete captured no parent', async () => {
    await rematchAfterBillLineDelete({
      recordId: 'vendor_bill_line:bl-1',
      organizationId: 'org_1',
      userId: 'usr_1',
      values: {},
    } as unknown as EntityPostDeleteEvent)

    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })
})
