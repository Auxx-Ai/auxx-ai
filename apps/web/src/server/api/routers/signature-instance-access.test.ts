// apps/web/src/server/api/routers/signature-instance-access.test.ts

import { schema } from '@auxx/database'
import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import { Area, expandLevelsToKeys, Level, PermissionKey } from '@auxx/lib/permissions/client'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 36 §10 — the signature router at every tier, driven for real.
 *
 * The slice shipped with zero router tests; this file is the behavioral half for
 * `api.signature.*`. Nothing here is a source-text assertion: `./signature` is
 * imported and driven through a tRPC caller, `ctx.capabilities` is a **real**
 * {@link CapabilitySet} (the shipped `assertViewInstance` / `assertEditInstance`
 * / `assertAdminInstance` / `assert`), and the REAL
 * `~/server/lib/signature-instance-access` resolves + asserts. Deleting any
 * assert makes a case below fail, because the mocked `UnifiedCrudHandler` and the
 * fake `db` are the observed side effects.
 *
 * What this file exists to pin, hardest-first:
 *
 * 1. **`baselineAtCreate: true` really means absent ⇒ NO access**, through BOTH
 *    of its arms — an id the org holds rows on but the caller holds none of
 *    (`restrictedInstanceIds.has(id)` → `instanceAccess[id] === undefined`), and
 *    an id with no row anywhere (`instanceFallbackLevel` → `undefined`). Area
 *    `Full` must not rescue either. This is the whole posture of the slice, and
 *    the way it breaks (flip `baselineAtCreate` to `false`) is invisible in the
 *    router's own source.
 * 2. **No ADMIN override and no OWNER bypass (decision 0.6, revised 2026-07-28),
 *    and no worker seat at all (decision 0.5)** — all three are surprising
 *    enough that someone will "fix" them, so each is pinned from both sides. The
 *    OWNER half is the newest: `effectiveInstanceLevel`'s short-circuit is now
 *    scoped to `!baselineAtCreate`, so an owner reaches their own signatures
 *    through their `admin` row and nobody else's at all.
 * 3. **`list` FILTERS and does so in SQL, before pagination.** The compiled
 *    `WHERE` is inspected, so a post-fetch `.filter()` (which would short a page)
 *    fails the case even though the returned rows would look identical.
 * 4. **`create` writes the owner `admin` `ResourceAccess` row.** Under
 *    `baselineAtCreate: true` a signature born without that row is invisible to
 *    everyone including its author, so the row — not the return value — is the
 *    assertion.
 * 5. **404 before 403.** A foreign-org id must be indistinguishable from a
 *    restricted one; both end as `NotFoundError`, for every caller.
 * 6. **`setDefault` asserts `view`, deliberately** (§12.2 + the wave-3 note): it
 *    writes only the caller's own `UserSetting` row, so gating it at `edit` would
 *    make every SHARED signature un-defaultable.
 *
 * Mocked, and why:
 *  - `~/server/api/trpc` — the real module pulls auth/db/redis at import time.
 *    The stand-in's `capabilityProcedure` is a plain procedure, which is faithful:
 *    the real one asserts no key, it only attaches `ctx.capabilities`.
 *  - `@auxx/lib/cache` — `findCachedResource` (the def-id resolver) and the user
 *    settings cache. `@auxx/lib/permissions` — the barrel hangs under vitest.
 *  - `@auxx/lib/resources` / `@auxx/lib/settings` / `@auxx/lib/resource-access` —
 *    the write side effects under observation.
 */

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const SIGNATURE_DEF_ID = 'edf_signature0000000000000000'

/** The caller's own signature — they hold the owner `admin` row. */
const MINE = 'sig_mine00000000000000000000'
/** Shared WITH the caller at whatever tier a case asks for. */
const SHARED = 'sig_shared000000000000000000'
/** Another member's private signature: a row exists in the org, none for us. */
const OTHERS = 'sig_others000000000000000000'
/** A signature nobody authored a row for — the other absent-row arm. */
const ROWLESS = 'sig_rowless00000000000000000'
/** Not in this org at all. Must 404, never 403. */
const FOREIGN = 'sig_foreignorg00000000000000'

