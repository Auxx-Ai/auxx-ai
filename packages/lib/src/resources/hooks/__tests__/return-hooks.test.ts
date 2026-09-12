// packages/lib/src/resources/hooks/__tests__/return-hooks.test.ts
//
// The four `return` / `return_line` system hooks (plans/money/tasks/54-returns.md
// sections 3.3, 3.5 and 4.2):
//
//  1. `RMA-` allocation on `return_number` - the scope name is the whole test, because
//     a wrong scope allocates a real number off the wrong sequence and nothing errors;
//  2. the PHYSICAL lifecycle graph on `return_status`, including the two legal entry
//     points and the three terminals;
//  3. `contact` derived from `ticket` on create, keyed on `return_ticket` rather than
//     on `return_contact` so the create-from-ticket path fires at all;
//  4. the cross-return over-return guard, which is the only one of the four that can
//     silently restock parts for a unit that never shipped if it is inert.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SystemHookContext } from '../types'

const h = vi.hoisted(() => ({
  // 🔑 A SENTINEL, not a query builder. `checkReturnLineAgainstSoldLine` no longer
  // runs its own Drizzle queries - it calls `readReturnCeiling` and
  // `readReturnedQuantityClaims`, which are stubbed below - so nothing in this file
  // should reach a connection. The override stays so that an accidental query is an
  // obvious failure rather than a real one, and so the guard's "pass the ambient
  // write db through" contract can be asserted by identity.
  database: { fake: 'return-hooks test connection' } as Record<string, unknown>,
  bySystemAttributes: vi.fn(),
  getValues: vi.fn(),
  createRecordNumber: vi.fn(),
  readReturnCeiling: vi.fn(),
  readReturnedQuantityClaims: vi.fn(),
}))

// 🛑 Spread the REAL module and override only the connection. A factory mock
// that returns a hand-built `schema` replaces it for every module in the graph,
// not just this one, and the next module that reads a table this literal does
// not list (`resource-access-service.ts` reads `schema.Dataset.name` at module
// scope) dies with "Cannot read properties of undefined" before a single test runs.
vi.mock('@auxx/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/database')>()),
  database: h.database,
}))

// 🔑 Stub the SHARED READS, not a hand-built query chain. The over-return guard's
// two inputs - the ceiling and the existing claims - belong to `returns/reads.ts`,
// which owns their SQL and tests it. Faking the query shape here would re-test that
// module's plumbing through a second, always-drifting copy of it; stubbing the two
// functions leaves these tests about the GUARD: given a ceiling and a set of claims,
// does it refuse or not. Spread the real module so `returns/index.ts`'s eleven
// re-exports from this file still resolve.
vi.mock('../../../returns/reads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../returns/reads')>()),
  readReturnCeiling: h.readReturnCeiling,
  readReturnedQuantityClaims: h.readReturnedQuantityClaims,
}))

vi.mock('../../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({ bySystemAttributes: h.bySystemAttributes }),
  }),
}))

vi.mock('../../../field-values/field-value-service', () => ({
  FieldValueService: class {
    getValues = h.getValues
  },
}))

vi.mock('../../../records/record-numbering', () => ({
  recordNumbering: { create: h.createRecordNumber },
}))

const { RETURN_ENTRY_STATUSES, RETURN_HOOKS, RETURN_LINE_HOOKS, RETURN_STATUS_TRANSITIONS } =
  await import('../return-hooks')
const { OverReturnError, InvalidReturnQuantityError } = await import('../../../returns')

const NUMBER_FIELD_ID = 'fld-return-number'
const STATUS_FIELD_ID = 'fld-return-status'
const TICKET_FIELD_ID = 'fld-return-ticket'
const CONTACT_FIELD_ID = 'fld-return-contact'
const TICKET_CONTACT_FIELD_ID = 'fld-ticket-contact'

const RL_QTY_FIELD_ID = 'fld-return-line-quantity'
const RL_LINE_ITEM_FIELD_ID = 'fld-return-line-line-item'

