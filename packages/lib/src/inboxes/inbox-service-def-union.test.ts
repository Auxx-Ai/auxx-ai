// packages/lib/src/inboxes/inbox-service-def-union.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 40 phase 1, seams 1 + 2 — `InboxService` across BOTH inbox definitions.
 *
 * A mailbox lives on `inbox` (org-shared) or `personal_inbox` (a member's
 * connected account). Three properties are asserted here, and each one is a
 * silent failure if it breaks — nothing throws, the data is simply wrong:
 *
 *  1. **The union.** `getInboxes()` backs the `org:inboxes` cache and ~20
 *     consumers. Listing one def makes personal mailboxes vanish from every
 *     mail read path (40a §0's top-ranked bug).
 *  2. **The derivation.** `isPersonal` is def membership OR the legacy
 *     `inbox_is_personal` marker. Both halves are load-bearing for the whole
 *     window between entity migration 059 and data migration 060 — def-only
 *     turns today's personal mailboxes shared (a privacy regression the moment
 *     059 lands), marker-only turns the migrated ones back.
 *  3. **Per-instance def resolution.** FieldValues resolve through the
 *     RecordId's def, so reading a personal mailbox as `inbox:<id>` returns an
 *     EMPTY value map — an all-defaults inbox with `isPersonal: false`.
 */

const PERSONAL_DEF_ID = 'edf_personal000000000000000'
const SHARED_DEF_ID = 'edf_shared00000000000000000'

const { onCacheEvent, getCachedEntityDefId, listAll, crud } = vi.hoisted(() => ({
  onCacheEvent: vi.fn(async () => undefined),
  getCachedEntityDefId: vi.fn(
    async (_org: string, _type: string) => undefined as string | undefined
  ),
  listAll: vi.fn(),
  crud: {
    create: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getFieldValues: vi.fn(),
  },
}))

vi.mock('../cache', () => ({
  onCacheEvent,
  getCachedEntityDefId,
  getUserCache: () => ({ get: async () => ({ isAdmin: false, inboxLens: {} }) }),
}))
vi.mock('../resource-access/resource-access-service', () => ({
  hasPermission: vi.fn(async () => false),
  setInstanceAccess: vi.fn(async () => undefined),
}))
vi.mock('../resources/crud', () => ({
  listAll,
  UnifiedCrudHandler: class {
    create = crud.create
    getById = crud.getById
    update = crud.update
    delete = crud.delete
    getFieldValues = crud.getFieldValues
  },
}))

const { InboxService } = await import('./inbox-service')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const SHARED_INBOX = 'ibx_shared00000000000000000'
const PERSONAL_INBOX = 'ibx_personal0000000000000000'

/** A `listAll` item as the query layer shapes it. */
function item(id: string, defId: string, fieldValues: Record<string, unknown> = {}) {
  return {
    id,
    recordId: `${defId}:${id}`,
    fieldValues,
    displayName: `inbox ${id}`,
    organizationId: ORG_ID,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    createdById: null,
  }
}

/** `getCachedEntityDefId` answers for an org that HAS run entity migration 059. */
function withPersonalDefSeeded() {
  getCachedEntityDefId.mockImplementation(async (_org: string, type: string) =>
    type === 'personal_inbox' ? PERSONAL_DEF_ID : SHARED_DEF_ID
  )
}

/** …and for one that has not: the personal def simply does not resolve. */
function withoutPersonalDef() {
  getCachedEntityDefId.mockImplementation(async (_org: string, type: string) =>
    type === 'personal_inbox' ? undefined : SHARED_DEF_ID
  )
}

/**
 * Minimal `db` fake: `EntityInstance.findFirst` plus the drizzle select chain
 * `readInboxFloors` uses to resolve each inbox's `role:org_member` baseline row
 * (plan 40 §6 — the floor is a `ResourceAccess` row, not a FieldValue).
 * `floorRows` defaults to none, i.e. every inbox at the org-shared `full`.
 */
function makeDb(
  instances: Array<{ id: string; entityDefinitionId: string }>,
  floorRows: Array<{ entityInstanceId: string; permission: string; lens: string | null }> = []
) {
  return {
    query: {
      EntityInstance: {
        findFirst: vi.fn(async () => instances[0]),
      },
    },
    select: () => ({ from: () => ({ where: async () => floorRows }) }),
  } as never
}

const service = (db: unknown = makeDb([])) => new InboxService(db as never, ORG_ID, USER_ID)