const { cache, crud, settings, resourceAccess } = vi.hoisted(() => ({
  cache: {
    findCachedResource: vi.fn(async () => ({
      entityDefinitionId: 'edf_signature0000000000000000',
    })),
    userSettings: { value: {} as Record<string, unknown> },
    onCacheEvent: vi.fn(async () => undefined),
  },
  crud: {
    create: vi.fn(async () => ({ instance: { id: 'sig_new00000000000000000000' } })),
    update: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  },
  settings: { updateUserSetting: vi.fn(async () => undefined) },
  resourceAccess: { emitResourceAccessInstanceChanged: vi.fn(async () => undefined) },
}))

const NEW_ID = 'sig_new00000000000000000000'

vi.mock('@auxx/lib/cache', () => ({
  findCachedResource: cache.findCachedResource,
  onCacheEvent: cache.onCacheEvent,
  getUserCache: () => ({ get: async () => cache.userSettings.value }),
}))

vi.mock('@auxx/lib/resources', () => ({
  UnifiedCrudHandler: class {
    create = crud.create
    update = crud.update
    delete = crud.delete
  },
}))

vi.mock('@auxx/lib/settings', () => ({ updateUserSetting: settings.updateUserSetting }))

vi.mock('@auxx/lib/resource-access', () => ({
  emitResourceAccessInstanceChanged: resourceAccess.emitResourceAccessInstanceChanged,
}))

// The `@auxx/lib/permissions` barrel reaches redis/db at import time and hangs
// under vitest (HANDOFF standing gotcha). Hand back the real registry.
vi.mock('@auxx/lib/permissions', async () => {
  const registry = await import('@auxx/lib/permissions/capabilities/registry')
  return { PermissionKey: registry.PermissionKey }
})

vi.mock('~/server/api/trpc', async () => {
  const { initTRPC } = await import('@trpc/server')
  const t = initTRPC.context<Record<string, unknown>>().create()
  return { createTRPCRouter: t.router, capabilityProcedure: t.procedure }
})

// Deep path on purpose — see the barrel note above.
const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { signatureRouter } = await import('./signature')

/** AuxxError, wrapped by tRPC as `cause`; the app's middleware maps it to 403. */
const FORBIDDEN = { cause: { name: 'ForbiddenError', statusCode: 403 } }
/** `assertSignatureAccess` 404s an unresolvable id BEFORE the capability check. */
const NOT_FOUND = { cause: { name: 'NotFoundError', statusCode: 404 } }

// ─────────────────────────────────────────────────────────────────────────────
// The fake database
// ─────────────────────────────────────────────────────────────────────────────

interface Instance {
  id: string
  displayName: string | null
  createdById: string | null
}

const ALL_INSTANCES: Instance[] = [
  { id: MINE, displayName: 'Mine', createdById: USER_ID },
  { id: SHARED, displayName: 'Shared', createdById: 'usr_other000000000000000000' },
  { id: OTHERS, displayName: 'Theirs', createdById: 'usr_other000000000000000000' },
  { id: ROWLESS, displayName: 'Rowless', createdById: 'usr_other000000000000000000' },
]

const FIELD_ROWS = ALL_INSTANCES.flatMap((i) => [
  { entityId: i.id, attribute: 'signature_name', value: `${i.displayName} signature` },
  { entityId: i.id, attribute: 'signature_body', value: `<p>${i.displayName} body</p>` },
])

const dialect = new PgDialect()

/**
 * A query-builder stand-in that actually APPLIES the router's `WHERE` to the
 * fixture, by compiling the drizzle `SQL` and reading its bound params.
 *
 * Dumb row-returning fakes cannot tell a filtered list from an unfiltered one,
 * which is precisely the property `list` has to have — so the filter is executed
 * here rather than assumed. It also gives `resolveSignatureId` a real existence
 * check, so the 404-before-403 cases are genuine.
 */
