// apps/web/src/server/api/routers/record-instance-access-closure.test.ts

import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 36 §3 — the generic-record-path closure, behaviorally.
 *
 * This is the most important file in the signature slice. Minting `signature.ts`
 * closed nothing on its own: signatures are `EntityInstance` rows on the
 * `signature` def, so before this every member could enumerate, read, mutate and
 * delete every signature in the org through generic `record.*` CRUD — whose only
 * asserts are three `recordsDelete` calls, and whose def-level gate
 * (`canViewEntity('signature')`) returned `true` unconditionally via
 * `isMailInfraDef`. `assertNotInstanceAccessDef` is what actually shuts that door,
 * and it is wired into all 17 procedures.
 *
 * Four properties, each independently breakable:
 *
 * 1. **Every one of the 17 procedures refuses the `signature` def**, whichever of
 *    the three identifier forms the client sends (bare slug, def UUID, apiSlug) —
 *    the slug short-circuits, the other two resolve through the org resources
 *    cache. A procedure that lost its call would still pass a slug-only test if
 *    it happened to route the UUID form, so both are exercised.
 * 2. **It denies OWNER too.** "One access authority per resource" is a routing
 *    invariant, not a permission — an OWNER who reached a signature here would be
 *    bypassing `signature.ts`'s `ResourceAccess` bookkeeping, not exercising a
 *    privilege.
 * 3. **The guard sits OUTSIDE each `try`.** Those catch blocks flatten unknown
 *    errors to `INTERNAL_SERVER_ERROR`, so a guard moved one line down turns
 *    every 403 into a 500 — a denial test that only checked "didn't succeed"
 *    would not notice. Every case asserts the status code.
 * 4. **The unscoped global-search union is filtered.** A scoped search is refused
 *    by (1), but the union takes no def scope at all and post-filters on
 *    `canViewEntity(defId)` — which, now that `signature` has left
 *    `NON_RECORD_DEF_SLUGS`, returns `true` for any member with a records rung.
 *    Without the filter, signature names leak into cmd+K.
 *
 * The negative control is as load-bearing as the denials: an ordinary def
 * (`contact`) must still pass through untouched, or the "closure" is just an
 * outage.
 */

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'

/** The `signature` def as the org resources cache describes it. */
const SIGNATURE_DEF_UUID = 'edf_signature0000000000000000'
const SIGNATURE_API_SLUG = 'signatures'
const SIGNATURE_ID = 'sig_cuid0000000000000000000'

/** An ordinary records def — the negative control. */
const CONTACT_DEF_UUID = 'edf_contact00000000000000000'
const CONTACT_ID = 'cnt_cuid0000000000000000000'

