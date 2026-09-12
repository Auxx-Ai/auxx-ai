// packages/lib/src/field-hooks/pre/return-line-over-return-guard.test.ts
//
// 🛑 The bug this file exists to prevent is a guard that cannot fire. `fireFieldPreHooks`
// runs AFTER `validateAndConvertValue`, so a RELATIONSHIP write arrives as
// `{ type: 'relationship', recordId: 'defId:instId' }` and a NUMBER as
// `{ type: 'number', value: 3 }` - never the bare id or the bare number a hand-written
// fixture would use. A guard reading those directly bounds nothing, reads correctly in
// review, and passes any unit test that feeds it raw values
// (plans/dispatch/money/21-lifecycle-status-guards-are-inert.md section 2). So the cases
// below feed the COERCED envelopes, and the raw shapes some create paths still send are
// pinned separately.
//
// The two ceiling reads are stubbed at `returns/reads.ts`, which owns their SQL and tests
// it. That leaves these tests about the GUARD: which two numbers it assembles, from where,
// and which connection it reads them on.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FieldPreHookEvent } from '../types'

const h = vi.hoisted(() => ({
  // A sentinel, not a connection: every query this guard causes is stubbed, and the
  // identity is what proves the ambient write db is handed down rather than re-derived.
  database: { fake: 'over-return guard test connection' } as Record<string, unknown>,
  bySystemAttributes: vi.fn(),
  getValues: vi.fn(),
  readReturnCeiling: vi.fn(),
  readReturnedQuantityClaims: vi.fn(),
}))

// Spread the REAL module and override only the connection: a factory mock returning a
// hand-built `schema` replaces it for every module in the graph, and the next one to read
// a table the literal does not list dies before a single test runs.
vi.mock('@auxx/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/database')>()),
  database: h.database,
}))

vi.mock('../../returns/reads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../returns/reads')>()),
  readReturnCeiling: h.readReturnCeiling,
  readReturnedQuantityClaims: h.readReturnedQuantityClaims,
}))

vi.mock('../../cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../cache')>()),
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
}))

vi.mock('../../field-values/field-value-service', () => ({
  FieldValueService: class {
    getValues = h.getValues
  },
}))

const { guardReturnLineOverReturn } = await import('./return-line-over-return-guard')
const { InvalidReturnQuantityError, OverReturnError } = await import('../../returns')

const QTY_FIELD_ID = 'fld-return-line-quantity'
const LINE_ITEM_FIELD_ID = 'fld-return-line-line-item'
const RETURN_LINE_INSTANCE = 'instreturnline1'
const RECORD_ID = `defreturnline:${RETURN_LINE_INSTANCE}`
const LINE_ITEM_INSTANCE = 'instlineitem1'
const LINE_ITEM = `defline:${LINE_ITEM_INSTANCE}`

beforeEach(() => {
  vi.clearAllMocks()
  h.bySystemAttributes.mockResolvedValue({
    return_line_quantity: { id: QTY_FIELD_ID },
    return_line_line_item: { id: LINE_ITEM_FIELD_ID },
  })
  h.getValues.mockResolvedValue(new Map())
  h.readReturnCeiling.mockResolvedValue({ ceiling: 0, ceilingSource: 'sold' })
  h.readReturnedQuantityClaims.mockResolvedValue([])
})

/** What the sold line may take back, and what other rows have already claimed. */
function ceilingIs(ceiling: number, claims: Array<[string, number]> = []) {
  h.readReturnCeiling.mockResolvedValue({ ceiling, ceilingSource: 'shipped' })
  h.readReturnedQuantityClaims.mockResolvedValue(
    claims.map(([returnLineId, quantity]) => ({ returnLineId, quantity }))
  )
}

/** What the return line already holds for the half this write does not name. */
function storedRow(row: { quantity?: number; lineItemRecordId?: string }) {
  const entries: Array<[string, unknown]> = []
  if (row.quantity !== undefined)
    entries.push([QTY_FIELD_ID, { type: 'number', value: row.quantity }])
  if (row.lineItemRecordId !== undefined) {
    entries.push([LINE_ITEM_FIELD_ID, { type: 'relationship', recordId: row.lineItemRecordId }])
  }
  h.getValues.mockResolvedValue(new Map(entries))
}

function event(
  systemAttribute: 'return_line_quantity' | 'return_line_line_item',
  newValue: unknown,
  allValues: Array<[string, unknown]> = []
): FieldPreHookEvent {
  const fieldId = systemAttribute === 'return_line_quantity' ? QTY_FIELD_ID : LINE_ITEM_FIELD_ID
  return {
    recordId: RECORD_ID,
    entityDefinitionId: 'defreturnline',
    entityType: 'return_line',
    entitySlug: 'return-lines',
    fieldId,
    systemAttribute,
    field: { id: fieldId, systemAttribute },
    newValue,
    existingValue: undefined,
    allValues: new Map<string, unknown>([[fieldId, newValue], ...allValues]),
    organizationId: 'org-1',
    userId: 'user-1',
    bypass: new Set(),
  } as unknown as FieldPreHookEvent
}

/** The shapes `validateAndConvertValue` hands this chain. */
const coercedNumber = (value: number) => ({ type: 'number', value })
const coercedRelation = (recordId: string) => ({ type: 'relationship', recordId })