function fakeDb(instances: Instance[] = ALL_INSTANCES) {
  const captured: { where: unknown[]; inserted: unknown[]; deleted: number } = {
    where: [],
    inserted: [],
    deleted: 0,
  }

  const applyInstanceFilter = (whereSql: unknown): Instance[] => {
    const { sql: text, params } = dialect.sqlToQuery(whereSql as never)
    captured.where.push({ text, params })
    const idParams = new Set(
      (params as unknown[]).filter((p): p is string => typeof p === 'string')
    )
    const named = instances.filter((i) => idParams.has(i.id))
    // `not in` ⇒ an exclude scope; ids present at all ⇒ an include scope or a
    // single-row lookup; neither ⇒ the unfiltered org list.
    if (/not in/i.test(text)) return instances.filter((i) => !idParams.has(i.id))
    if (named.length > 0) return named
    // An id was asked for that does not exist here (foreign org / deleted).
    if (/"id" = \$/.test(text) || /in \(/i.test(text)) return []
    return instances
  }

  const build = () => {
    let table: unknown
    const chain: Record<string, unknown> = {
      from(t: unknown) {
        table = t
        return chain
      },
      innerJoin: () => chain,
      where(cond: unknown) {
        if (table === schema.FieldValue) {
          const { params } = dialect.sqlToQuery(cond as never)
          const ids = new Set((params as unknown[]).filter((p) => typeof p === 'string'))
          return Promise.resolve(FIELD_ROWS.filter((r) => ids.has(r.entityId)))
        }
        const rows = applyInstanceFilter(cond)
        const pending = Promise.resolve(rows) as Promise<Instance[]> & {
          limit: () => Promise<Instance[]>
          orderBy: () => Promise<Instance[]>
        }
        pending.limit = () => Promise.resolve(rows.slice(0, 1))
        pending.orderBy = () => Promise.resolve(rows)
        return pending
      },
    }
    return chain
  }

  return {
    captured,
    select: build,
    insert: () => ({
      values: (v: unknown) => {
        captured.inserted.push(v)
        return { onConflictDoNothing: async () => undefined }
      },
    }),
    delete: () => ({
      where: async () => {
        captured.deleted += 1
      },
    }),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The capability set
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A real `CapabilitySet` for a member of an org whose signatures all carry rows.
 *
 * `restricted` defaults to every signature EXCEPT {@link ROWLESS}: under
 * `baselineAtCreate: true` every signature gets an owner `admin` row at create,
 * so the org-wide `restrictedInstanceIds` set really does contain other members'
 * private signatures — and `instanceAccess` simply has no entry for them. That
 * is the first absent-row arm; `ROWLESS` (in neither set) is the second.
 */
function capabilitiesFor(
  opts: {
    instances?: Record<string, ResourcePermission>
    restricted?: string[]
    area?: Level
    role?: 'OWNER' | 'ADMIN' | 'USER'
    seatType?: 'full' | 'worker'
  } = {}
) {
  const instances = opts.instances ?? {}
  const restricted = opts.restricted ?? [MINE, SHARED, OTHERS]
  const seatType = opts.seatType ?? 'full'
  // Reproduce `deriveInstanceReadKeys`: any ≥`view` signature row synthesizes
  // `signaturesView` (Read rung ONLY — never `signaturesManage`), clamped away
  // on a worker seat since `signatures` is outside WORKER_AREAS.
  const derived =
    seatType !== 'worker' &&
    Object.values(instances).some((p) => p !== undefined && p !== ResourcePermission.none)
      ? [PermissionKey.signaturesView]
      : []
  return new CapabilitySet(
    new Set(expandLevelsToKeys({ [Area.signatures]: opts.area ?? Level.Full })),
    {},
    opts.role ?? 'USER',
    seatType,
    undefined,
    undefined,
    undefined,
    instances,
    new Set(restricted),
    undefined,
    new Set(derived)
  )
}

function caller(
  capabilities: InstanceType<typeof CapabilitySet>,
  db: ReturnType<typeof fakeDb> = fakeDb()
) {
  return signatureRouter.createCaller({
    db,
    capabilities,
    headers: new Headers(),
    session: {
      organizationId: ORG_ID,
      userId: USER_ID,
      user: { id: USER_ID, defaultOrganizationId: ORG_ID },
    },
  } as never)
}

type Caller = ReturnType<typeof caller>

/** Sugar: a member holding exactly `permission` on {@link MINE}. */
const holding = (permission: ResourcePermission, area = Level.Full) =>
  capabilitiesFor({ instances: { [MINE]: permission }, area })

beforeEach(() => {
  crud.create.mockReset()
  crud.create.mockResolvedValue({ instance: { id: NEW_ID } })
  crud.update.mockReset()
  crud.update.mockResolvedValue(undefined)
  crud.delete.mockReset()
  crud.delete.mockResolvedValue(undefined)
  settings.updateUserSetting.mockReset()
  settings.updateUserSetting.mockResolvedValue(undefined)
  resourceAccess.emitResourceAccessInstanceChanged.mockReset()
  resourceAccess.emitResourceAccessInstanceChanged.mockResolvedValue(undefined)
  cache.onCacheEvent.mockReset()
  cache.onCacheEvent.mockResolvedValue(undefined)
  cache.findCachedResource.mockReset()
  cache.findCachedResource.mockResolvedValue({ entityDefinitionId: SIGNATURE_DEF_ID })
  cache.userSettings.value = {}
})

// ─────────────────────────────────────────────────────────────────────────────

describe('signature router — the read tier (`get`, `getDefault`)', () => {
  it.each([
    ResourcePermission.view,
    ResourcePermission.edit,
    ResourcePermission.admin,
  ])('get succeeds at instance `%s`', async (permission) => {
    await expect(caller(holding(permission)).get({ id: MINE })).resolves.toMatchObject({
      id: MINE,
      name: 'Mine signature',
      body: '<p>Mine body</p>',
    })
  })

  it('get emits the SHARING recordId form, not a generic <defUuid>:<id>', async () => {
    // `resourceAccess.grantInstance` and the instance-share components key on
    // `signature:<id>` — the slug the ResourceAccess rows carry. Emitting the def
    // UUID here would silently break every share dialog.
    const result = await caller(holding(ResourcePermission.view)).get({ id: MINE })
    expect(result?.recordId).toBe(`signature:${MINE}`)
  })

  it('get is refused for an explicit `none` row even at area Full', async () => {
    await expect(caller(holding(ResourcePermission.none)).get({ id: MINE })).rejects.toMatchObject(
      FORBIDDEN
    )
  })

  it('getDefault returns the pointer only while it is still viewable', async () => {
    cache.userSettings.value = { 'signature.defaultId': SHARED }
    await expect(
      caller(capabilitiesFor({ instances: { [SHARED]: ResourcePermission.view } })).getDefault()
    ).resolves.toBe(SHARED)
  })

  it('getDefault degrades a now-unshared pointer to null instead of 403ing', async () => {
    // The composer asks for this on every render: an un-shared or deleted
    // signature must read as "no default", never as a mid-compose error.
    cache.userSettings.value = { 'signature.defaultId': OTHERS }
    await expect(caller(capabilitiesFor()).getDefault()).resolves.toBeNull()
  })

  it('getDefault is null when nothing is set', async () => {
    await expect(caller(holding(ResourcePermission.admin)).getDefault()).resolves.toBeNull()
  })
})

describe('signature router — the edit tier (`update`)', () => {
  it.each([
    ResourcePermission.edit,
    ResourcePermission.admin,
  ])('update succeeds at instance `%s`', async (permission) => {
    await expect(
      caller(holding(permission)).update({ id: MINE, name: 'Renamed' })
    ).resolves.toBeDefined()
    expect(crud.update).toHaveBeenCalledWith(`signature:${MINE}`, {
      signature_name: 'Renamed',
    })
  })

  it('update is refused at instance `view` — the read/write boundary', async () => {
    await expect(
      caller(holding(ResourcePermission.view)).update({ id: MINE, name: 'Renamed' })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(crud.update).not.toHaveBeenCalled()
  })

  it('update is refused with no row at all, at area Full', async () => {
    await expect(
      caller(capabilitiesFor()).update({ id: OTHERS, body: '<p>x</p>' })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(crud.update).not.toHaveBeenCalled()
  })

  it('update writes only the keys it was given', async () => {
    await caller(holding(ResourcePermission.edit)).update({ id: MINE, body: '<p>new</p>' })
    expect(crud.update).toHaveBeenCalledWith(`signature:${MINE}`, {
      signature_body: '<p>new</p>',
    })
  })
})

describe('signature router — the admin tier (`delete`)', () => {
  it('delete succeeds at instance `admin`', async () => {
    const db = fakeDb()
    await expect(
      caller(holding(ResourcePermission.admin), db).delete({ id: MINE })
    ).resolves.toEqual({ success: true })
    expect(crud.delete).toHaveBeenCalledWith(`signature:${MINE}`)
    // The ResourceAccess rows are not FK-cascaded by the instance delete.
    expect(db.captured.deleted).toBe(1)
  })

  it.each([
    ResourcePermission.edit,
    ResourcePermission.view,
  ])('delete is refused at instance `%s`', async (permission) => {
    await expect(caller(holding(permission)).delete({ id: MINE })).rejects.toMatchObject(FORBIDDEN)
    expect(crud.delete).not.toHaveBeenCalled()
  })

  it('delete clears the CALLER’s default pointer when it named this signature', async () => {
    cache.userSettings.value = { 'signature.defaultId': MINE }
    await caller(holding(ResourcePermission.admin)).delete({ id: MINE })
    expect(settings.updateUserSetting).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'signature.defaultId', value: null, userId: USER_ID })
    )
  })

  it('delete leaves an unrelated default pointer alone', async () => {
    cache.userSettings.value = { 'signature.defaultId': SHARED }
    await caller(holding(ResourcePermission.admin)).delete({ id: MINE })
    expect(settings.updateUserSetting).not.toHaveBeenCalled()
  })
})

describe('signature router — `create` rides the coarse `signaturesManage` rung', () => {
  /** The just-created instance, as a subsequent `loadSignature` would read it. */
  const withNewRow = () =>
    fakeDb([...ALL_INSTANCES, { id: NEW_ID, displayName: 'New', createdById: USER_ID }])

  it('succeeds at area Full', async () => {
    await expect(
      caller(capabilitiesFor({ area: Level.Full }), withNewRow()).create({
        name: 'New',
        body: '<p>b</p>',
      })
    ).resolves.toMatchObject({ id: NEW_ID })
    expect(crud.create).toHaveBeenCalledWith('signature', {
      signature_name: 'New',
      signature_body: '<p>b</p>',
    })
  })

  it.each([Level.Edit, Level.Read, Level.None])('is refused at area level %s', async (area) => {
    await expect(
      caller(capabilitiesFor({ area })).create({ name: 'New', body: '<p>b</p>' })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(crud.create).not.toHaveBeenCalled()
  })

  it('one instance `admin` grant does NOT front-door create', async () => {
    // `deriveInstanceReadKeys` synthesizes the Read rung only, regardless of
    // grant strength — precisely so a share cannot confer `signaturesManage`.
    await expect(
      caller(
        capabilitiesFor({ area: Level.None, instances: { [MINE]: ResourcePermission.admin } })
      ).create({ name: 'New', body: '<p>b</p>' })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(crud.create).not.toHaveBeenCalled()
  })

  it('writes the owner `admin` ResourceAccess row — the whole meaning of baselineAtCreate', async () => {
    // Without this row the creator cannot see their OWN new signature: every read
    // path is gated on it and there is no area fallback for a private resource.
    const db = fakeDb()
    await caller(capabilitiesFor({ area: Level.Full }), db).create({
      name: 'New',
      body: '<p>b</p>',
    })
    expect(db.captured.inserted).toEqual([
      expect.objectContaining({
        organizationId: ORG_ID,
        entityDefinitionId: 'signature',
        entityInstanceId: NEW_ID,
        granteeType: ResourceGranteeType.user,
        granteeId: USER_ID,
        permission: ResourcePermission.admin,
        grantedById: USER_ID,
      }),
    ])
  })

  it('does NOT write a `role:org_member` baseline row — private is the posture', async () => {
    const db = fakeDb()
    await caller(capabilitiesFor({ area: Level.Full }), db).create({
      name: 'New',
      body: '<p>b</p>',
    })
    for (const row of db.captured.inserted) {
      expect((row as { granteeType: string }).granteeType).not.toBe(ResourceGranteeType.role)
    }
  })

  it('invalidates the creator’s composed capabilities', async () => {
    // Without the event the creator's cached blob predates the row and they
    // cannot see their own signature until the TTL expires.
    await caller(capabilitiesFor({ area: Level.Full })).create({ name: 'N', body: '<p>b</p>' })
    expect(resourceAccess.emitResourceAccessInstanceChanged).toHaveBeenCalledWith(ORG_ID, [
      { granteeType: ResourceGranteeType.user, granteeId: USER_ID },
    ])
  })
})

describe('signature router — `setDefault` asserts `view`, deliberately (§12.2)', () => {
  it('succeeds at instance `view` on a signature shared with the caller', async () => {
    // The wave-3 note: gating this at `edit` would make every SHARED signature
    // un-defaultable, and the write touches only the caller's own row.
    await expect(
      caller(capabilitiesFor({ instances: { [SHARED]: ResourcePermission.view } })).setDefault({
        id: SHARED,
      })
    ).resolves.toEqual({ success: true })
    expect(settings.updateUserSetting).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        organizationId: ORG_ID,
        key: 'signature.defaultId',
        value: SHARED,
      })
    )
  })

  it('is refused for a signature the caller cannot view', async () => {
    await expect(caller(capabilitiesFor()).setDefault({ id: OTHERS })).rejects.toMatchObject(
      FORBIDDEN
    )
    expect(settings.updateUserSetting).not.toHaveBeenCalled()
  })

  it('is refused for an explicit `none` row', async () => {
    await expect(
      caller(holding(ResourcePermission.none)).setDefault({ id: MINE })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(settings.updateUserSetting).not.toHaveBeenCalled()
  })

  it('clearing with null needs no target and asserts nothing', async () => {
    await expect(
      caller(capabilitiesFor({ area: Level.None })).setDefault({ id: null })
    ).resolves.toEqual({ success: true })
    expect(settings.updateUserSetting).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'signature.defaultId', value: null })
    )
  })
})