const RETURN_DEF_ID = 'def-return'
const RETURN_LINE_DEF_ID = 'def-return-line'
const TICKET = 'defticket:instticket1'
const CONTACT = 'defcontact:instcontact1'
const LINE_ITEM_INSTANCE = 'instlineitem1'
const LINE_ITEM = `defline:${LINE_ITEM_INSTANCE}`

const allocateNumber = RETURN_HOOKS.return_number![0]!
const guardStatus = RETURN_HOOKS.return_status![0]!
const deriveContact = RETURN_HOOKS.return_ticket![0]!
const guardOverReturn = RETURN_LINE_HOOKS.return_line_quantity![0]!

beforeEach(() => {
  vi.clearAllMocks()
  h.bySystemAttributes.mockResolvedValue({})
  h.getValues.mockResolvedValue(new Map())
  h.readReturnCeiling.mockResolvedValue({ ceiling: 0, ceilingSource: 'sold' })
  h.readReturnedQuantityClaims.mockResolvedValue([])
})

type Overrides = Partial<Record<keyof SystemHookContext, unknown>>

function returnContext(fieldId: string, systemAttribute: string, overrides: Overrides = {}) {
  return {
    operation: 'create',
    entityDef: { id: RETURN_DEF_ID, entityType: 'return', apiSlug: 'returns' },
    field: { id: fieldId, systemAttribute },
    values: {},
    organizationId: 'org-1',
    userId: 'user-1',
    allFields: [
      { id: NUMBER_FIELD_ID, systemAttribute: 'return_number' },
      { id: STATUS_FIELD_ID, systemAttribute: 'return_status' },
      { id: TICKET_FIELD_ID, systemAttribute: 'return_ticket' },
      { id: CONTACT_FIELD_ID, systemAttribute: 'return_contact' },
    ],
    ...overrides,
  } as unknown as SystemHookContext
}

function returnLineContext(overrides: Overrides = {}) {
  return {
    operation: 'create',
    entityDef: { id: RETURN_LINE_DEF_ID, entityType: 'return_line', apiSlug: 'return-lines' },
    field: { id: RL_QTY_FIELD_ID, systemAttribute: 'return_line_quantity' },
    values: {},
    organizationId: 'org-1',
    userId: 'user-1',
    allFields: [
      { id: RL_QTY_FIELD_ID, systemAttribute: 'return_line_quantity' },
      { id: RL_LINE_ITEM_FIELD_ID, systemAttribute: 'return_line_line_item' },
    ],
    ...overrides,
  } as unknown as SystemHookContext
}

/**
 * The two shared reads the guard is built on: what the sold line may take back,
 * and what every other return line has already claimed against it.
 *
 * ⚠️ Named for the CEILING rather than for the sold quantity. `readReturnCeiling`
 * bounds on what SHIPPED - Σ `fulfillment_line_quantity`, cancelled dispatches
 * excluded - and falls back to the sold quantity only for a line with no
 * fulfillment lines at all. Which of the two produced the number is that
 * function's business and not this guard's.
 */
function ceilingIs(ceiling: number, claims: Array<[string, number]> = []) {
  h.readReturnCeiling.mockResolvedValue({ ceiling, ceilingSource: 'shipped' })
  h.readReturnedQuantityClaims.mockResolvedValue(
    claims.map(([returnLineId, quantity]) => ({ returnLineId, quantity }))
  )
}

/**
 * Nothing records a ceiling for the line: no dispatches and no `line_item_qty`.
 *
 * 🛑 This is NOT `ceilingIs(0)`. `readReturnCeiling` answers `null` here, and the
 * guard must pass. The two were briefly the same value, and a ceiling of zero
 * refuses every unit - so collapsing them turns the guard into a wall against
 * every line whose quantity was never recorded.
 */
function ceilingIsUnknown(claims: Array<[string, number]> = []) {
  h.readReturnCeiling.mockResolvedValue({ ceiling: null, ceilingSource: 'unknown' })
  h.readReturnedQuantityClaims.mockResolvedValue(
    claims.map(([returnLineId, quantity]) => ({ returnLineId, quantity }))
  )
}

