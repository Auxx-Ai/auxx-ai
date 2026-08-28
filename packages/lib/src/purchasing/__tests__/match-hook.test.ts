// packages/lib/src/purchasing/__tests__/match-hook.test.ts
//
// `matchBill` was written and tested to exhaustion and then nothing called it, so
// `vendor_bill_status`, `_match_variance` and `_match_notes` — all three declared
// `creatable: false` with "the three-way match hook is the only writer" — stayed empty
// and the exception queue rendered stored values that were never stored. These tests pin
// the wiring rather than the math.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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
/**
 * The bill LINES and their PO lines are read set-based now, not with a
 * `getFieldValues` per line — so that half of every fixture arrives as
 * `FieldValue` rows. `recordValues` still feeds both: {@link rowsFromRecordValues}
 * flattens it, and every consumer looks its record up by instance id, so handing
 * each query the whole set is equivalent to filtering it.
 */
vi.mock('@auxx/database', async () => {
  const schema = await import('../../../../database/src/db/schema/index')
  return {
    schema,
    database: {
      select: () => ({ from: () => ({ where: () => rowsFromRecordValues() }) }),
    },
  }
})

import { runWithDirtyParents } from '../../reconcilers/dirty-parents'
import {
  BILL_LINE_MATCH_TRIGGER_ATTRS,
  BILL_MATCH_TRIGGER_ATTRS,
  rematchAfterBillLineDelete,
  rematchBill,
  rematchOnBillLineChange,
} from '../match-hook'
import { registerMatchReconcilers } from '../match-reconciler'

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

/** `recordValues` as `FieldValue` rows, for the set-based reads. */
function rowsFromRecordValues() {
  const rows: Array<Record<string, unknown>> = []
  for (const [recordId, values] of Object.entries(recordValues)) {
    const entityId = recordId.split(':')[1]
    for (const [fieldId, typed] of Object.entries(values)) {
      const v = typed as { type: string; value?: unknown; optionId?: string; recordId?: string }
      const row: Record<string, unknown> = { entityId, fieldId }
      if (v.type === 'number') row.valueNumber = v.value
      else if (v.type === 'boolean') row.valueBoolean = v.value
      else if (v.type === 'option') row.optionId = v.optionId
      else if (v.type === 'relationship') row.relatedEntityId = v.recordId?.split(':')[1]
      else row.valueText = v.value
      rows.push(row)
    }
  }
  return rows
}

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
    // Billed 5, received 2. Reading `received` off the BILL line would find the
    // billed 5 there and call this matched.
    line('bl-1', 'pol-1', 5, 100, 2, 100)

    await rematch()

    expect(written('f-status')).toBe('exception')
    expect(written('f-variance')).toBe(300)
  })

  it('reads the expected unit price from the PO LINE, not from the bill line', async () => {
    billIsDraft()
    h.listFiltered.mockResolvedValue({ ids: ['bl-1'] })
    // Billed at 1500, the PO expected 100 — past both arms of
    // `DEFAULT_MATCH_TOLERANCE` (2% and 500 minor units). Reading `expected` off
    // the bill line would compare 1500 against itself and call this matched.
    line('bl-1', 'pol-1', 5, 1500, 5, 100)

    await rematch()

    expect(written('f-status')).toBe('exception')
    expect(written('f-variance')).toBe(7000)
  })

  it('skips the write when the bill already carries this verdict', async () => {
    recordValues['vendor_bill:bill-1'] = {
      'f-status': { type: 'option', optionId: 'matched' },
      'f-variance': { type: 'number', value: 0 },
    }
    h.listFiltered.mockResolvedValue({ ids: ['bl-1'] })
    line('bl-1', 'pol-1', 10, 500, 10, 500)

    await rematch()

    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })

  it('writes when the stored verdict differs by any one field', async () => {
    recordValues['vendor_bill:bill-1'] = {
      'f-status': { type: 'option', optionId: 'matched' },
      'f-variance': { type: 'number', value: 1 },
    }
    h.listFiltered.mockResolvedValue({ ids: ['bl-1'] })
    line('bl-1', 'pol-1', 10, 500, 10, 500)

    await rematch()

    expect(h.setValuesForEntity).toHaveBeenCalledTimes(1)
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

describe('coalescing (plan 08 phase 2)', () => {
  beforeAll(() => {
    registerMatchReconcilers()
  })

  /** A bill line that knows its parent, for the batched resolver. */
  function lineOnBill(id: string, poLineId: string) {
    line(id, poLineId, 10, 500, 10, 500)
    Object.assign(recordValues[`vendor_bill_line:${id}`]!, {
      'f-bl-bill': { type: 'relationship', recordId: 'vendor_bill:bill-1' },
    })
  }

  const lineEvent = (id: string, systemAttribute: string) =>
    ({
      recordId: `vendor_bill_line:${id}`,
      organizationId: 'org_1',
      userId: 'usr_1',
      field: { id: 'f', systemAttribute, type: 'NUMBER' },
    }) as unknown as EntityFieldChangeEvent

  /** One `listFiltered` per `rematchBill`, so this counts matches. */
  const matches = () => h.listFiltered.mock.calls.length

  it('collapses 30 line fires on one bill into ONE match', async () => {
    billIsDraft()
    const ids = Array.from({ length: 10 }, (_, i) => `bl-${i}`)
    for (const [i, id] of ids.entries()) lineOnBill(id, `pol-${i}`)
    h.listFiltered.mockResolvedValue({ ids })

    await runWithDirtyParents('org_1', 'usr_1', async () => {
      for (const id of ids) {
        // The three attributes one line write moves.
        await rematchOnBillLineChange(lineEvent(id, 'vendor_bill_line_quantity_billed'))
        await rematchOnBillLineChange(lineEvent(id, 'vendor_bill_line_unit_price'))
        await rematchOnBillLineChange(lineEvent(id, 'vendor_bill_line_purchase_order_line'))
      }
    })

    expect(matches()).toBe(1)
  })

  it('matches inline when no write method opened a scope', async () => {
    billIsDraft()
    lineOnBill('bl-1', 'pol-1')
    h.listFiltered.mockResolvedValue({ ids: ['bl-1'] })

    await rematchOnBillLineChange(lineEvent('bl-1', 'vendor_bill_line_quantity_billed'))

    expect(matches()).toBe(1)
  })

  it('matches nothing for an orphaned line', async () => {
    billIsDraft()
    line('bl-1', 'pol-1', 10, 500, 10, 500) // no `f-bl-bill`
    h.listFiltered.mockResolvedValue({ ids: ['bl-1'] })

    await runWithDirtyParents('org_1', 'usr_1', async () => {
      await rematchOnBillLineChange(lineEvent('bl-1', 'vendor_bill_line_quantity_billed'))
    })

    expect(matches()).toBe(0)
  })

  it('ignores an attribute outside the trigger set', async () => {
    await runWithDirtyParents('org_1', 'usr_1', async () => {
      await rematchOnBillLineChange(lineEvent('bl-1', 'vendor_bill_line_description'))
    })

    expect(matches()).toBe(0)
  })
})