describe('signature router — `baselineAtCreate: true`: absent row ⇒ NO access', () => {
  it('area Full does not reach another member’s private signature (row exists, not ours)', async () => {
    // Arm 1: `restrictedInstanceIds` HAS the id, `instanceAccess` does not →
    // `effectiveInstanceLevel` returns `undefined`. This is the arm that breaks
    // if anyone flips `signature` to `baselineAtCreate: false`.
    const caps = capabilitiesFor({ area: Level.Full })
    await expect(caller(caps).get({ id: OTHERS })).rejects.toMatchObject(FORBIDDEN)
    await expect(caller(caps).update({ id: OTHERS, name: 'x' })).rejects.toMatchObject(FORBIDDEN)
    await expect(caller(caps).delete({ id: OTHERS })).rejects.toMatchObject(FORBIDDEN)
  })

  it('area Full does not reach a signature with NO row anywhere', async () => {
    // Arm 2: the id is in neither set, so the answer comes from
    // `instanceFallbackLevel` — which returns `undefined` for a
    // `baselineAtCreate: true` resource no matter how open the area is.
    const caps = capabilitiesFor({ area: Level.Full })
    await expect(caller(caps).get({ id: ROWLESS })).rejects.toMatchObject(FORBIDDEN)
    await expect(caller(caps).setDefault({ id: ROWLESS })).rejects.toMatchObject(FORBIDDEN)
  })

  it('an explicit row beats area `None` — this is what sharing IS', async () => {
    const caps = capabilitiesFor({
      area: Level.None,
      instances: { [SHARED]: ResourcePermission.edit },
    })
    await expect(caller(caps).get({ id: SHARED })).resolves.toMatchObject({ id: SHARED })
    await expect(caller(caps).update({ id: SHARED, name: 'x' })).resolves.toBeDefined()
    // …and reaches nothing else.
    await expect(caller(caps).get({ id: MINE })).rejects.toMatchObject(FORBIDDEN)
  })
})