// ─── (a) RMA- allocation ─────────────────────────────────────────────────────

describe('return_number allocation', () => {
  it('allocates off the `return` sequence scope on create', async () => {
    h.createRecordNumber.mockResolvedValue({ recordNumber: 'RMA-0001', sequenceNumber: 1 })

    const values = await allocateNumber(returnContext(NUMBER_FIELD_ID, 'return_number'))

    expect(h.createRecordNumber).toHaveBeenCalledWith('org-1', 'return')
    expect(values[NUMBER_FIELD_ID]).toBe('RMA-0001')
  })

  it('never allocates on update - the number is stable for the record’s life', async () => {
    const values = await allocateNumber(
      returnContext(NUMBER_FIELD_ID, 'return_number', { operation: 'update' })
    )

    expect(h.createRecordNumber).not.toHaveBeenCalled()
    expect(values).toEqual({})
  })
})

// ─── (b) the physical lifecycle ──────────────────────────────────────────────

describe('return_status entry points', () => {
  it.each(RETURN_ENTRY_STATUSES)('lets a return be created at %s', async (status) => {
    const values = await guardStatus(
      returnContext(STATUS_FIELD_ID, 'return_status', { values: { [STATUS_FIELD_ID]: status } })
    )

    expect(values).toEqual({ [STATUS_FIELD_ID]: status })
  })

  it.each([
    'approved',
    'in_transit',
    'inspected',
    'closed',
    'declined',
    'cancelled',
  ])('refuses a create at %s', async (status) => {
    await expect(
      guardStatus(
        returnContext(STATUS_FIELD_ID, 'return_status', { values: { return_status: status } })
      )
    ).rejects.toThrow(/starts at requested or received/)
  })

  it('ignores a create that does not name the status at all', async () => {
    const values = await guardStatus(returnContext(STATUS_FIELD_ID, 'return_status'))

    expect(values).toEqual({})
  })
})

describe('return_status transitions', () => {
  const existingInstance = { id: 'instreturn1', entityDefinitionId: RETURN_DEF_ID }

  /** The stored status the guard will read for the record under edit. */
  function currentStatusIs(status: string | null) {
    h.bySystemAttributes.mockResolvedValue({
      return_status: status === null ? null : { id: STATUS_FIELD_ID },
    })
    h.getValues.mockResolvedValue(
      new Map(status === null ? [] : [[STATUS_FIELD_ID, { type: 'option', optionId: status }]])
    )
  }

  function updateTo(next: unknown) {
    return guardStatus(
      returnContext(STATUS_FIELD_ID, 'return_status', {
        operation: 'update',
        existingInstance,
        values: { [STATUS_FIELD_ID]: next },
      })
    )
  }

  it('allows a legal step along the spine', async () => {
    currentStatusIs('approved')

    await expect(updateTo('in_transit')).resolves.toEqual({ [STATUS_FIELD_ID]: 'in_transit' })
  })

  it('allows an off-ramp to declined from requested', async () => {
    currentStatusIs('requested')

    await expect(updateTo('declined')).resolves.toBeTruthy()
  })

  it('refuses a skip over the spine', async () => {
    currentStatusIs('requested')

    await expect(updateTo('closed')).rejects.toThrow(/cannot move from requested to closed/)
  })

  it('refuses a move backwards', async () => {
    currentStatusIs('inspected')

    await expect(updateTo('received')).rejects.toThrow(/cannot move from inspected to received/)
  })

  it.each(['closed', 'declined', 'cancelled'])('treats %s as final', async (terminal) => {
    currentStatusIs(terminal)

    await expect(updateTo('requested')).rejects.toThrow(/it is a final state/)
  })

  it('allows an idempotent re-save of the same value', async () => {
    currentStatusIs('received')

    await expect(updateTo('received')).resolves.toBeTruthy()
  })

  it('unwraps a single-element array, the second shape this chain delivers', async () => {
    currentStatusIs('requested')

    await expect(updateTo(['closed'])).rejects.toThrow(/cannot move from requested to closed/)
  })

  it('fails open when the stored status cannot be read', async () => {
    currentStatusIs(null)

    await expect(updateTo('closed')).resolves.toBeTruthy()
  })

  it('leaves an update that does not touch the status alone', async () => {
    currentStatusIs('requested')

    const values = await guardStatus(
      returnContext(STATUS_FIELD_ID, 'return_status', {
        operation: 'update',
        existingInstance,
        values: { [TICKET_FIELD_ID]: TICKET },
      })
    )

    expect(values).toEqual({ [TICKET_FIELD_ID]: TICKET })
    expect(h.getValues).not.toHaveBeenCalled()
  })

  it('declares no successor for any terminal and a successor for every other state', () => {
    for (const [state, allowed] of Object.entries(RETURN_STATUS_TRANSITIONS)) {
      const terminal = ['closed', 'declined', 'cancelled'].includes(state)
      expect(allowed.length === 0).toBe(terminal)
      for (const target of allowed) expect(RETURN_STATUS_TRANSITIONS[target]).toBeDefined()
    }
  })
})

