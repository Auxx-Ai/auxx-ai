// apps/web/src/server/api/routers/record-per-row-delete.test.ts

import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan v3/03 §5.3 (P5) — **the per-row batch asserts**.
 *
 * `record.delete` / `bulkDelete` / `merge` used to assert once per DISTINCT def
 * (`assertCanDeleteDefs`). Once rows of one def can be reachable by two routes —
 * "mine because I can see the whole def" and "mine because this row was shared
 * with me" — that question has no single right answer for a batch:
 *
 *  - a member who cannot delete the def AT ALL may hold `admin` on one row of it,
 *    and the def gate would refuse them their own row;
 *  - a member who CAN delete the def is judged by the def gate on rows they only
 *    hold `read` on.
 *
 * So the gate reads the per-row `_access` stamp instead, through the SHIPPED
 * delete rule (`canDeleteRecordAt` — the `edit` floor plus `records.delete` OR
 * rung ≥ `admin`). There is no new `deleteAt` vocabulary.
 *
 * The other half of this file is **non-enumeration**: an id the read path hid
 * does not come back from `getByIds` at all, and a row with no stamp must DENY.
 * Treating a missing row as "no opinion" would let exactly the ids the read path
 * hid through the write path.
 */

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'

/** A def the member can see and edit — the ordinary lane. */
const OPEN_DEF = 'edf_contact00000000000000000'
/** A def the member has NO def-level access to — reachable only by grant. */
const CLOSED_DEF = 'edf_deals0000000000000000000'

const ROW_A = 'ins_a000000000000000000000'
const ROW_B = 'ins_b000000000000000000000'

const { handler, cache, identity, fieldValues } = vi.hoisted(() => ({
  handler: {
    getByIds: vi.fn(async () => ({}) as Record<string, { _access?: string }>),
    delete: vi.fn(async () => undefined),
    bulkDelete: vi.fn(async () => ({ count: 1, errors: [] })),
    merge: vi.fn(async () => ({ ok: true })),
  },
  cache: {
    getCachedResources: vi.fn(async () => [] as unknown[]),
    getCachedResource: vi.fn(async () => undefined as unknown),
  },
  identity: { getRecordIdentityViews: vi.fn(async () => []) },
  fieldValues: { getDescendantIds: vi.fn(async () => []) },
}))

vi.mock('@auxx/lib/resources', () => ({
  RESOURCE_TABLE_REGISTRY: [],
  UnifiedCrudHandler: class {
    getByIds = handler.getByIds
    delete = handler.delete
    bulkDelete = handler.bulkDelete
    merge = handler.merge
  },
}))

vi.mock('@auxx/lib/cache', () => ({
  getCachedResources: cache.getCachedResources,
  getCachedResource: cache.getCachedResource,
}))
vi.mock('@auxx/lib/identity', () => ({
  getRecordIdentityViews: identity.getRecordIdentityViews,
}))
vi.mock('@auxx/lib/field-values', () => ({ getDescendantIds: fieldValues.getDescendantIds }))
vi.mock('@auxx/lib/conditions', async () => {
  const { z } = await import('zod')
  return { conditionGroupSchema: z.any() }
})

// The barrel hangs under vitest — hand back the REAL guards from their deep
// modules. Faking `isInstanceAccessKey` would make the file self-fulfilling.
vi.mock('@auxx/lib/permissions', async () => {
  const registry = await import('@auxx/lib/permissions/capabilities/registry')
  const instanceAccess = await import('@auxx/lib/permissions/capabilities/instance-access')
  return {
    PermissionKey: registry.PermissionKey,
    isInstanceAccessKey: instanceAccess.isInstanceAccessKey,
  }
})

vi.mock('~/server/api/trpc', async () => {
  const { initTRPC } = await import('@trpc/server')
  const t = initTRPC.context<Record<string, unknown>>().create()
  return {
    createTRPCRouter: t.router,
    capabilityProcedure: t.procedure,
    protectedProcedure: t.procedure,
    isAuxxError: (e: unknown): boolean =>
      typeof e === 'object' && e !== null && 'statusCode' in e && 'name' in e,
  }
})