const { handler, cache, identity, fieldValues } = vi.hoisted(() => ({
  handler: {
    getById: vi.fn(async () => ({ recordId: 'x' })),
    getByIds: vi.fn(async () => []),
    search: vi.fn(async () => ({ items: [], nextCursor: null })),
    lookupByField: vi.fn(async () => ({ matches: [] })),
    listFiltered: vi.fn(async () => ({ items: [], total: 0 })),
    listAll: vi.fn(async () => ({ items: [] })),
    create: vi.fn(async () => ({ instance: { id: 'new' } })),
    createMany: vi.fn(async () => ({ created: 1 })),
    update: vi.fn(async () => ({ instance: { id: 'x' } })),
    archive: vi.fn(async () => ({ ok: true })),
    restore: vi.fn(async () => ({ ok: true })),
    delete: vi.fn(async () => undefined),
    bulkArchive: vi.fn(async () => ({ count: 1 })),
    bulkDelete: vi.fn(async () => ({ count: 1, errors: [] })),
    merge: vi.fn(async () => ({ ok: true })),
    invalidateCache: vi.fn(async () => undefined),
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
    getById = handler.getById
    getByIds = handler.getByIds
    search = handler.search
    lookupByField = handler.lookupByField
    listFiltered = handler.listFiltered
    listAll = handler.listAll
    create = handler.create
    createMany = handler.createMany
    update = handler.update
    archive = handler.archive
    restore = handler.restore
    delete = handler.delete
    bulkArchive = handler.bulkArchive
    bulkDelete = handler.bulkDelete
    merge = handler.merge
    invalidateCache = handler.invalidateCache
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

// The `@auxx/lib/permissions` barrel hangs under vitest — hand back the REAL
// `isInstanceAccessKey` and `PermissionKey` from their deep modules. Faking
// `isInstanceAccessKey` here would make the whole file self-fulfilling.
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
    // Duck-typed exactly as the real one is (`instanceof` fails across the
    // `@auxx/lib` transpile boundary) — the record router's catch blocks use it
    // to decide whether an error keeps its status.
    isAuxxError: (e: unknown): boolean =>
      typeof e === 'object' && e !== null && 'statusCode' in e && 'name' in e,
  }
})

const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { recordRouter } = await import('./record')

const FORBIDDEN = { cause: { name: 'ForbiddenError', statusCode: 403 } }

/** Every resource the org cache knows about. */
const RESOURCES = [
  {
    id: SIGNATURE_DEF_UUID,
    entityDefinitionId: SIGNATURE_DEF_UUID,
    apiSlug: SIGNATURE_API_SLUG,
    entityType: 'signature',
  },
  {
    id: CONTACT_DEF_UUID,
    entityDefinitionId: CONTACT_DEF_UUID,
    apiSlug: 'contacts',
    entityType: 'contact',
  },
]

/**
 * A real `CapabilitySet`. The records area is wide open and `signatures` is at
 * `Full` — i.e. the most privileged ordinary member there is, so nothing below
 * can be mistaken for an incidental capability denial.
 */
function capabilities(role: 'OWNER' | 'ADMIN' | 'USER' = 'USER') {
  return new CapabilitySet(
    new Set(
      expandLevelsToKeys({
        [Area.records]: Level.Full,
        [Area.signatures]: Level.Full,
      })
    ),
    {},
    role,
    'full'
  )
}

function caller(role: 'OWNER' | 'ADMIN' | 'USER' = 'USER') {
  return recordRouter.createCaller({
    db: {},
    capabilities: capabilities(role),
    headers: new Headers(),
    session: {
      organizationId: ORG_ID,
      userId: USER_ID,
      user: { id: USER_ID, defaultOrganizationId: ORG_ID },
    },
  } as never)
}

type Caller = ReturnType<typeof caller>

/**
 * All 17 procedures, each expressed against a def identifier so the same table
 * can be run for the bare slug, the def UUID and the apiSlug.
 *
 * `defOrRecordId(def)` builds whichever shape the procedure takes: a def
 * identifier, or a RecordId whose def part is that identifier.
 */
const PROCEDURES: [
  string,
  (c: Caller, def: string) => Promise<unknown>,
  keyof typeof handler | null,
][] = [
  ['getById', (c, d) => c.getById({ recordId: `${d}:${SIGNATURE_ID}` }), 'getById'],
  ['getByIds', (c, d) => c.getByIds({ items: [`${d}:${SIGNATURE_ID}`] }), 'getByIds'],
  ['search (scoped)', (c, d) => c.search({ entityDefinitionId: d, query: 'a' }), 'search'],
  [
    'lookupByField',
    (c, d) =>
      c.lookupByField({
        entityDefinitionId: d,
        candidates: [{ systemAttribute: 'signature_name', value: 'x' }],
      }),
    'lookupByField',
  ],
  ['listFiltered', (c, d) => c.listFiltered({ entityDefinitionId: d }), 'listFiltered'],
  ['listAll', (c, d) => c.listAll({ entityDefinitionId: d }), 'listAll'],
  ['create', (c, d) => c.create({ entityDefinitionId: d, values: {} }), 'create'],
  // `createMany` loops `handler.create`; it has no `createMany` of its own.
  ['createMany', (c, d) => c.createMany({ entityDefinitionId: d, records: [{}] }), 'create'],
  ['update', (c, d) => c.update({ recordId: `${d}:${SIGNATURE_ID}`, values: { a: 1 } }), 'update'],
  ['archive', (c, d) => c.archive({ recordId: `${d}:${SIGNATURE_ID}` }), 'archive'],
  ['restore', (c, d) => c.restore({ recordId: `${d}:${SIGNATURE_ID}` }), 'restore'],
  ['delete', (c, d) => c.delete({ recordId: `${d}:${SIGNATURE_ID}` }), 'delete'],
  ['bulkArchive', (c, d) => c.bulkArchive({ recordIds: [`${d}:${SIGNATURE_ID}`] }), 'bulkArchive'],
  ['bulkDelete', (c, d) => c.bulkDelete({ recordIds: [`${d}:${SIGNATURE_ID}`] }), 'bulkDelete'],
  [
    'merge',
    (c, d) =>
      c.merge({
        targetRecordId: `${d}:${SIGNATURE_ID}`,
        sourceRecordIds: [`${d}:sig_other0000000000000000`],
      }),
    'merge',
  ],
  ['invalidateCache', (c, d) => c.invalidateCache({ entityDefinitionId: d }), 'invalidateCache'],
  [
    'getDescendantRecordIds',
    (c, d) =>
      c.getDescendantRecordIds({
        recordId: `${d}:${SIGNATURE_ID}`,
        resourceFieldId: `${d}:parent`,
      }),
    // No `UnifiedCrudHandler` call of its own — see the dedicated cases below.
    null,
  ],
]

/** `getIdentities` is the 17th, and reads no `UnifiedCrudHandler`. */
const IDENTITIES = (c: Caller, d: string) => c.getIdentities({ recordId: `${d}:${SIGNATURE_ID}` })

beforeEach(() => {
  for (const fn of Object.values(handler)) fn.mockReset()
  handler.getById.mockResolvedValue({ recordId: 'x' })
  handler.getByIds.mockResolvedValue([])
  handler.search.mockResolvedValue({ items: [], nextCursor: null })
  handler.lookupByField.mockResolvedValue({ matches: [] })
  handler.listFiltered.mockResolvedValue({ items: [], total: 0 })
  handler.listAll.mockResolvedValue({ items: [] })
  handler.create.mockResolvedValue({ instance: { id: 'new' } })
  handler.createMany.mockResolvedValue({ created: 1 })
  handler.update.mockResolvedValue({ instance: { id: 'x' } })
  handler.archive.mockResolvedValue({ ok: true })
  handler.restore.mockResolvedValue({ ok: true })
  handler.delete.mockResolvedValue(undefined)
  handler.bulkArchive.mockResolvedValue({ count: 1 })
  handler.bulkDelete.mockResolvedValue({ count: 1, errors: [] })
  handler.merge.mockResolvedValue({ ok: true })
  handler.invalidateCache.mockResolvedValue(undefined)

  cache.getCachedResources.mockReset()
  cache.getCachedResources.mockResolvedValue(RESOURCES)
  cache.getCachedResource.mockReset()
  cache.getCachedResource.mockResolvedValue(undefined)
  identity.getRecordIdentityViews.mockReset()
  identity.getRecordIdentityViews.mockResolvedValue([])
  fieldValues.getDescendantIds.mockReset()
  fieldValues.getDescendantIds.mockResolvedValue([])
})

describe('record router — the `signature` def is unreachable by its bare slug', () => {
  it.each(PROCEDURES)('%s refuses it with 403', async (_name, call, mock) => {
    await expect(call(caller(), 'signature')).rejects.toMatchObject(FORBIDDEN)
    if (mock) expect(handler[mock]).not.toHaveBeenCalled()
    expect(fieldValues.getDescendantIds).not.toHaveBeenCalled()
  })

  it('getIdentities refuses it with 403', async () => {
    await expect(IDENTITIES(caller(), 'signature')).rejects.toMatchObject(FORBIDDEN)
    expect(identity.getRecordIdentityViews).not.toHaveBeenCalled()
  })

  it('the bare slug short-circuits without even reading the resources cache', async () => {
    await expect(caller().listFiltered({ entityDefinitionId: 'signature' })).rejects.toMatchObject(
      FORBIDDEN
    )
    expect(cache.getCachedResources).not.toHaveBeenCalled()
  })
})

describe('record router — …nor by the def UUID the client actually sends', () => {
  it.each(PROCEDURES)('%s refuses it with 403', async (_name, call, mock) => {
    await expect(call(caller(), SIGNATURE_DEF_UUID)).rejects.toMatchObject(FORBIDDEN)
    if (mock) expect(handler[mock]).not.toHaveBeenCalled()
    expect(fieldValues.getDescendantIds).not.toHaveBeenCalled()
  })

  it('getIdentities refuses it with 403', async () => {
    await expect(IDENTITIES(caller(), SIGNATURE_DEF_UUID)).rejects.toMatchObject(FORBIDDEN)
    expect(identity.getRecordIdentityViews).not.toHaveBeenCalled()
  })

  it('…nor by apiSlug, on the two procedures that accept one', async () => {
    await expect(caller().listAll({ apiSlug: SIGNATURE_API_SLUG })).rejects.toMatchObject(FORBIDDEN)
    await expect(
      caller().search({ apiSlug: SIGNATURE_API_SLUG, query: 'a' })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(handler.listAll).not.toHaveBeenCalled()
    expect(handler.search).not.toHaveBeenCalled()
  })

  it('one signature id inside a mixed bulk payload poisons the whole call', async () => {
    // Partial success would be worse than a refusal: it would delete the
    // contacts and silently skip the signature, with no signal to the caller.
    await expect(
      caller().bulkDelete({
        recordIds: [`${CONTACT_DEF_UUID}:${CONTACT_ID}`, `signature:${SIGNATURE_ID}`],
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(handler.bulkDelete).not.toHaveBeenCalled()
  })

  it('a signature as a MERGE SOURCE is refused, not only as the target', async () => {
    await expect(
      caller().merge({
        targetRecordId: `${CONTACT_DEF_UUID}:${CONTACT_ID}`,
        sourceRecordIds: [`signature:${SIGNATURE_ID}`],
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(handler.merge).not.toHaveBeenCalled()
  })
})

describe('record router — the closure is a ROUTING invariant, not a permission', () => {
  it.each(['OWNER', 'ADMIN', 'USER'] as const)('%s is refused just the same', async (role) => {
    await expect(
      caller(role).update({ recordId: `signature:${SIGNATURE_ID}`, values: { a: 1 } })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(handler.update).not.toHaveBeenCalled()
  })

  it('the guard runs BEFORE the `recordsDelete` verb check', async () => {
    // Order is disclosure: a member without `recordsDelete` must get the same
    // answer as one with it, so neither learns anything from the difference.
    const noDelete = new CapabilitySet(
      new Set(expandLevelsToKeys({ [Area.records]: Level.Read })),
      {},
      'USER',
      'full'
    )
    const c = recordRouter.createCaller({
      db: {},
      capabilities: noDelete,
      headers: new Headers(),
      session: { organizationId: ORG_ID, userId: USER_ID, user: { id: USER_ID } },
    } as never)
    await expect(c.delete({ recordId: `signature:${SIGNATURE_ID}` })).rejects.toMatchObject({
      cause: {
        name: 'ForbiddenError',
        message: expect.stringContaining('not reachable through the generic record path'),
      },
    })
  })
})

describe('record router — the guard sits OUTSIDE the try (403, never 500)', () => {
  it('getById surfaces 403, not the catch block’s INTERNAL_SERVER_ERROR', async () => {
    // `getById`'s catch rethrows only `TRPCError` and flattens everything else to
    // a 500 — so a guard moved one line down would still "deny", with the wrong
    // status and a leaked-looking error.
    await expect(caller().getById({ recordId: `signature:${SIGNATURE_ID}` })).rejects.toMatchObject(
      { cause: { name: 'ForbiddenError', statusCode: 403 } }
    )
  })

  it('getIdentities surfaces 403, not a 500', async () => {
    await expect(
      caller().getIdentities({ recordId: `signature:${SIGNATURE_ID}` })
    ).rejects.toMatchObject({ cause: { name: 'ForbiddenError', statusCode: 403 } })
  })

  it('getByIds surfaces 403, not a 500', async () => {
    await expect(caller().getByIds({ items: [`signature:${SIGNATURE_ID}`] })).rejects.toMatchObject(
      { cause: { name: 'ForbiddenError', statusCode: 403 } }
    )
  })

  it('search surfaces 403, not a 500', async () => {
    await expect(
      caller().search({ entityDefinitionId: SIGNATURE_DEF_UUID, query: 'a' })
    ).rejects.toMatchObject({ cause: { name: 'ForbiddenError', statusCode: 403 } })
  })
})

describe('record router — the UNSCOPED global-search union drops signatures', () => {
  const SIGNATURE_ITEM = {
    recordId: `${SIGNATURE_DEF_UUID}:${SIGNATURE_ID}`,
    title: 'Markus — Support',
  }
  const CONTACT_ITEM = { recordId: `${CONTACT_DEF_UUID}:${CONTACT_ID}`, title: 'Jane' }

  it('a signature name never reaches cmd+K', async () => {
    // `canViewEntity('signature')` now resolves through the RECORDS area and
    // returns `true` for any member with a records rung, so the union would
    // happily hand these back. This filter is the only thing stopping it.
    handler.search.mockResolvedValue({
      items: [SIGNATURE_ITEM, CONTACT_ITEM],
      nextCursor: null,
    })
    const result = await caller().search({ query: 'markus' })
    expect((result as { items: { recordId: string }[] }).items).toEqual([CONTACT_ITEM])
  })

  it('ordinary records still come back — this is a filter, not an outage', async () => {
    handler.search.mockResolvedValue({ items: [CONTACT_ITEM], nextCursor: null })
    const result = await caller().search({ query: 'jane' })
    expect((result as { items: unknown[] }).items).toEqual([CONTACT_ITEM])
  })

  it('the union filter is skipped when the search IS scoped', async () => {
    // A scoped search was already refused for signatures, so re-filtering there
    // would just be a wasted cache read on every scoped query.
    handler.search.mockResolvedValue({ items: [CONTACT_ITEM], nextCursor: null })
    cache.getCachedResources.mockClear()
    await caller().search({ entityDefinitionId: CONTACT_DEF_UUID, query: 'jane' })
    expect(cache.getCachedResources).toHaveBeenCalledTimes(1) // the guard's read only
  })

  it('the union passthrough survives an org with no instance-access defs', async () => {
    cache.getCachedResources.mockResolvedValue([RESOURCES[1]])
    handler.search.mockResolvedValue({ items: [CONTACT_ITEM], nextCursor: null })
    const result = await caller().search({ query: 'jane' })
    expect((result as { items: unknown[] }).items).toEqual([CONTACT_ITEM])
  })
})

describe('record router — NEGATIVE CONTROL: ordinary defs still work', () => {
  it.each(PROCEDURES)('%s passes `contact` straight through', async (_name, call, mock) => {
    await expect(call(caller(), CONTACT_DEF_UUID)).resolves.toBeDefined()
    if (mock) expect(handler[mock]).toHaveBeenCalledTimes(1)
  })

  it('getIdentities passes `contact` straight through', async () => {
    await expect(IDENTITIES(caller(), CONTACT_DEF_UUID)).resolves.toEqual([])
    expect(identity.getRecordIdentityViews).toHaveBeenCalledTimes(1)
  })

  it('an unknown def identifier is not refused by this guard', async () => {
    // The guard's job is to close instance-access defs, not to validate ids —
    // anything it cannot resolve stays the downstream handler's problem.
    await expect(
      caller().listFiltered({ entityDefinitionId: 'edf_unknown00000000000000000' })
    ).resolves.toBeDefined()
    expect(handler.listFiltered).toHaveBeenCalledTimes(1)
  })
})