// ─── (c) contact derived from the ticket ─────────────────────────────────────

describe('contact derived from the ticket', () => {
  /** The ticket resolves, and carries a contact (or none when `contact` is null). */
  function ticketHasContact(contact: string | null) {
    h.bySystemAttributes.mockResolvedValue({ ticket_contact: { id: TICKET_CONTACT_FIELD_ID } })
    h.getValues.mockResolvedValue(
      new Map(
        contact ? [[TICKET_CONTACT_FIELD_ID, { type: 'relationship', recordId: contact }]] : []
      )
    )
  }

  it('fills the blank contact from the ticket on create', async () => {
    ticketHasContact(CONTACT)

    const values = await deriveContact(
      returnContext(TICKET_FIELD_ID, 'return_ticket', { values: { [TICKET_FIELD_ID]: TICKET } })
    )

    expect(values[CONTACT_FIELD_ID]).toBe(CONTACT)
    expect(h.getValues).toHaveBeenCalledWith({
      recordId: TICKET,
      fieldIds: [TICKET_CONTACT_FIELD_ID],
    })
  })

  it('reads a systemAttribute-keyed ticket too', async () => {
    ticketHasContact(CONTACT)

    const values = await deriveContact(
      returnContext(TICKET_FIELD_ID, 'return_ticket', { values: { return_ticket: [TICKET] } })
    )

    expect(values[CONTACT_FIELD_ID]).toBe(CONTACT)
  })

  it('leaves an explicitly supplied contact alone', async () => {
    ticketHasContact(CONTACT)
    const other = 'defcontact:instcontact2'

    const values = await deriveContact(
      returnContext(TICKET_FIELD_ID, 'return_ticket', {
        values: { [TICKET_FIELD_ID]: TICKET, [CONTACT_FIELD_ID]: other },
      })
    )

    expect(values[CONTACT_FIELD_ID]).toBe(other)
    expect(h.getValues).not.toHaveBeenCalled()
  })

  it('does nothing for a dock surprise, which names no ticket', async () => {
    ticketHasContact(CONTACT)

    const values = await deriveContact(
      returnContext(TICKET_FIELD_ID, 'return_ticket', { values: { [STATUS_FIELD_ID]: 'received' } })
    )

    expect(CONTACT_FIELD_ID in values).toBe(false)
    expect(h.getValues).not.toHaveBeenCalled()
  })

  it('does nothing when the ticket itself has no contact', async () => {
    ticketHasContact(null)

    const values = await deriveContact(
      returnContext(TICKET_FIELD_ID, 'return_ticket', { values: { [TICKET_FIELD_ID]: TICKET } })
    )

    expect(CONTACT_FIELD_ID in values).toBe(false)
  })

  it('is create-only: linking a ticket later stamps nothing', async () => {
    ticketHasContact(CONTACT)

    const values = await deriveContact(
      returnContext(TICKET_FIELD_ID, 'return_ticket', {
        operation: 'update',
        existingInstance: { id: 'instreturn1', entityDefinitionId: RETURN_DEF_ID },
        values: { [TICKET_FIELD_ID]: TICKET },
      })
    )

    expect(CONTACT_FIELD_ID in values).toBe(false)
    expect(h.getValues).not.toHaveBeenCalled()
  })

  it('never blocks the create when the ticket read fails', async () => {
    h.bySystemAttributes.mockResolvedValue({ ticket_contact: { id: TICKET_CONTACT_FIELD_ID } })
    h.getValues.mockRejectedValue(new Error('connection reset'))

    const values = await deriveContact(
      returnContext(TICKET_FIELD_ID, 'return_ticket', { values: { [TICKET_FIELD_ID]: TICKET } })
    )

    expect(values).toEqual({ [TICKET_FIELD_ID]: TICKET })
  })
})