beforeEach(() => {
  onCacheEvent.mockReset()
  onCacheEvent.mockResolvedValue(undefined as never)
  getCachedEntityDefId.mockReset()
  listAll.mockReset()
  for (const fn of Object.values(crud)) fn.mockReset()
})

describe('getInboxes — unions both inbox definitions', () => {
  it('lists BOTH defs and merges them into one list', async () => {
    withPersonalDefSeeded()
    listAll.mockImplementation(async (_ctx: unknown, params: { entityDefinitionId: string }) =>
      params.entityDefinitionId === 'personal_inbox'
        ? { items: [item(PERSONAL_INBOX, PERSONAL_DEF_ID)] }
        : { items: [item(SHARED_INBOX, SHARED_DEF_ID)] }
    )

    const inboxes = await service().getInboxes()

    expect(
      listAll.mock.calls.map((c) => (c[1] as { entityDefinitionId: string }).entityDefinitionId)
    ).toEqual(['inbox', 'personal_inbox'])
    expect(inboxes.map((i) => i.id)).toEqual([SHARED_INBOX, PERSONAL_INBOX])
  })

  it('degrades to shared-only — without throwing — before entity migration 059', async () => {
    // `listAll` throws on an unknown entity key, and this list feeds the org
    // cache every mail read path hangs off. An org mid-deploy must lose the
    // personal half, not its whole mailbox list.
    withoutPersonalDef()
    listAll.mockResolvedValue({ items: [item(SHARED_INBOX, SHARED_DEF_ID)] })

    const inboxes = await service().getInboxes()

    expect(listAll).toHaveBeenCalledTimes(1)
    expect(listAll.mock.calls[0]?.[1]).toEqual({ entityDefinitionId: 'inbox' })
    expect(inboxes.map((i) => i.id)).toEqual([SHARED_INBOX])
  })
})

describe('isPersonal is DERIVED — def membership OR the legacy marker', () => {
  beforeEach(withPersonalDefSeeded)

  it('a `personal_inbox` instance is personal with NO marker field present', async () => {
    // Post-060: the field is gone from the def entirely.
    listAll.mockImplementation(async (_ctx: unknown, params: { entityDefinitionId: string }) =>
      params.entityDefinitionId === 'personal_inbox'
        ? { items: [item(PERSONAL_INBOX, PERSONAL_DEF_ID, { inbox_owner_user_id: USER_ID })] }
        : { items: [] }
    )

    const [inbox] = await service().getInboxes()
    expect(inbox?.isPersonal).toBe(true)
    expect(inbox?.entityDefinitionKey).toBe('personal_inbox')
    expect(inbox?.ownerUserId).toBe(USER_ID)
  })

  it('an `inbox` instance carrying the legacy marker is STILL personal (pre-060 inertness)', async () => {
    // The behavior-inertness assertion for phase 1: today's one personal
    // mailbox is on the shared def with `inbox_is_personal: true`. Reading only
    // the def would flip it to shared — a privacy regression on deploy.
    listAll.mockImplementation(async (_ctx: unknown, params: { entityDefinitionId: string }) =>
      params.entityDefinitionId === 'inbox'
        ? {
            items: [
              item(PERSONAL_INBOX, SHARED_DEF_ID, {
                inbox_is_personal: true,
                inbox_owner_user_id: USER_ID,
              }),
            ],
          }
        : { items: [] }
    )

    const [inbox] = await service().getInboxes()
    expect(inbox?.isPersonal).toBe(true)
    expect(inbox?.entityDefinitionKey).toBe('inbox')
  })

  it('an ordinary shared inbox is not personal', async () => {
    listAll.mockImplementation(async (_ctx: unknown, params: { entityDefinitionId: string }) =>
      params.entityDefinitionId === 'inbox'
        ? { items: [item(SHARED_INBOX, SHARED_DEF_ID, { inbox_default_lens: 'full' })] }
        : { items: [] }
    )

    const [inbox] = await service().getInboxes()
    expect(inbox?.isPersonal).toBe(false)
    expect(inbox?.entityDefinitionKey).toBe('inbox')
  })
})