const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { recordRouter } = await import('./record')

const FORBIDDEN = { cause: { name: 'ForbiddenError', statusCode: 403 } }

const RESOURCES = [
  { id: OPEN_DEF, entityDefinitionId: OPEN_DEF, apiSlug: 'contacts', entityType: 'contact' },
  { id: CLOSED_DEF, entityDefinitionId: CLOSED_DEF, apiSlug: 'deals', entityType: null },
]

/**
 * A real `CapabilitySet` for a MEMBER whose Records area is `level`, with an
 * explicit per-def override map so `CLOSED_DEF` can be shut while `OPEN_DEF`
 * stays open. The arithmetic under test is the shipped arithmetic.
 */
function member(level: Level, defAccess: Record<string, 'none' | 'view' | 'edit' | 'admin'> = {}) {
  const keys = new Set(expandLevelsToKeys({ [Area.records]: level }))
  return new CapabilitySet(
    keys,
    // `none` is a restriction marker and never seeds `defAccess`, so a closed def
    // is expressed by putting it in `restrictedDefIds` with NO grant entry.
    Object.fromEntries(Object.entries(defAccess).filter(([, v]) => v !== 'none')) as Record<
      string,
      never
    >,
    'USER',
    'full',
    (id) => id,
    new Set(Object.keys(defAccess)),
    (id) => id
  )
}

function caller(capabilities: unknown) {
  return recordRouter.createCaller({
    db: {},
    headers: new Headers(),
    capabilities,
    session: { organizationId: ORG_ID, userId: USER_ID, user: { id: USER_ID } },
  } as never)
}

beforeEach(() => {
  handler.getByIds.mockReset()
  handler.getByIds.mockResolvedValue({})
  handler.delete.mockReset()
  handler.bulkDelete.mockReset()
  handler.bulkDelete.mockResolvedValue({ count: 1, errors: [] })
  handler.merge.mockReset()
  handler.merge.mockResolvedValue({ ok: true })
  cache.getCachedResources.mockReset()
  cache.getCachedResources.mockResolvedValue(RESOURCES)
})

