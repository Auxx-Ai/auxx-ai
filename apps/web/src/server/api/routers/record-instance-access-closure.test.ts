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

/**
 * The two MAIL instance-access defs (plan 40 phase 1). Unlike `signature`, these
 * are exempted on the READ arm and refused only on the MUTATION arm — see the
 * dedicated describes at the bottom of this file for why.
 */
const INBOX_DEF_UUID = 'edf_inbox0000000000000000000'
const INBOX_API_SLUG = 'inboxes'

/**
 * The two instance-access resources that live in their OWN tables and are
 * therefore admitted on the hydration arm — `RecordPickerService` filters them
 * per row through `canViewInstance`. Unlike `signature`, they have no
 * `EntityDefinition` row at all, so only the bare-slug form exists.
 */
const KB_ID = 'kb_cuid00000000000000000000'
const DATASET_ID = 'dst_cuid0000000000000000000'
const INBOX_ID = 'ibx_cuid0000000000000000000'
const PERSONAL_INBOX_DEF_UUID = 'edf_pinbox000000000000000000'
const PERSONAL_INBOX_ID = 'pib_cuid0000000000000000000'

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
  // `kb` and `dataset` are real entries — `entityDefinitionIdSchema` validates
  // against this registry, so an empty stub would reject them at the ZOD layer
  // and the guard assertions below would never run.
  RESOURCE_TABLE_REGISTRY: [{ id: 'kb' }, { id: 'dataset' }],
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
  {
    id: INBOX_DEF_UUID,
    entityDefinitionId: INBOX_DEF_UUID,
    apiSlug: INBOX_API_SLUG,
    entityType: 'inbox',
  },
  {
    id: PERSONAL_INBOX_DEF_UUID,
    entityDefinitionId: PERSONAL_INBOX_DEF_UUID,
    apiSlug: 'personal-inboxes',
    entityType: 'personal_inbox',
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
  // `getByIds` is deliberately ABSENT: it is the one procedure that FILTERS
  // rather than refuses, because its batch is assembled from unrelated callers.
  // Its (equally strict) contract lives in the dedicated describe below —
  // "the HYDRATION arm filters instead of refusing".
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

/**
 * Plan 40 phase 1 / 40a §8.1 — the MAIL exemption, and the reason this file
 * grew a second shape.
 *
 * `inbox` and `personal_inbox` joined `INSTANCE_ACCESS_RESOURCES`, so without a
 * carve-out the guard above would have refused them everywhere and taken the
 * mail sidebar, the inbox pickers and the thread inbox column down with it — in
 * the phase that is supposed to be behavior-inert. The split is by ARM:
 *
 *  - READS pass. The records capability layer was never an inbox's access
 *    authority; `userInstanceGrants` is, and `canViewEntity('inbox')`
 *    short-circuits to `true` via `isMailInfraDef` regardless, so refusing here
 *    would close nothing and break the readers.
 *  - MUTATIONS are still refused. Inbox writes answer to `channels.manage` +
 *    `assertAdminInstance` in `inbox.ts`; a second door into `EntityInstance`
 *    updates would route around both. It also satisfies 40a §8.4 for free:
 *    `personal_inbox` is not user-creatable, only provisionable.
 *
 * Every case below runs against BOTH identifier forms the client actually sends
 * (bare slug and def UUID) — the slug short-circuits and the UUID resolves
 * through the resources cache, and an exemption applied to only one of those two
 * paths would still pass a slug-only test.
 */

const MAIL_READS: [string, (c: Caller, def: string, id: string) => Promise<unknown>][] = [
  ['getById', (c, d, id) => c.getById({ recordId: `${d}:${id}` })],
  ['getByIds', (c, d, id) => c.getByIds({ items: [`${d}:${id}`] })],
  ['getIdentities', (c, d, id) => c.getIdentities({ recordId: `${d}:${id}` })],
  ['search (scoped)', (c, d) => c.search({ entityDefinitionId: d, query: 'a' })],
  [
    'lookupByField',
    (c, d) =>
      c.lookupByField({
        entityDefinitionId: d,
        candidates: [{ systemAttribute: 'inbox_name', value: 'Support' }],
      }),
  ],
  ['listFiltered', (c, d) => c.listFiltered({ entityDefinitionId: d })],
  ['listAll', (c, d) => c.listAll({ entityDefinitionId: d })],
  ['invalidateCache', (c, d) => c.invalidateCache({ entityDefinitionId: d })],
  [
    'getDescendantRecordIds',
    (c, d, id) =>
      c.getDescendantRecordIds({ recordId: `${d}:${id}`, resourceFieldId: `${d}:parent` }),
  ],
]

const MAIL_WRITES: [string, (c: Caller, def: string, id: string) => Promise<unknown>][] = [
  ['create', (c, d) => c.create({ entityDefinitionId: d, values: {} })],
  ['createMany', (c, d) => c.createMany({ entityDefinitionId: d, records: [{}] })],
  ['update', (c, d, id) => c.update({ recordId: `${d}:${id}`, values: { a: 1 } })],
  ['archive', (c, d, id) => c.archive({ recordId: `${d}:${id}` })],
  ['restore', (c, d, id) => c.restore({ recordId: `${d}:${id}` })],
  ['delete', (c, d, id) => c.delete({ recordId: `${d}:${id}` })],
  ['bulkArchive', (c, d, id) => c.bulkArchive({ recordIds: [`${d}:${id}`] })],
  ['bulkDelete', (c, d, id) => c.bulkDelete({ recordIds: [`${d}:${id}`] })],
  [
    'merge',
    (c, d, id) =>
      c.merge({
        targetRecordId: `${d}:${id}`,
        sourceRecordIds: [`${d}:ibx_other0000000000000000`],
      }),
  ],
]

describe('record router — the MAIL READ arm lets inbox defs through', () => {
  it.each(MAIL_READS)('%s resolves an inbox by its bare slug', async (_name, call) => {
    await expect(call(caller(), 'inbox', INBOX_ID)).resolves.toBeDefined()
  })

  it.each(MAIL_READS)('%s resolves an inbox by its def UUID', async (_name, call) => {
    await expect(call(caller(), INBOX_DEF_UUID, INBOX_ID)).resolves.toBeDefined()
  })

  it.each(MAIL_READS)('%s resolves a personal inbox by its bare slug', async (_name, call) => {
    await expect(call(caller(), 'personal_inbox', PERSONAL_INBOX_ID)).resolves.toBeDefined()
  })

  it('…and by apiSlug, on the two procedures that accept one', async () => {
    // The mail sidebar and pickers reach `listAll` by def slug today, but the
    // apiSlug form resolves through the same cache lookup and must not diverge.
    await expect(caller().listAll({ apiSlug: INBOX_API_SLUG })).resolves.toBeDefined()
    await expect(caller().search({ apiSlug: INBOX_API_SLUG, query: 'a' })).resolves.toBeDefined()
  })

  it('a MIXED getByIds batch with one inbox no longer 403s the whole batch', async () => {
    // THE regression this exemption exists for. `record.getByIds` is
    // intentionally mixed-def (`use-record-batch-fetcher.ts`,
    // `resource-provider.tsx`) and the guard throws on the FIRST offending
    // element — so one inbox RecordId would have taken every unrelated contact,
    // company and ticket in the batch down with it. This is also why a dedicated
    // `inbox.getByIds` would not have closed the hole.
    await expect(
      caller().getByIds({
        items: [
          `${CONTACT_DEF_UUID}:${CONTACT_ID}`,
          `inbox:${INBOX_ID}`,
          `personal_inbox:${PERSONAL_INBOX_ID}`,
        ],
      })
    ).resolves.toBeDefined()
    expect(handler.getByIds).toHaveBeenCalledTimes(1)
  })

  it('a signature in that same mixed batch is DROPPED, not poisoning it', async () => {
    // Was: "still poisons it". The poisoning was the bug — one unroutable id
    // taking every unrelated record in the batch with it. The exemption is still
    // exactly as narrow; what changed is the failure MODE, from "403 the call"
    // to "omit the id". The assertion that matters is the second one: the
    // signature must never reach the handler.
    await expect(
      caller().getByIds({ items: [`inbox:${INBOX_ID}`, `signature:${SIGNATURE_ID}`] })
    ).resolves.toBeDefined()
    expect(handler.getByIds).toHaveBeenCalledWith([`inbox:${INBOX_ID}`])
  })
})

/**
 * `record.getByIds` — the HYDRATION arm, and the only procedure on this router
 * that filters instead of refusing.
 *
 * Its input is not one caller's request: the client's record-store batcher
 * collects ids from every component that mounted in the same tick
 * (`use-record-batch-fetcher.ts`). Throwing for one unroutable def therefore
 * denied every unrelated record beside it — which is what a `kb:` id did to the
 * articles and contacts on `/app/kb`.
 *
 * The closure is NOT weakened by this: a refused def still never reaches
 * `UnifiedCrudHandler`, so nothing about it is readable. Only the shape of the
 * denial changed, from a thrown 403 to an omitted key — which is already this
 * path's answer for any id the member cannot reach.
 *
 * `kb` and `dataset` go further and are ADMITTED here, because
 * `RecordPickerService.admitSystemRows` gates them per row through
 * `canViewInstance` — the same authority `kb.list` filters on. They stay refused
 * on every other procedure, where no such filter exists.
 */
describe('record router — the HYDRATION arm filters instead of refusing', () => {
  it('a batch that is ONLY a refused def resolves empty and never calls the handler', async () => {
    await expect(caller().getByIds({ items: [`signature:${SIGNATURE_ID}`] })).resolves.toEqual({})
    expect(handler.getByIds).not.toHaveBeenCalled()
  })

  it('…by the def UUID form too, not just the bare slug', async () => {
    await expect(
      caller().getByIds({ items: [`${SIGNATURE_DEF_UUID}:${SIGNATURE_ID}`] })
    ).resolves.toEqual({})
    expect(handler.getByIds).not.toHaveBeenCalled()
  })

  it('an ordinary def in the same batch survives the signature beside it', async () => {
    await expect(
      caller().getByIds({
        items: [`${CONTACT_DEF_UUID}:${CONTACT_ID}`, `signature:${SIGNATURE_ID}`],
      })
    ).resolves.toBeDefined()
    expect(handler.getByIds).toHaveBeenCalledWith([`${CONTACT_DEF_UUID}:${CONTACT_ID}`])
  })

  it('kb and dataset ARE admitted — the picker gates them per row', async () => {
    await expect(
      caller().getByIds({ items: [`kb:${KB_ID}`, `dataset:${DATASET_ID}`] })
    ).resolves.toBeDefined()
    expect(handler.getByIds).toHaveBeenCalledWith([`kb:${KB_ID}`, `dataset:${DATASET_ID}`])
  })

  it('search ALSO admits them — its path narrows per row before it paginates', async () => {
    // This used to assert the opposite, and the refusal was correct at the time:
    // `getResources` had no instance-access filter, so admitting `kb` would have
    // handed every member the org's whole KB list. It now resolves
    // `instanceTableVisibilityScope` into a predicate applied before `LIMIT`
    // (with the matching viewer dimension in the picker's cache key), which is
    // what makes this safe — and what makes every kb/dataset picker in the app
    // work, since they all ride this procedure.
    await expect(caller().search({ entityDefinitionId: 'kb', query: 'a' })).resolves.toBeDefined()
    await expect(
      caller().search({ entityDefinitionId: 'dataset', query: 'a' })
    ).resolves.toBeDefined()
  })

  it('…and are still refused on the paths that do NOT gate them', async () => {
    // The carve-out is per PROCEDURE, not per arm, and stays that way: an
    // exemption is only as defensible as the gate behind that specific path.
    // `getById` reads the `EntityInstance` lane, where a KB has no row at all;
    // `listAll` / `listFiltered` are not this pair's door. All three keep
    // pointing the caller at `kb.ts` / `dataset.ts`.
    await expect(caller().getById({ recordId: `kb:${KB_ID}` })).rejects.toMatchObject(FORBIDDEN)
    await expect(caller().listAll({ entityDefinitionId: 'kb' })).rejects.toMatchObject(FORBIDDEN)
    await expect(caller().listFiltered({ entityDefinitionId: 'kb' })).rejects.toMatchObject(
      FORBIDDEN
    )
  })

  it('search still refuses the keys that have no gated path at all', async () => {
    // The widening is exactly two keys wide. `dashboard`, `workflow`, `agent`,
    // `signature` and `snippet` are not statically pickable, so there is no
    // system-table scope for them to be narrowed by.
    // `signature` stands for the group: they all reach the identical
    // `isInstanceAccessKey` branch, keyed only on set membership. (The others
    // cannot be asserted here — this suite's mocked resource registry is two
    // entries wide, so their ids fail the input schema before the guard runs.)
    await expect(
      caller().search({ entityDefinitionId: 'signature', query: 'a' })
    ).rejects.toMatchObject(FORBIDDEN)
  })
})

describe('record router — the MAIL MUTATION arm still refuses inbox defs', () => {
  it.each(MAIL_WRITES)('%s refuses an inbox by its bare slug with 403', async (_name, call) => {
    await expect(call(caller(), 'inbox', INBOX_ID)).rejects.toMatchObject(FORBIDDEN)
  })

  it.each(MAIL_WRITES)('%s refuses an inbox by its def UUID with 403', async (_name, call) => {
    await expect(call(caller(), INBOX_DEF_UUID, INBOX_ID)).rejects.toMatchObject(FORBIDDEN)
  })

  it.each(MAIL_WRITES)('%s refuses a personal inbox with 403', async (_name, call) => {
    await expect(call(caller(), 'personal_inbox', PERSONAL_INBOX_ID)).rejects.toMatchObject(
      FORBIDDEN
    )
  })

  it('an OWNER is refused just the same — routing invariant, not a permission', async () => {
    await expect(
      caller('OWNER').update({ recordId: `inbox:${INBOX_ID}`, values: { a: 1 } })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(handler.update).not.toHaveBeenCalled()
  })

  it('40a §8.4: the generic CREATE path does not accept `personal_inbox`', async () => {
    // Personal inboxes are created ONLY through provisioning. This is the whole
    // of that requirement, satisfied by the mutation arm rather than by a
    // separate check.
    await expect(
      caller().create({ entityDefinitionId: 'personal_inbox', values: {} })
    ).rejects.toMatchObject(FORBIDDEN)
    await expect(
      caller().create({ entityDefinitionId: PERSONAL_INBOX_DEF_UUID, values: {} })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(handler.create).not.toHaveBeenCalled()
  })

  it('one inbox id inside a mixed bulk payload still poisons the whole call', async () => {
    await expect(
      caller().bulkDelete({
        recordIds: [`${CONTACT_DEF_UUID}:${CONTACT_ID}`, `inbox:${INBOX_ID}`],
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(handler.bulkDelete).not.toHaveBeenCalled()
  })
})

describe('record router — inboxes stay in the UNSCOPED global-search union', () => {
  const INBOX_ITEM = { recordId: `${INBOX_DEF_UUID}:${INBOX_ID}`, title: 'Support' }
  const SIGNATURE_ITEM = {
    recordId: `${SIGNATURE_DEF_UUID}:${SIGNATURE_ID}`,
    title: 'Markus — Support',
  }
  const CONTACT_ITEM = { recordId: `${CONTACT_DEF_UUID}:${CONTACT_ID}`, title: 'Jane' }

  it('an inbox still reaches cmd+K, while a signature still does not', async () => {
    // The union post-filter is DERIVED from `isInstanceAccessKey`, so phase 1
    // would have silently dropped inboxes out of global search the moment the
    // registry changed — a behavior change in the phase that must be inert. It
    // takes the same two-def carve-out; drop `inbox` from `MAIL_READ_EXEMPT_KEYS`
    // and this is what fails.
    handler.search.mockResolvedValue({
      items: [INBOX_ITEM, SIGNATURE_ITEM, CONTACT_ITEM],
      nextCursor: null,
    })
    const result = await caller().search({ query: 'support' })
    expect((result as { items: { recordId: string }[] }).items).toEqual([INBOX_ITEM, CONTACT_ITEM])
  })
})