describe('over-return ceiling, on the coerced shapes', () => {
  it('passes a quantity within the ceiling', async () => {
    ceilingIs(2)
    storedRow({ lineItemRecordId: LINE_ITEM })
    const next = coercedNumber(2)

    await expect(guardReturnLineOverReturn(event('return_line_quantity', next))).resolves.toBe(next)
    // 🛑 Both halves of the read contract: the AMBIENT WRITE DB is handed down (outside
    // a write session that is the pooled connection, inside one the open transaction,
    // which is the only way the read sees rows this write has not committed), and the
    // `defId:instId` RecordId is reduced to the bare instance id the join needs.
    expect(h.readReturnCeiling).toHaveBeenCalledWith(h.database, 'org-1', LINE_ITEM_INSTANCE)
  })

  // 🛑 The case the guard exists for, in the shape the drawer actually produces: a
  // quantity raised past what the line shipped. A guard comparing the envelope to a
  // number would wave this through.
  it('refuses a coerced quantity that breaches the ceiling', async () => {
    ceilingIs(2)
    storedRow({ lineItemRecordId: LINE_ITEM })

    await expect(
      guardReturnLineOverReturn(event('return_line_quantity', coercedNumber(3)))
    ).rejects.toBeInstanceOf(OverReturnError)
  })

  // The other coerced envelope: re-pointing the row at a different sold line, with the
  // quantity read off storage.
  it('refuses a coerced re-point onto a line with no room left', async () => {
    ceilingIs(2)
    storedRow({ quantity: 5 })

    await expect(
      guardReturnLineOverReturn(event('return_line_line_item', coercedRelation(LINE_ITEM)))
    ).rejects.toBeInstanceOf(OverReturnError)
    expect(h.readReturnCeiling).toHaveBeenCalledWith(h.database, 'org-1', LINE_ITEM_INSTANCE)
  })

  it('sums across returns, not just this row', async () => {
    ceilingIs(2, [['instreturnline-other', 2]])
    storedRow({ lineItemRecordId: LINE_ITEM })

    await expect(
      guardReturnLineOverReturn(event('return_line_quantity', coercedNumber(1)))
    ).rejects.toBeInstanceOf(OverReturnError)
  })

  // 🛑 Load-bearing on a create as much as on an edit: by the time the second of the two
  // fields is written the row's own claim is already stored, so without the exclusion a
  // row of 2 against a ceiling of 2 refuses itself.
  it('excludes the row’s own prior claim', async () => {
    ceilingIs(2, [[RETURN_LINE_INSTANCE, 2]])
    storedRow({ lineItemRecordId: LINE_ITEM })

    await expect(
      guardReturnLineOverReturn(event('return_line_quantity', coercedNumber(2)))
    ).resolves.toBeTruthy()
  })

  it('refuses a non-positive quantity through the door the ceiling does not watch', async () => {
    ceilingIs(2)
    storedRow({ lineItemRecordId: LINE_ITEM })

    await expect(
      guardReturnLineOverReturn(event('return_line_quantity', coercedNumber(-1)))
    ).rejects.toBeInstanceOf(InvalidReturnQuantityError)
  })

  it('refuses every unit against a ceiling of zero', async () => {
    ceilingIs(0)
    storedRow({ lineItemRecordId: LINE_ITEM })

    await expect(
      guardReturnLineOverReturn(event('return_line_quantity', coercedNumber(1)))
    ).rejects.toBeInstanceOf(OverReturnError)
  })
})

describe('assembling the pair', () => {
  // The bulk path sends both fields in one request, and `allValues` carries the other
  // half pre-coercion. Reading storage there would measure against the value being
  // replaced in the same write.
  it('takes the other half from this same write when the caller sent both', async () => {
    ceilingIs(2)

    await expect(
      guardReturnLineOverReturn(
        event('return_line_quantity', coercedNumber(3), [[LINE_ITEM_FIELD_ID, LINE_ITEM]])
      )
    ).rejects.toBeInstanceOf(OverReturnError)
    expect(h.getValues).not.toHaveBeenCalled()
  })

  it('accepts a bare instance id, the shape some create paths send', async () => {
    ceilingIs(1)

    await expect(
      guardReturnLineOverReturn(
        event('return_line_quantity', 2, [[LINE_ITEM_FIELD_ID, LINE_ITEM_INSTANCE]])
      )
    ).rejects.toBeInstanceOf(OverReturnError)
    expect(h.readReturnCeiling).toHaveBeenCalledWith(h.database, 'org-1', LINE_ITEM_INSTANCE)
  })

  it('reads the stored line item when only the quantity is written', async () => {
    ceilingIs(2)
    storedRow({ lineItemRecordId: LINE_ITEM })

    await expect(
      guardReturnLineOverReturn(event('return_line_quantity', coercedNumber(3)))
    ).rejects.toBeInstanceOf(OverReturnError)
    expect(h.getValues).toHaveBeenCalledWith({
      recordId: RECORD_ID,
      fieldIds: [QTY_FIELD_ID, LINE_ITEM_FIELD_ID],
    })
  })
})

describe('bounding nothing', () => {
  it('bounds nothing when the row names no sold line', async () => {
    ceilingIs(2)
    storedRow({})

    const next = coercedNumber(99)
    await expect(guardReturnLineOverReturn(event('return_line_quantity', next))).resolves.toBe(next)
    expect(h.readReturnCeiling).not.toHaveBeenCalled()
  })

  it('bounds nothing when the sold line is being cleared', async () => {
    ceilingIs(2)
    storedRow({ quantity: 5 })

    await expect(
      guardReturnLineOverReturn(event('return_line_line_item', null))
    ).resolves.toBeNull()
    expect(h.readReturnCeiling).not.toHaveBeenCalled()
  })

  it('bounds nothing when the org has no return_line fields yet', async () => {
    h.bySystemAttributes.mockResolvedValue({})
    ceilingIs(2)

    await expect(
      guardReturnLineOverReturn(event('return_line_quantity', coercedNumber(99)))
    ).resolves.toBeTruthy()
    expect(h.readReturnCeiling).not.toHaveBeenCalled()
    expect(h.getValues).not.toHaveBeenCalled()
  })
})