describe('`defaultLens` is the ROW-derived floor (plan 40 §6)', () => {
  beforeEach(withPersonalDefSeeded)

  it('reads each inbox’s `role:org_member` baseline row, defaulting to `full`', async () => {
    // The `org:inboxes` cache is built from this, and its `defaultLens` is what
    // the count-delta audience and every access badge read. Deriving it from
    // `inbox_default_lens` would serve the floor the org had before its last
    // edit — the field has not been read since phase 2.
    const db = makeDb(
      [],
      [
        { entityInstanceId: 'ibx_closed', permission: 'none', lens: null },
        { entityInstanceId: 'ibx_peek', permission: 'view', lens: 'subject' },
      ]
    )
    listAll.mockImplementation(async (_ctx: unknown, params: { entityDefinitionId: string }) =>
      params.entityDefinitionId === 'inbox'
        ? {
            items: [
              // A STALE field value on every one of them — it must not be read.
              item('ibx_closed', SHARED_DEF_ID, { inbox_default_lens: 'full' }),
              item('ibx_peek', SHARED_DEF_ID, { inbox_default_lens: 'full' }),
              item('ibx_open', SHARED_DEF_ID, { inbox_default_lens: 'none' }),
            ],
          }
        : { items: [] }
    )

    const inboxes = await service(db).getInboxes()
    expect(inboxes.map((i) => [i.id, i.defaultLens])).toEqual([
      ['ibx_closed', 'none'],
      ['ibx_peek', 'subject'],
      ['ibx_open', 'full'],
    ])
  })

  it('reports `none` for a personal mailbox — it has no org-wide floor at all', async () => {
    const db = makeDb([], [])
    listAll.mockImplementation(async (_ctx: unknown, params: { entityDefinitionId: string }) =>
      params.entityDefinitionId === 'personal_inbox'
        ? { items: [item(PERSONAL_INBOX, PERSONAL_DEF_ID)] }
        : { items: [] }
    )
    const [inbox] = await service(db).getInboxes()
    expect(inbox?.defaultLens).toBe('none')
  })

  it('resolveInbox agrees with getInboxes on a single instance', async () => {
    const db = makeDb(
      [{ id: SHARED_INBOX, entityDefinitionId: SHARED_DEF_ID }],
      [{ entityInstanceId: SHARED_INBOX, permission: 'view', lens: 'metadata' }]
    )
    crud.getById.mockResolvedValue({ id: SHARED_INBOX })
    crud.getFieldValues.mockResolvedValue(new Map())
    const inbox = await service(db).getInboxById(SHARED_INBOX)
    expect(inbox?.defaultLens).toBe('metadata')
  })
})

describe('cache entries carry a slug-keyed RecordId matching their def', () => {
  beforeEach(withPersonalDefSeeded)

  it('mints `<defKey>:<id>`, not the def CUID `listAll` hands back', async () => {
    // Mail `ResourceAccess` rows live in the SLUG keyspace; a CUID-keyed inbox
    // RecordId escaping into a grant is the 2026-07-29 bug shape.
    listAll.mockImplementation(async (_ctx: unknown, params: { entityDefinitionId: string }) =>
      params.entityDefinitionId === 'personal_inbox'
        ? { items: [item(PERSONAL_INBOX, PERSONAL_DEF_ID)] }
        : { items: [item(SHARED_INBOX, SHARED_DEF_ID)] }
    )

    const inboxes = await service().getInboxes()
    expect(inboxes.map((i) => i.recordId)).toEqual([
      `inbox:${SHARED_INBOX}`,
      `personal_inbox:${PERSONAL_INBOX}`,
    ])
    // The discriminator and the RecordId can never disagree.
    for (const inbox of inboxes) {
      expect(inbox.recordId.startsWith(`${inbox.entityDefinitionKey}:`)).toBe(true)
    }
  })
})