describe('signature router — decision 0.5: a worker seat gets nothing', () => {
  it('is denied even on an instance it holds `admin` on', async () => {
    // `SEAT_CEILINGS.worker[signatures]` is None and that check sits ABOVE the
    // explicit-row branch, so owning the signature does not help.
    const worker = capabilitiesFor({
      seatType: 'worker',
      instances: { [MINE]: ResourcePermission.admin },
    })
    await expect(caller(worker).get({ id: MINE })).rejects.toMatchObject(FORBIDDEN)
    await expect(caller(worker).update({ id: MINE, name: 'x' })).rejects.toMatchObject(FORBIDDEN)
    await expect(caller(worker).delete({ id: MINE })).rejects.toMatchObject(FORBIDDEN)
  })

  it('list returns [] WITHOUT querying', async () => {
    const worker = capabilitiesFor({
      seatType: 'worker',
      instances: { [MINE]: ResourcePermission.admin },
    })
    const db = fakeDb()
    await expect(caller(worker, db).list()).resolves.toEqual([])
    expect(db.captured.where).toHaveLength(0)
  })
})

/**
 * §0.6, as REVISED on 2026-07-28: no ADMIN override — and no OWNER bypass either,
 * for a `baselineAtCreate: true` resource.
 *
 * `effectiveInstanceLevel`'s OWNER short-circuit is now scoped to
 * `!cfg.baselineAtCreate`, and `privateInstanceListScope` has no OWNER arm at all.
 * The reasoning is that §0.10's recovery guarantee protects the ability to repair
 * a mis-shaped profile, and reading a member's private signature is a different
 * power that org ownership does not confer. It is safe rather than a self-lock
 * because every signature writes its author an `admin` row at create — so an
 * owner reaches their OWN signatures through the ordinary row path and nothing
 * else, exactly like every other member.
 *
 * Both halves are pinned: the denial (which is the new behavior) and the
 * own-content path (which is what makes the denial survivable).
 */
