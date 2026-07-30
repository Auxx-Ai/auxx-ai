// apps/web/src/server/api/routers/record-identities-access.test.ts

import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `record.getIdentities` — the per-ROW read gate.
 *
 * 🔴 **This procedure shipped with no view authority at all.** It was a
 * `protectedProcedure` whose only guard was `assertNotInstanceAccessDefForRead`,
 * and that is a ROUTING guard — it refuses defs owned by another router, it has
 * never had an opinion about whether the caller may see a row. So any member of
 * the org could ask for the `RecordIdentity` index of any row of any def:
 * definitions they hold `none` on, rows nobody shared with them. What came back
 * was `externalId`, the app field key/label, the app name and the connection
 * label — the record's identity in every connected store.
 *
 * It is the only point read on this router that touches record-adjacent data
 * WITHOUT going through `UnifiedCrudHandler`, which is precisely why it slipped:
 * every sibling gets the visibility scope applied in SQL for free.
 *
 * Three properties, each independently breakable:
 *
 * 1. **A def-viewable row passes and pays NOTHING.** The def gate is the cheap
 *    in-memory answer for the overwhelmingly common case; if it stopped
 *    short-circuiting, every External-identities card mount would cost a row
 *    read.
 * 2. **A def-DENIED row is judged by the read path**, and a row it does not hand
 *    back is refused — the same non-enumeration contract the delete gate relies
 *    on. A grant-only row still works, which is what keeps the gate from being
 *    an outage for shared records.
 * 3. **A denial is a 403, not a 500.** The guard sits outside the procedure's
 *    `try`, whose catch flattens unknown errors to `INTERNAL_SERVER_ERROR`. A
 *    guard moved one line down turns every refusal into a 500, and a test that
 *    only asserted "didn't succeed" would not notice.
 */

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'

/** A def the member can see — the ordinary lane. */
const OPEN_DEF = 'edf_contact00000000000000000'
/** A def the member has NO def-level access to — reachable only by grant. */
const CLOSED_DEF = 'edf_deals0000000000000000000'

const ROW_A = 'ins_a000000000000000000000'

const IDENTITY_ROWS = [
  { id: 'rid_1', source: 'shopify', externalId: 'gid://shopify/Customer/1', connectionId: 'con_1' },
]

const { handler, cache, identity, fieldValues } = vi.hoisted(() => ({
  handler: {
    getByIds: vi.fn(async () => ({}) as Record<string, { _access?: string }>),
  },
  cache: {
    getCachedResources: vi.fn(async () => [] as unknown[]),
    getCachedResource: vi.fn(async () => undefined as unknown),
  },
  identity: { getRecordIdentityViews: vi.fn(async () => [] as unknown[]) },
  fieldValues: { getDescendantIds: vi.fn(async () => []) },
}))

vi.mock('@auxx/lib/resources', () => ({
  RESOURCE_TABLE_REGISTRY: [],
  UnifiedCrudHandler: class {
    getByIds = handler.getByIds
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
 * A real `CapabilitySet` for a member whose Records area is `level`, with an
 * explicit per-def override map so `CLOSED_DEF` can be shut while `OPEN_DEF`
 * stays open. Same construction as `record-per-row-delete.test.ts` — the
 * arithmetic under test is the shipped arithmetic.
 */
function member(level: Level, defAccess: Record<string, 'none' | 'view' | 'edit' | 'admin'> = {}) {
  return new CapabilitySet(
    new Set(expandLevelsToKeys({ [Area.records]: level })),
    // `none` is a restriction marker and never seeds `defAccess` — a closed def
    // is expressed by membership in `restrictedDefIds` with NO grant entry.
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
  identity.getRecordIdentityViews.mockReset()
  identity.getRecordIdentityViews.mockResolvedValue(IDENTITY_ROWS)
  cache.getCachedResources.mockReset()
  cache.getCachedResources.mockResolvedValue(RESOURCES)
})

describe('record.getIdentities — the def gate', () => {
  it('a def-viewable row passes without a row read', async () => {
    await expect(
      caller(member(Level.Read)).getIdentities({ recordId: `${OPEN_DEF}:${ROW_A}` })
    ).resolves.toEqual(IDENTITY_ROWS)
    expect(handler.getByIds).not.toHaveBeenCalled()
  })

  it('a def the member cannot see is NOT waved through', async () => {
    // The regression this file exists for: before the gate, this resolved with
    // the row's external ids for any authenticated member of the org.
    handler.getByIds.mockResolvedValue({})
    await expect(
      caller(member(Level.Full, { [CLOSED_DEF]: 'none' })).getIdentities({
        recordId: `${CLOSED_DEF}:${ROW_A}`,
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(identity.getRecordIdentityViews).not.toHaveBeenCalled()
  })
})

describe('record.getIdentities — the per-row lane', () => {
  it('a row of a closed def that WAS shared is readable', async () => {
    // `getByIds` only hands back rows the visibility scope allows, so its
    // handing this one back IS the read verdict — nothing else to judge.
    handler.getByIds.mockResolvedValue({ [`${CLOSED_DEF}:${ROW_A}`]: { _access: 'read' } })
    await expect(
      caller(member(Level.Full, { [CLOSED_DEF]: 'none' })).getIdentities({
        recordId: `${CLOSED_DEF}:${ROW_A}`,
      })
    ).resolves.toEqual(IDENTITY_ROWS)
    expect(handler.getByIds).toHaveBeenCalledWith([`${CLOSED_DEF}:${ROW_A}`])
  })

  it('a row the read path hid is refused, not waved through', async () => {
    // Non-enumeration: unauthorized ids are dropped SILENTLY, so "absent" is the
    // strongest denial signal there is.
    handler.getByIds.mockResolvedValue({})
    await expect(
      caller(member(Level.Full, { [CLOSED_DEF]: 'none' })).getIdentities({
        recordId: `${CLOSED_DEF}:${ROW_A}`,
      })
    ).rejects.toMatchObject(FORBIDDEN)
  })

  it('the denial is a 403 — the guard is outside the try that flattens to 500', async () => {
    handler.getByIds.mockResolvedValue({})
    await expect(
      caller(member(Level.Full, { [CLOSED_DEF]: 'none' })).getIdentities({
        recordId: `${CLOSED_DEF}:${ROW_A}`,
      })
    ).rejects.toMatchObject({ cause: { statusCode: 403 } })
  })
})