// ─── (d) the over-return guard ───────────────────────────────────────────────

describe('over-return guard', () => {
  it('passes a return within the ceiling', async () => {
    ceilingIs(2)

    const values = await guardOverReturn(
      returnLineContext({
        values: { [RL_QTY_FIELD_ID]: 2, [RL_LINE_ITEM_FIELD_ID]: LINE_ITEM },
      })
    )

    expect(values).toEqual({ [RL_QTY_FIELD_ID]: 2, [RL_LINE_ITEM_FIELD_ID]: LINE_ITEM })
  })

  it('passes when NOTHING records a ceiling, which is not the same as a ceiling of zero', async () => {
    ceilingIsUnknown()

    const values = await guardOverReturn(
      returnLineContext({
        values: { [RL_QTY_FIELD_ID]: 99, [RL_LINE_ITEM_FIELD_ID]: LINE_ITEM },
      })
    )

    expect(values).toEqual({ [RL_QTY_FIELD_ID]: 99, [RL_LINE_ITEM_FIELD_ID]: LINE_ITEM })
  })

  it('still passes on an unknown ceiling when other returns already claim units', async () => {
    // The claims read answers, the ceiling does not. There is no bound to breach,
    // so prior claims cannot manufacture one.
    ceilingIsUnknown([['instreturnline-other', 40]])

    const values = await guardOverReturn(
      returnLineContext({
        values: { [RL_QTY_FIELD_ID]: 5, [RL_LINE_ITEM_FIELD_ID]: LINE_ITEM },
      })
    )

    expect(values).toEqual({ [RL_QTY_FIELD_ID]: 5, [RL_LINE_ITEM_FIELD_ID]: LINE_ITEM })
    // 🛑 Both halves of the read contract in one assertion: the AMBIENT WRITE DB is
    // handed down (outside a write session that is the connection, and inside one it
    // is the open transaction, which is the only way the read sees the row this write
    // has not committed yet), and the `defId:instId` RecordId is reduced to the bare
    // instance id the FieldValue join needs.
    expect(h.readReturnCeiling).toHaveBeenCalledWith(h.database, 'org-1', LINE_ITEM_INSTANCE)
  })

  it('refuses the third unit against a line of two, summed across returns', async () => {
    ceilingIs(2, [['instreturnline-other', 2]])

    await expect(
      guardOverReturn(
        returnLineContext({
          values: { [RL_QTY_FIELD_ID]: 1, [RL_LINE_ITEM_FIELD_ID]: LINE_ITEM },
        })
      )
    ).rejects.toBeInstanceOf(OverReturnError)
  })

  it('excludes the row’s own prior claim when it is edited', async () => {
    ceilingIs(2, [['instreturnline1', 2]])

    const values = await guardOverReturn(
      returnLineContext({
        operation: 'update',
        existingInstance: { id: 'instreturnline1', entityDefinitionId: RETURN_LINE_DEF_ID },
        values: { [RL_QTY_FIELD_ID]: 2, [RL_LINE_ITEM_FIELD_ID]: LINE_ITEM },
      })
    )

    expect(values[RL_QTY_FIELD_ID]).toBe(2)
  })

  it('reads the stored line item when only the quantity is written', async () => {
    h.getValues.mockResolvedValue(
      new Map([[RL_LINE_ITEM_FIELD_ID, { type: 'relationship', recordId: LINE_ITEM }]])
    )
    ceilingIs(2)

    await expect(
      guardOverReturn(
        returnLineContext({
          operation: 'update',
          existingInstance: { id: 'instreturnline1', entityDefinitionId: RETURN_LINE_DEF_ID },
          values: { [RL_QTY_FIELD_ID]: 3 },
        })
      )
    ).rejects.toBeInstanceOf(OverReturnError)
  })

  it('reads the stored quantity when only the line item is re-pointed', async () => {
    h.getValues.mockResolvedValue(new Map([[RL_QTY_FIELD_ID, { type: 'number', value: 5 }]]))
    ceilingIs(2)

    await expect(
      guardOverReturn(
        returnLineContext({
          operation: 'update',
          existingInstance: { id: 'instreturnline1', entityDefinitionId: RETURN_LINE_DEF_ID },
          values: { [RL_LINE_ITEM_FIELD_ID]: LINE_ITEM },
        })
      )
    ).rejects.toBeInstanceOf(OverReturnError)
  })

  it('refuses a non-positive quantity through the door the ceiling does not watch', async () => {
    ceilingIs(2)

    await expect(
      guardOverReturn(
        returnLineContext({
          values: { [RL_QTY_FIELD_ID]: -1, [RL_LINE_ITEM_FIELD_ID]: LINE_ITEM },
        })
      )
    ).rejects.toBeInstanceOf(InvalidReturnQuantityError)
  })

  it('bounds nothing when the row names no sold line', async () => {
    const values = await guardOverReturn(returnLineContext({ values: { [RL_QTY_FIELD_ID]: 99 } }))

    expect(values).toEqual({ [RL_QTY_FIELD_ID]: 99 })
    expect(h.readReturnCeiling).not.toHaveBeenCalled()
  })

  // ⚠️ Renamed from "bounds nothing when the sold line records no quantity", which is
  // no longer what happens. `readReturnCeiling` always answers with a NUMBER: zero when
  // the dispatches shipped nothing, and zero again when the sold fallback finds no
  // quantity either. Zero refuses every unit, which is the point of bounding on shipped
  // - a line nothing left against can have nothing come back.
  it('refuses every unit against a ceiling of zero', async () => {
    ceilingIs(0)

    await expect(
      guardOverReturn(
        returnLineContext({
          values: { [RL_QTY_FIELD_ID]: 99, [RL_LINE_ITEM_FIELD_ID]: LINE_ITEM },
        })
      )
    ).rejects.toBeInstanceOf(OverReturnError)
  })

  // The guard resolves its two fields from the write context's `allFields`, not from
  // the org cache, so an org whose `return_line` def has not been provisioned yet is
  // waved through rather than crashing on an undefined field id.
  it('bounds nothing when the org has no return_line fields yet', async () => {
    const values = await guardOverReturn(
      returnLineContext({
        allFields: [],
        values: { [RL_QTY_FIELD_ID]: 99, [RL_LINE_ITEM_FIELD_ID]: LINE_ITEM },
      })
    )

    expect(values[RL_QTY_FIELD_ID]).toBe(99)
    expect(h.readReturnCeiling).not.toHaveBeenCalled()
  })

  it('accepts a bare instance id, the shape some create paths send', async () => {
    ceilingIs(1)

    await expect(
      guardOverReturn(
        returnLineContext({
          values: { [RL_QTY_FIELD_ID]: 2, [RL_LINE_ITEM_FIELD_ID]: LINE_ITEM_INSTANCE },
        })
      )
    ).rejects.toBeInstanceOf(OverReturnError)
    expect(h.readReturnCeiling).toHaveBeenCalledWith(h.database, 'org-1', LINE_ITEM_INSTANCE)
  })

  it('is registered on the line item too, so a re-point is re-checked', () => {
    expect(RETURN_LINE_HOOKS.return_line_line_item).toEqual([guardOverReturn])
  })
})