describe('signature router — §0.6 revised: neither ADMIN nor OWNER bypasses', () => {
  it('an org ADMIN is denied on another member’s private signature', async () => {
    const admin = capabilitiesFor({ role: 'ADMIN', area: Level.Full })
    await expect(caller(admin).get({ id: OTHERS })).rejects.toMatchObject(FORBIDDEN)
    await expect(caller(admin).delete({ id: OTHERS })).rejects.toMatchObject(FORBIDDEN)
  })

  it('an org ADMIN’s list is filtered exactly like any other member’s', async () => {
    const admin = capabilitiesFor({
      role: 'ADMIN',
      area: Level.Full,
      instances: { [MINE]: ResourcePermission.admin },
    })
    const result = await caller(admin).list()
    expect(result.map((s: { id: string }) => s.id)).toEqual([MINE])
  })

  it('the OWNER is ALSO denied on another member’s private signature', async () => {
    // The 2026-07-28 revision. If the bypass ever loses its `!baselineAtCreate`
    // qualifier, this case is the tripwire.
    const owner = capabilitiesFor({ role: 'OWNER', area: Level.Full, instances: {} })
    await expect(caller(owner).get({ id: OTHERS })).rejects.toMatchObject(FORBIDDEN)
    await expect(caller(owner).update({ id: OTHERS, name: 'x' })).rejects.toMatchObject(FORBIDDEN)
    await expect(caller(owner).delete({ id: OTHERS })).rejects.toMatchObject(FORBIDDEN)
  })

  it('…and the OWNER’s list is an allow-list too, not "everything"', async () => {
    const owner = capabilitiesFor({
      role: 'OWNER',
      area: Level.Full,
      instances: { [MINE]: ResourcePermission.admin },
    })
    const result = await caller(owner).list()
    expect(result.map((s: { id: string }) => s.id)).toEqual([MINE])
  })

  it('an OWNER with no rows at all sees nothing — no `exclude` arm exists', async () => {
    const owner = capabilitiesFor({ role: 'OWNER', area: Level.Full, instances: {} })
    const db = fakeDb()
    await expect(caller(owner, db).list()).resolves.toEqual([])
    expect(db.captured.where).toHaveLength(0)
  })

  it('the OWNER still reaches their OWN signature, through the ordinary row path', async () => {
    // What makes the denial survivable rather than a self-lock: `create` writes
    // the author an `admin` row, so an owner needs no bypass for their own work.
    const owner = capabilitiesFor({
      role: 'OWNER',
      area: Level.Full,
      instances: { [MINE]: ResourcePermission.admin },
    })
    await expect(caller(owner).get({ id: MINE })).resolves.toMatchObject({ id: MINE })
    await expect(caller(owner).delete({ id: MINE })).resolves.toEqual({ success: true })
  })

  it('an OWNER on a WORKER seat is denied on their own signature', async () => {
    // The seat ceiling now precedes the bypass for these resources, matching
    // `composeUserCapabilities` — an owner clamped in one composer and waved
    // through in the other is the drift this ordering removes.
    const owner = capabilitiesFor({
      role: 'OWNER',
      seatType: 'worker',
      instances: { [MINE]: ResourcePermission.admin },
    })
    await expect(caller(owner).get({ id: MINE })).rejects.toMatchObject(FORBIDDEN)
    await expect(caller(owner).list()).resolves.toEqual([])
  })
})