describe('§5.3 — delete is judged PER ROW, not once per def', () => {
  it('the def gate short-circuits: a Records-Full member never pays a row read', async () => {
    await caller(member(Level.Full)).delete({ recordId: `${OPEN_DEF}:${ROW_A}` })
    expect(handler.getByIds).not.toHaveBeenCalled()
    expect(handler.delete).toHaveBeenCalledTimes(1)
  })

  it('a def the member cannot delete, but holds `admin` on the ROW, is deletable', async () => {
    // Records: Full gives `records.delete`, but the def is restricted with no
    // grant — so `canDeleteEntity(CLOSED_DEF)` is false and the def gate alone
    // would refuse. The row stamp says `admin`, which passes.
    handler.getByIds.mockResolvedValue({ [`${CLOSED_DEF}:${ROW_A}`]: { _access: 'admin' } })
    await caller(member(Level.Full, { [CLOSED_DEF]: 'none' })).delete({
      recordId: `${CLOSED_DEF}:${ROW_A}`,
    })
    expect(handler.delete).toHaveBeenCalledTimes(1)
  })

  it('a row shared at `edit` is deletable ONLY by a `records.delete` holder', async () => {
    handler.getByIds.mockResolvedValue({ [`${CLOSED_DEF}:${ROW_A}`]: { _access: 'edit' } })
    // Records: Full ⇒ holds `records.delete` ⇒ yes.
    await caller(member(Level.Full, { [CLOSED_DEF]: 'none' })).delete({
      recordId: `${CLOSED_DEF}:${ROW_A}`,
    })
    expect(handler.delete).toHaveBeenCalledTimes(1)

    // Records: Edit ⇒ no `records.delete` ⇒ no. Collaboration, not destruction.
    handler.delete.mockClear()
    await expect(
      caller(member(Level.Edit, { [CLOSED_DEF]: 'none' })).delete({
        recordId: `${CLOSED_DEF}:${ROW_A}`,
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(handler.delete).not.toHaveBeenCalled()
  })

  it('a row shared at `read` is never deletable — the `edit` floor holds', async () => {
    handler.getByIds.mockResolvedValue({ [`${CLOSED_DEF}:${ROW_A}`]: { _access: 'read' } })
    await expect(
      caller(member(Level.Full, { [CLOSED_DEF]: 'none' })).delete({
        recordId: `${CLOSED_DEF}:${ROW_A}`,
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(handler.delete).not.toHaveBeenCalled()
  })

  it('a MIXED batch is judged per row, not by the def gate alone', async () => {
    // This is the case the def-batch gate got wrong: `OPEN_DEF` passes the def
    // gate, `CLOSED_DEF` does not — and its row is only deletable because the
    // STAMP says so. A per-def assert would have refused the whole batch.
    handler.getByIds.mockResolvedValue({ [`${CLOSED_DEF}:${ROW_B}`]: { _access: 'admin' } })
    await caller(member(Level.Full, { [CLOSED_DEF]: 'none' })).bulkDelete({
      recordIds: [`${OPEN_DEF}:${ROW_A}`, `${CLOSED_DEF}:${ROW_B}`],
    })
    expect(handler.bulkDelete).toHaveBeenCalledTimes(1)
    // Only the def-denied id was ever stamped — the open def costs nothing.
    expect(handler.getByIds).toHaveBeenCalledWith([`${CLOSED_DEF}:${ROW_B}`])
  })

  it('one un-deletable row fails the WHOLE batch', async () => {
    handler.getByIds.mockResolvedValue({ [`${CLOSED_DEF}:${ROW_B}`]: { _access: 'read' } })
    await expect(
      caller(member(Level.Full, { [CLOSED_DEF]: 'none' })).bulkDelete({
        recordIds: [`${OPEN_DEF}:${ROW_A}`, `${CLOSED_DEF}:${ROW_B}`],
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(handler.bulkDelete).not.toHaveBeenCalled()
  })

  it('merge gates on the same per-row rule, for the target AND every source', async () => {
    handler.getByIds.mockResolvedValue({ [`${CLOSED_DEF}:${ROW_B}`]: { _access: 'read' } })
    await expect(
      caller(member(Level.Full, { [CLOSED_DEF]: 'none' })).merge({
        targetRecordId: `${OPEN_DEF}:${ROW_A}`,
        sourceRecordIds: [`${CLOSED_DEF}:${ROW_B}`],
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(handler.merge).not.toHaveBeenCalled()
  })
})

describe('§5.2 — non-enumeration: an id the read path hid DENIES', () => {
  it('a row that does not come back from getByIds is refused, not waved through', async () => {
    // `getByIds` drops unauthorized ids SILENTLY — that is the non-enumeration
    // contract. So "absent" is the strongest denial signal there is, and the
    // write path must read it that way.
    handler.getByIds.mockResolvedValue({})
    await expect(
      caller(member(Level.Full, { [CLOSED_DEF]: 'none' })).delete({
        recordId: `${CLOSED_DEF}:${ROW_A}`,
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(handler.delete).not.toHaveBeenCalled()
  })

  it('a row that comes back WITHOUT a stamp is refused', async () => {
    // An unenforced read (`capabilities: undefined`) carries no `_access`. If one
    // ever reached this gate, "no stamp" must not read as "no objection".
    handler.getByIds.mockResolvedValue({ [`${CLOSED_DEF}:${ROW_A}`]: {} })
    await expect(
      caller(member(Level.Full, { [CLOSED_DEF]: 'none' })).delete({
        recordId: `${CLOSED_DEF}:${ROW_A}`,
      })
    ).rejects.toMatchObject(FORBIDDEN)
  })
})