describe('per-instance reads resolve the instance’s ACTUAL definition', () => {
  beforeEach(withPersonalDefSeeded)

  it('reads a personal mailbox’s FieldValues through `personal_inbox:<id>`', async () => {
    // The silent-failure guard: `getFieldValues` resolves CustomField ids
    // through the RecordId's def, so an `inbox:` prefix here returns an empty
    // map — an all-defaults inbox with `isPersonal: false`, nothing thrown.
    const db = makeDb([{ id: PERSONAL_INBOX, entityDefinitionId: PERSONAL_DEF_ID }])
    crud.getById.mockResolvedValue({ id: PERSONAL_INBOX })
    crud.getFieldValues.mockResolvedValue(new Map([['inbox_owner_user_id', { value: USER_ID }]]))

    const inbox = await service(db).getInboxById(PERSONAL_INBOX)

    expect(crud.getFieldValues).toHaveBeenCalledWith(`personal_inbox:${PERSONAL_INBOX}`)
    expect(inbox?.entityDefinitionKey).toBe('personal_inbox')
    expect(inbox?.recordId).toBe(`personal_inbox:${PERSONAL_INBOX}`)
    expect(inbox?.isPersonal).toBe(true)
  })

  it('leaves a shared mailbox on `inbox:<id>` — unchanged from today', async () => {
    const db = makeDb([{ id: SHARED_INBOX, entityDefinitionId: SHARED_DEF_ID }])
    crud.getById.mockResolvedValue({ id: SHARED_INBOX })
    crud.getFieldValues.mockResolvedValue(new Map())

    const inbox = await service(db).getInboxById(SHARED_INBOX)

    expect(crud.getFieldValues).toHaveBeenCalledWith(`inbox:${SHARED_INBOX}`)
    expect(inbox?.entityDefinitionKey).toBe('inbox')
    expect(inbox?.isPersonal).toBe(false)
  })

  it('canonicalizes a CUID-keyed RecordId handed in by a caller', async () => {
    const db = makeDb([{ id: PERSONAL_INBOX, entityDefinitionId: PERSONAL_DEF_ID }])
    crud.getById.mockResolvedValue({ id: PERSONAL_INBOX })
    crud.getFieldValues.mockResolvedValue(new Map())

    const inbox = await service(db).getInbox(`${PERSONAL_DEF_ID}:${PERSONAL_INBOX}` as never)

    expect(inbox?.recordId).toBe(`personal_inbox:${PERSONAL_INBOX}`)
  })

  it('updateInboxById writes through the instance’s own def', async () => {
    // `crudHandler.update` dispatches field writes and hooks off the
    // RecordId's def — a hard-coded `'inbox'` would write a personal mailbox
    // through the shared def's CustomField ids.
    const db = makeDb([{ id: PERSONAL_INBOX, entityDefinitionId: PERSONAL_DEF_ID }])
    crud.update.mockResolvedValue(undefined)
    crud.getFieldValues.mockResolvedValue(new Map())

    await service(db).updateInboxById(PERSONAL_INBOX, { name: 'renamed' })

    expect(crud.update).toHaveBeenCalledWith(`personal_inbox:${PERSONAL_INBOX}`, {
      inbox_name: 'renamed',
    })
  })
})

describe('createInbox is shared-only unless the caller says otherwise', () => {
  beforeEach(() => {
    withPersonalDefSeeded()
    crud.create.mockResolvedValue({ instance: { id: SHARED_INBOX } })
    crud.getFieldValues.mockResolvedValue(new Map())
  })

  it('defaults to the `inbox` def (the generic create path must never make a personal one)', async () => {
    const db = makeDb([{ id: SHARED_INBOX, entityDefinitionId: SHARED_DEF_ID }])
    await service(db).createInbox({ name: 'Support' })
    expect(crud.create.mock.calls[0]?.[0]).toBe('inbox')
  })

  it('creates under `personal_inbox` when provisioning asks for it', async () => {
    const db = makeDb([{ id: SHARED_INBOX, entityDefinitionId: PERSONAL_DEF_ID }])
    await service(db).createInbox({ name: 'me@example.com', entityDefinitionKey: 'personal_inbox' })
    expect(crud.create.mock.calls[0]?.[0]).toBe('personal_inbox')
  })

  it('never writes `inbox_default_lens` — the floor is a ROW (plan 40 §6)', async () => {
    // Writing the field made creating an inbox with a non-default floor produce
    // an org-visible one: nothing has read `inbox_default_lens` since phase 2.
    const db = makeDb([{ id: SHARED_INBOX, entityDefinitionId: SHARED_DEF_ID }])
    await service(db).createInbox({ name: 'Support', defaultLens: 'full' })
    expect(crud.create.mock.calls[0]?.[1]).not.toHaveProperty('inbox_default_lens')
  })

  it('writes NO baseline row for the org-shared default — absence IS `full`', async () => {
    // `makeDb` has no `insert`, so a row write would throw. That is the
    // assertion: the common create takes zero extra writes.
    const db = makeDb([{ id: SHARED_INBOX, entityDefinitionId: SHARED_DEF_ID }])
    await expect(service(db).createInbox({ name: 'Support' })).resolves.toBeDefined()
  })
})