describe('signature router — 404 before 403 (a foreign-org id is indistinguishable)', () => {
  const CALLS: [string, (c: Caller, id: string) => Promise<unknown>][] = [
    ['get', (c, id) => c.get({ id })],
    ['update', (c, id) => c.update({ id, name: 'x' })],
    ['delete', (c, id) => c.delete({ id })],
    ['setDefault', (c, id) => c.setDefault({ id })],
  ]

  it.each(CALLS)('%s 404s a foreign-org id for a fully-granted caller', async (_n, call) => {
    await expect(
      call(
        caller(
          capabilitiesFor({ area: Level.Full, instances: { [MINE]: ResourcePermission.admin } })
        ),
        FOREIGN
      )
    ).rejects.toMatchObject(NOT_FOUND)
  })

  it.each(CALLS)('%s 404s a foreign-org id for a caller holding nothing', async (_n, call) => {
    // Both directions matter: if the capability check ran first, a member would
    // get 403 for an id that exists elsewhere and 404 for one that does not —
    // an existence oracle across orgs.
    await expect(
      call(caller(capabilitiesFor({ area: Level.None })), FOREIGN)
    ).rejects.toMatchObject(NOT_FOUND)
  })

  it('an org with no seeded signature def 404s rather than leaking', async () => {
    cache.findCachedResource.mockResolvedValue(undefined as never)
    await expect(
      caller(capabilitiesFor({ instances: { [MINE]: ResourcePermission.admin } })).get({ id: MINE })
    ).rejects.toMatchObject(NOT_FOUND)
  })
})

