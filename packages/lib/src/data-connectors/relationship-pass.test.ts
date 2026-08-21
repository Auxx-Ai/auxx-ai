// packages/lib/src/data-connectors/relationship-pass.test.ts
// The relationship two-pass, with its `./service` reads/writes and the write-key
// resolver mocked (Drizzle column refs are undefined under vitest — project memory),
// so only the pass's decision logic is exercised.
//
// The cases that matter are the idempotency guard's (v10 relationship-pass-idempotency,
// Phase 2): an edge that already points where it should must produce NO `crud.update`,
// NO event, and NO `touchedDefs` entry — while every other shape still writes exactly
// as it did before. The guard is an optimization, so every uncertain input must fall
// through to the write.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSyncCtx } from './__test-helpers'
import type { DataConnectorItemRow, PendingRelation } from './service'
import type { SyncCtx } from './sinks/types'

const h = vi.hoisted(() => ({
  listItems: vi.fn(),
  findItemByDef: vi.fn(),
  readTargets: vi.fn(),
  setRelationState: vi.fn(async () => {}),
  buildWriteKeyToFieldId: vi.fn(),
  // Params mirror `UnifiedCrudHandler.update` so `mock.calls[n]` destructures as the
  // real tuple instead of an empty one.
  update: vi.fn(
    async (
      _recordId: string,
      _values: Record<string, unknown>,
      _modes?: Record<string, 'set' | 'add' | 'remove'>,
      _options?: Record<string, unknown>
    ) => ({})
  ),
}))

// Partial-mock: `./service` is shared and fully replacing it dies at collection.
vi.mock('./service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./service')>()),
  listItemsWithPendingRelations: h.listItems,
  findItemByDef: h.findItemByDef,
  readRelationshipTargets: h.readTargets,
  setItemRelationState: h.setRelationState,
}))
vi.mock('./field-id-resolver', () => ({ buildWriteKeyToFieldId: h.buildWriteKeyToFieldId }))

import { resolveRelationships } from './relationship-pass'

const ORG = 'org_1'
const ORDER_DEF = 'def_order'
const CONTACT_DEF = 'def_contact'
const ORDER_INSTANCE = 'inst_order_1'
const CONTACT_INSTANCE = 'inst_contact_1'
/** The concrete `CustomField.id` behind the `customer` write-key. */
const CUSTOMER_FIELD_ID = 'fld_customer'

const setEdge = (fieldKey = 'customer'): PendingRelation => ({
  fieldKey,
  targetDef: CONTACT_DEF,
  targetExternalId: 'ext_c1',
})
const clearEdge = (fieldKey = 'customer'): PendingRelation => ({
  fieldKey,
  targetDef: null,
  targetExternalId: null,
})

function item(pending: PendingRelation[], linked: string[] = []): DataConnectorItemRow {
  return {
    id: 'item_1',
    entityInstanceId: ORDER_INSTANCE,
    entityDefinitionId: ORDER_DEF,
    pendingRelations: pending,
    linkedRelations: linked.length > 0 ? linked : null,
  } as unknown as DataConnectorItemRow
}

/**
 * A ctx whose `relationshipCrud.update` is the spy every case asserts on — the
 * pass writes through the inline-lane handler (events on), never `ctx.crud`
 * (silent sync session).
 */