describe('signature router — `list` FILTERS, and filters in SQL before pagination', () => {
  it('a member sees only the signatures shared with them', async () => {
    const result = await caller(
      capabilitiesFor({
        instances: { [MINE]: ResourcePermission.admin, [SHARED]: ResourcePermission.view },
      })
    ).list()
    expect(result.map((s: { id: string }) => s.id)).toEqual([MINE, SHARED])
  })

  it('an explicit `none` row is not in the list even at area Full', async () => {
    const result = await caller(
      capabilitiesFor({
        area: Level.Full,
        instances: { [MINE]: ResourcePermission.admin, [SHARED]: ResourcePermission.none },
      })
    ).list()
    expect(result.map((s: { id: string }) => s.id)).toEqual([MINE])
  })

  it('a member with no grants gets [] instead of a 403', async () => {
    // The shape all five `*.list` precedents settled on: a server-warmed page
    // render must not blow up for a member holding nothing.
    await expect(caller(capabilitiesFor({ area: Level.Full })).list()).resolves.toEqual([])
  })

  it('the filter is pushed into the WHERE clause, not applied after the fetch', async () => {
    // Post-fetch filtering returns the same rows here but shorts every page once
    // `list` grows a limit — so the compiled SQL is the assertion, not the rows.
    const db = fakeDb()
    await caller(capabilitiesFor({ instances: { [MINE]: ResourcePermission.view } }), db).list()
    const instanceWhere = db.captured.where[0] as { text: string; params: unknown[] }
    expect(instanceWhere.text).toMatch(/ in \(/i)
    expect(instanceWhere.params).toContain(MINE)
    expect(instanceWhere.params).not.toContain(OTHERS)
  })

  it('hydrates name and body from FieldValue, falling back to displayName', async () => {
    const result = await caller(
      capabilitiesFor({ instances: { [MINE]: ResourcePermission.view } })
    ).list()
    expect(result[0]).toMatchObject({
      id: MINE,
      recordId: `signature:${MINE}`,
      name: 'Mine signature',
      body: '<p>Mine body</p>',
      createdById: USER_ID,
    })
  })
})