function ctx(): SyncCtx {
  return makeSyncCtx({
    orgId: ORG,
    relationshipCrud: { update: h.update } as unknown as SyncCtx['relationshipCrud'],
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.setRelationState.mockResolvedValue(undefined)
  h.update.mockResolvedValue({})
  h.buildWriteKeyToFieldId.mockResolvedValue(new Map([['customer', CUSTOMER_FIELD_ID]]))
  h.findItemByDef.mockResolvedValue({
    entityInstanceId: CONTACT_INSTANCE,
    entityDefinitionId: CONTACT_DEF,
  })
  h.readTargets.mockResolvedValue(new Map<string, string>())
})

describe('resolveRelationships — idempotency guard', () => {
  it('writes nothing when the edge already points at the resolved target', async () => {
    h.listItems.mockResolvedValue([item([setEdge()])])
    h.readTargets.mockResolvedValue(
      new Map([[`${ORDER_INSTANCE}::${CUSTOMER_FIELD_ID}`, CONTACT_INSTANCE]])
    )
    const c = ctx()

    await resolveRelationships(c)

    expect(h.update).not.toHaveBeenCalled()
    // The pending entry is still consumed, and the field stays recorded as linked.
    expect(h.setRelationState).toHaveBeenCalledWith(expect.anything(), 'item_1', {
      pendingRelations: [],
      linkedRelations: ['customer'],
    })
    // Nothing moved on this def — a no-op must not force a records:invalidated refetch.
    expect([...c.touchedDefs]).toEqual([])
    expect(c.counters.relationshipWarnings).toBe(0)
  })

  it('leaves `linkedRelations` untouched when the edge was already recorded as linked', async () => {
    h.listItems.mockResolvedValue([item([setEdge()], ['customer'])])
    h.readTargets.mockResolvedValue(
      new Map([[`${ORDER_INSTANCE}::${CUSTOMER_FIELD_ID}`, CONTACT_INSTANCE]])
    )

    await resolveRelationships(ctx())

    expect(h.update).not.toHaveBeenCalled()
    // `linkedChanged` stayed false, but the pending list shrank, so state is persisted.
    expect(h.setRelationState).toHaveBeenCalledWith(expect.anything(), 'item_1', {
      pendingRelations: [],
      linkedRelations: ['customer'],
    })
  })

  it('writes when the edge points at a DIFFERENT target, without suppressing events', async () => {
    h.listItems.mockResolvedValue([item([setEdge()], ['customer'])])
    h.readTargets.mockResolvedValue(
      new Map([[`${ORDER_INSTANCE}::${CUSTOMER_FIELD_ID}`, 'inst_contact_OLD']])
    )
    const c = ctx()

    await resolveRelationships(c)

    expect(h.update).toHaveBeenCalledTimes(1)
    expect(h.update).toHaveBeenCalledWith(
      `${ORDER_DEF}:${ORDER_INSTANCE}`,
      { customer: `${CONTACT_DEF}:${CONTACT_INSTANCE}` },
      undefined,
      {}
    )
    // A genuine edge change must keep firing entity:field:updated, the activity touch,
    // and record rules — the options object carries no `skipEvents`.
    expect(h.update.mock.calls[0]![3]).not.toHaveProperty('skipEvents')
    expect([...c.touchedDefs]).toEqual([ORDER_DEF])
  })

  it('writes on first resolution — the field currently has no row', async () => {
    h.listItems.mockResolvedValue([item([setEdge()])])
    h.readTargets.mockResolvedValue(new Map<string, string>())

    await resolveRelationships(ctx())

    expect(h.update).toHaveBeenCalledTimes(1)
  })

  it('writes when the cell holds two rows — a collapse is a real change', async () => {
    // `readRelationshipTargets` reports a multi-row cell as ABSENT (a `set` would
    // legitimately reduce it to one), so the guard must fall through to the write.
    h.listItems.mockResolvedValue([item([setEdge()])])
    h.readTargets.mockResolvedValue(new Map<string, string>())

    await resolveRelationships(ctx())

    expect(h.update).toHaveBeenCalledTimes(1)
  })

  it('writes when the fieldKey does not resolve to a concrete field id', async () => {
    // Fallback ref form (bare app key / stale cache): the guard is disabled rather
    // than silently dropping the edge.
    h.buildWriteKeyToFieldId.mockResolvedValue(new Map())
    h.listItems.mockResolvedValue([item([setEdge()])])
    // Even a map that WOULD match must not be consulted for an unresolved key.
    h.readTargets.mockResolvedValue(
      new Map([[`${ORDER_INSTANCE}::${CUSTOMER_FIELD_ID}`, CONTACT_INSTANCE]])
    )

    await resolveRelationships(ctx())

    expect(h.update).toHaveBeenCalledTimes(1)
  })

  it('does not read targets at all when every pending edge is a clear', async () => {
    h.listItems.mockResolvedValue([item([clearEdge()], ['customer'])])

    await resolveRelationships(ctx())

    // No pairs collected ⇒ the bulk read short-circuits on an empty list.
    expect(h.readTargets).toHaveBeenCalledWith(expect.anything(), ORG, [])
  })

  it('resolves the write-key map once per def across many items', async () => {
    h.listItems.mockResolvedValue([
      item([setEdge()]),
      { ...item([setEdge()]), id: 'item_2', entityInstanceId: 'inst_order_2' },
    ])

    await resolveRelationships(ctx())

    expect(h.buildWriteKeyToFieldId).toHaveBeenCalledTimes(1)
    expect(h.buildWriteKeyToFieldId).toHaveBeenCalledWith(ORG, ORDER_DEF)
  })
})

describe('resolveRelationships — unchanged behavior', () => {
  it('applies a CLEAR exactly once and shrinks `linkedRelations`', async () => {
    h.listItems.mockResolvedValue([item([clearEdge()], ['customer'])])
    const c = ctx()

    await resolveRelationships(c)

    expect(h.update).toHaveBeenCalledTimes(1)
    expect(h.update).toHaveBeenCalledWith(
      `${ORDER_DEF}:${ORDER_INSTANCE}`,
      { customer: null },
      undefined,
      {}
    )
    expect(h.setRelationState).toHaveBeenCalledWith(expect.anything(), 'item_1', {
      pendingRelations: [],
      linkedRelations: [],
    })
    expect([...c.touchedDefs]).toEqual([ORDER_DEF])
  })

  it('defers an unsynced target and counts a relationship warning', async () => {
    h.findItemByDef.mockResolvedValue(null)
    h.listItems.mockResolvedValue([item([setEdge()])])
    const c = ctx()

    await resolveRelationships(c)

    expect(h.update).not.toHaveBeenCalled()
    expect(c.counters.relationshipWarnings).toBe(1)
    // Nothing resolved and nothing linked ⇒ no state write at all.
    expect(h.setRelationState).not.toHaveBeenCalled()
  })

  it('keeps a failed write pending and counts a warning', async () => {
    h.update.mockRejectedValue(new Error('boom'))
    h.listItems.mockResolvedValue([item([setEdge()])])
    const c = ctx()

    await resolveRelationships(c)

    expect(c.counters.relationshipWarnings).toBe(1)
    expect(h.setRelationState).not.toHaveBeenCalled()
  })

  it('skips items with no bound instance', async () => {
    h.listItems.mockResolvedValue([{ ...item([setEdge()]), entityInstanceId: null }])

    await resolveRelationships(ctx())

    expect(h.update).not.toHaveBeenCalled()
    expect(h.readTargets).toHaveBeenCalledWith(expect.anything(), ORG, [])
  })
})
