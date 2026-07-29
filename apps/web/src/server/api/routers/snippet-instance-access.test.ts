// apps/web/src/server/api/routers/snippet-instance-access.test.ts

import fs from 'node:fs'
import path from 'node:path'
import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import type { OrganizationRole, SeatType } from '@auxx/database/types'
import { PermissionKey } from '@auxx/lib/permissions/capabilities/registry'
import { SEAT_CEILINGS } from '@auxx/lib/permissions/capabilities/seat-policy'
import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 36 §10 — the snippet router at the tier boundary, driven for real.
 *
 * Before this slice **every procedure in `snippet.ts` was a bare
 * `protectedProcedure` reading zero capabilities** (plan 36 §1.1), and
 * `updateFolder` / `deleteFolder` checked org scope and nothing else — so any
 * member could rename or cascade-delete any folder in the org. That is a live
 * privilege hole, not a hardening exercise, and the folder block below is the
 * regression net for it.
 *
 * These are behavioral tests: the router module is imported for real and driven
 * through a tRPC caller whose `ctx.capabilities` is a **real** `CapabilitySet`,
 * so the assert methods are the shipped ones. Deleting or weakening an assert
 * makes the matching "refused" case fail, because the mocked `@auxx/lib/snippets`
 * helper would then be reached.
 *
 * The tier map under test (plan 36 §6):
 *
 * | procedure                                  | gate                            |
 * |--------------------------------------------|---------------------------------|
 * | `all`, `getFolders`                        | FILTER, never 403               |
 * | `byId`, `incrementUsage`                   | `assertViewInstance('snippet')`  |
 * | `update`                                   | `assertEditInstance('snippet')`  |
 * | `delete`                                   | `assertAdminInstance('snippet')` |
 * | `create`, `createFolder`, `updateFolder`, `deleteFolder` | `snippetsManage`  |
 *
 * Mocked, and why:
 *  - `~/server/api/trpc` — the real module pulls auth/db/redis/rate-limiter at
 *    import time. The stand-in is a plain tRPC instance whose procedures pass the
 *    test ctx through untouched. A downgrade of the builder itself is caught by
 *    the structural block at the bottom (the mock exports `protectedProcedure`
 *    for `resourceAccess.ts`'s benefit, so "it still compiles" proves nothing —
 *    hence the explicit source pin).
 *  - `@auxx/lib/snippets` — the side effect under observation: "was the query or
 *    the write reached?" is the whole assertion. `create` is the one exception:
 *    it is re-pointed at the REAL `createSnippet` for the owner-row case, because
 *    a mock cannot show what got inserted.
 *  - `@auxx/lib/permissions` (barrel) + the resource-access/audit modules —
 *    only for the `resourceAccess.grantInstance` block, which is where snippet
 *    SHARING lives now that `snippet.share` is deleted.
 */

/** `Result`-shaped stand-ins: the router calls `.isErr()` / `.isOk()` / `.value`. */
const { snippets, listFixture } = vi.hoisted(() => {
  const okResult = <T>(value: T) => ({ isOk: () => true, isErr: () => false, value })
  /** The org's snippets, as the query would see them before scoping. */
  const listFixture: { ids: string[] } = { ids: [] }

  type Scope = {
    kind: 'none' | 'include' | 'exclude'
    includeIds?: string[]
    excludeIds?: string[]
  }

  return {
    listFixture,
    snippets: {
      /**
       * Stands in for `listSnippetsForUser`, reproducing the ONE property its
       * contract rests on: the `InstanceListScope` is applied to the id set
       * BEFORE anything is returned (the real helper pushes it into the SQL
       * `WHERE`). A mock that ignored `scope` would let a router that stopped
       * passing it still pass.
       */
      listSnippetsForUser: vi.fn(
        async (
          _db: unknown,
          _organizationId: string,
          _userId: string,
          scope: Scope,
          _filters: unknown
        ) => {
          const visible =
            scope.kind === 'none'
              ? []
              : scope.kind === 'include'
                ? listFixture.ids.filter((id) => (scope.includeIds ?? []).includes(id))
                : listFixture.ids.filter((id) => !(scope.excludeIds ?? []).includes(id))
          return okResult(visible.map((id) => ({ id })))
        }
      ),
      getSnippetWithShares: vi.fn(async () => okResult({ snippet: { id: 'snip_1', shares: [] } })),
      createSnippet: vi.fn(async () => okResult({ id: 'snip_new' })),
      updateSnippet: vi.fn(async () => okResult({ id: 'snip_1' })),
      deleteSnippet: vi.fn(async () => okResult(undefined)),
      incrementSnippetUsage: vi.fn(async () => okResult(undefined)),
      listSnippetFoldersWithCounts: vi.fn(async () =>
        okResult([{ id: 'fld_1', name: 'A', _count: { snippets: 0 } }])
      ),
      createSnippetFolder: vi.fn(async () => okResult({ id: 'fld_new' })),
      updateSnippetFolder: vi.fn(async () => okResult({ id: 'fld_1' })),
      deleteSnippetFolderWithCascade: vi.fn(async () => okResult(undefined)),
    },
  }
})

vi.mock('@auxx/lib/snippets', () => snippets)

/** Shared by `snippet-mutations` (the real `createSnippet`) and `resourceAccess.ts`. */
const { resourceAccess, isAdminOrOwner, recordAuditFromCtx, getCapabilities } = vi.hoisted(() => ({
  resourceAccess: {
    emitResourceAccessInstanceChanged: vi.fn(async () => undefined),
    grantInstanceAccess: vi.fn(async () => undefined),
    setInstanceAccess: vi.fn(async () => undefined),
    revokeInstanceAccess: vi.fn(async () => true),
    grantTypeAccess: vi.fn(async () => undefined),
    setTypeAccess: vi.fn(async () => undefined),
    revokeTypeAccess: vi.fn(async () => true),
    getInstanceAccess: vi.fn(async () => []),
    getTypeAccess: vi.fn(async () => []),
    getAllInstanceAccess: vi.fn(async () => []),
    getAllTypeAccess: vi.fn(async () => []),
    checkAccess: vi.fn(async () => true),
    checkTypeAccess: vi.fn(async () => true),
    assertCanManageMailSharing: vi.fn(async () => undefined),
    assertCanManageMailTypeAccess: vi.fn(async () => undefined),
    assertMailSharingFeature: vi.fn(async () => undefined),
    isMailSharingDef: vi.fn(() => false),
  },
  isAdminOrOwner: vi.fn(async () => false),
  recordAuditFromCtx: vi.fn(async () => undefined),
  getCapabilities: vi.fn(),
}))

vi.mock('@auxx/lib/resource-access', () => resourceAccess)
vi.mock('@auxx/lib/members', () => ({ isAdminOrOwner }))
vi.mock('~/server/api/audit-context', () => ({ recordAuditFromCtx }))
vi.mock('@auxx/lib/cache', () => ({
  // `grantee-schema.ts` stays real — it decides which grantee kinds are legal.
  getCachedPermissionProfiles: vi.fn(async () => []),
}))

// The `@auxx/lib/permissions` barrel reaches redis/db at import time and hangs
// under vitest. Re-export the REAL instance-access registry (it is what decides
// that `snippet:` is an instance-access target at all) and stub only capability
// resolution.
vi.mock('@auxx/lib/permissions', async () => {
  const instanceAccess = await import('@auxx/lib/permissions/capabilities/instance-access')
  const types = await import('@auxx/lib/permissions/types')
  return {
    ...instanceAccess,
    FeatureKey: types.FeatureKey,
    FeaturePermissionService: class {
      requireAccess = vi.fn(async () => undefined)
    },
    getCapabilities,
  }
})

vi.mock('~/server/api/trpc', async () => {
  const { initTRPC } = await import('@trpc/server')
  const t = initTRPC.context<Record<string, unknown>>().create()
  return {
    createTRPCRouter: t.router,
    capabilityProcedure: t.procedure,
    protectedProcedure: t.procedure,
  }
})

// Deep path on purpose: the permissions barrel hangs under vitest and
// `CapabilitySet` is not on the client-safe subpath. Test files are excluded from
// apps/web's tsconfig, so this stays a test-only affordance.
const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { createSnippet: realCreateSnippet } = await import('@auxx/lib/snippets/snippet-mutations')
const { snippetsRouter } = await import('./snippet')
const { resourceAccessRouter } = await import('./resourceAccess')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const SNIPPET_ID = 'snip_cuid00000000000000000000'
const SNIPPET_RECORD_ID = `snippet:${SNIPPET_ID}`
/** A snippet belonging to another member — or to another org. Indistinguishable, by design. */
const FOREIGN_ID = 'snip_foreigncuid000000000000'
const FOLDER_ID = 'fld_cuid000000000000000000000'

/** Every procedure the router exposes, sorted. Exhaustive on purpose. */
const PROCEDURES = [
  'all',
  'byId',
  'create',
  'createFolder',
  'delete',
  'deleteFolder',
  'getFolders',
  'incrementUsage',
  'update',
  'updateFolder',
]

/**
 * The capability asserts throw `AuxxError` (never `TRPCError`) — tRPC wraps that
 * as `cause`, and in the app `auxxErrorMiddleware` + `errorFormatter` map it onto
 * the HTTP status asserted here. Asserting the STATUS, not merely "it rejected":
 * a denial that surfaces as a 500 is a different (and worse) outcome.
 */
const FORBIDDEN = { cause: { name: 'ForbiddenError', statusCode: 403 } }
const NOT_FOUND = { cause: { name: 'NotFoundError', statusCode: 404 } }

interface CapsOpts {
  role?: OrganizationRole
  seatType?: SeatType
  /** The member's Layer-2 `Area.snippets` level. Defaults to the seeded Member baseline. */
  areaLevel?: Level
  /** Explicit `ResourceAccess` instance rows reaching this member. */
  instances?: Record<string, ResourcePermission>
  /** Read-rung keys the composer SYNTHESIZES from instance grants (front door only). */
  derivedKeys?: PermissionKey[]
}

/**
 * A real `CapabilitySet` for a member holding `permission` on {@link SNIPPET_ID}.
 *
 * The area defaults to `Full` — the seeded Member baseline (`MEMBER_BASELINE_LEVELS`)
 * — on purpose: for a `baselineAtCreate: true` resource the area level buys the
 * instance-LESS action and nothing else, so every per-instance case below runs
 * against the MOST privileged area a member can hold. A denial here is a denial
 * that no profile change can undo.
 */
function capabilitiesFor(permission: ResourcePermission | undefined, opts: CapsOpts = {}) {
  const instances = opts.instances ?? (permission === undefined ? {} : { [SNIPPET_ID]: permission })
  const seatType = opts.seatType ?? 'full'
  // `CapabilitySet` is handed an ALREADY seat-clamped key set — the `min` against
  // `SEAT_CEILINGS` happens in `composeUserCapabilities`, upstream. Reproduce it
  // here or a `worker` fixture would carry `snippetsManage`, which no real worker
  // seat can hold, and the folder cases below would be testing an impossible
  // member. (The per-INSTANCE gate does not depend on this — `effectiveInstanceLevel`
  // re-checks the ceiling explicitly — but the coarse `snippetsManage` gate does.)
  const areaLevel =
    SEAT_CEILINGS[seatType][Area.snippets] === Level.None
      ? Level.None
      : (opts.areaLevel ?? Level.Full)
  return new CapabilitySet(
    new Set(expandLevelsToKeys({ [Area.snippets]: areaLevel })),
    {},
    opts.role ?? 'MEMBER',
    seatType,
    undefined,
    undefined,
    undefined,
    instances,
    new Set(Object.keys(instances)),
    {},
    new Set(opts.derivedKeys ?? [])
  )
}

function caller(capabilities: InstanceType<typeof CapabilitySet>, db: unknown = {}) {
  return snippetsRouter.createCaller({
    db,
    capabilities,
    session: {
      organizationId: ORG_ID,
      userId: USER_ID,
      user: { id: USER_ID, defaultOrganizationId: ORG_ID },
    },
  } as any)
}

type Caller = ReturnType<typeof caller>

/** `view`-tier procedures, with the minimum valid input and the helper they reach. */
const VIEW_TIER = [
  ['byId', (c: Caller) => c.byId({ id: SNIPPET_ID }), 'getSnippetWithShares'],
  ['incrementUsage', (c: Caller) => c.incrementUsage({ id: SNIPPET_ID }), 'incrementSnippetUsage'],
] as const

/** `edit`-tier procedures. */
const EDIT_TIER = [
  ['update', (c: Caller) => c.update({ id: SNIPPET_ID, title: 'rewritten' }), 'updateSnippet'],
] as const

/** `admin`-tier procedures. */
const ADMIN_TIER = [
  ['delete', (c: Caller) => c.delete({ id: SNIPPET_ID }), 'deleteSnippet'],
] as const

/** Every id-bearing procedure, at whatever tier — for the "no row at all" sweeps. */
const ID_BEARING = [...VIEW_TIER, ...EDIT_TIER, ...ADMIN_TIER] as const

/**
 * The instance-LESS procedures, gated on the area's Full rung
 * (`PermissionKey.snippetsManage`). The three folder mutations are here because
 * a folder is a flat org-wide label with no grants of its own (decision 0.4) —
 * there is no instance to key on.
 */
const MANAGE_TIER = [
  ['create', (c: Caller) => c.create({ title: 'T', content: 'C' }), 'createSnippet'],
  ['createFolder', (c: Caller) => c.createFolder({ name: 'Refunds' }), 'createSnippetFolder'],
  [
    'updateFolder',
    (c: Caller) => c.updateFolder({ id: FOLDER_ID, name: 'Renamed' }),
    'updateSnippetFolder',
  ],
  [
    'deleteFolder',
    (c: Caller) => c.deleteFolder({ id: FOLDER_ID }),
    'deleteSnippetFolderWithCascade',
  ],
] as const

beforeEach(() => {
  // `mockReset()`, not `mockClear()`: a `mockResolvedValueOnce`/
  // `mockImplementationOnce` queue survives `mockClear`, and a leftover
  // once-value shifts every later one — which makes a mutated source line look
  // caught when it is not (HANDOFF standing gotcha).
  for (const fn of Object.values(snippets)) fn.mockReset()
  snippets.listSnippetsForUser.mockImplementation(async (_d, _o, _u, scope: any) => {
    const visible =
      scope.kind === 'none'
        ? []
        : scope.kind === 'include'
          ? listFixture.ids.filter((id) => scope.includeIds.includes(id))
          : listFixture.ids.filter((id) => !scope.excludeIds.includes(id))
    return { isOk: () => true, isErr: () => false, value: visible.map((id) => ({ id })) }
  })
  snippets.getSnippetWithShares.mockResolvedValue({
    isOk: () => true,
    isErr: () => false,
    value: { snippet: { id: SNIPPET_ID, shares: [] } },
  } as any)
  snippets.createSnippet.mockResolvedValue({
    isOk: () => true,
    isErr: () => false,
    value: { id: 'snip_new' },
  } as any)
  snippets.updateSnippet.mockResolvedValue({
    isOk: () => true,
    isErr: () => false,
    value: { id: SNIPPET_ID },
  } as any)
  snippets.deleteSnippet.mockResolvedValue({
    isOk: () => true,
    isErr: () => false,
    value: undefined,
  } as any)
  snippets.incrementSnippetUsage.mockResolvedValue({
    isOk: () => true,
    isErr: () => false,
    value: undefined,
  } as any)
  snippets.listSnippetFoldersWithCounts.mockResolvedValue({
    isOk: () => true,
    isErr: () => false,
    value: [{ id: FOLDER_ID, name: 'A', _count: { snippets: 0 } }],
  } as any)
  snippets.createSnippetFolder.mockResolvedValue({
    isOk: () => true,
    isErr: () => false,
    value: { id: 'fld_new' },
  } as any)
  snippets.updateSnippetFolder.mockResolvedValue({
    isOk: () => true,
    isErr: () => false,
    value: { id: FOLDER_ID },
  } as any)
  snippets.deleteSnippetFolderWithCascade.mockResolvedValue({
    isOk: () => true,
    isErr: () => false,
    value: undefined,
  } as any)

  for (const fn of Object.values(resourceAccess)) fn.mockReset()
  resourceAccess.emitResourceAccessInstanceChanged.mockResolvedValue(undefined as never)
  resourceAccess.grantInstanceAccess.mockResolvedValue(undefined as never)
  resourceAccess.revokeInstanceAccess.mockResolvedValue(true as never)
  resourceAccess.assertCanManageMailSharing.mockResolvedValue(undefined as never)
  resourceAccess.assertMailSharingFeature.mockResolvedValue(undefined as never)
  resourceAccess.isMailSharingDef.mockReturnValue(false)
  isAdminOrOwner.mockReset()
  isAdminOrOwner.mockResolvedValue(false)
  recordAuditFromCtx.mockReset()
  recordAuditFromCtx.mockResolvedValue(undefined as never)
  getCapabilities.mockReset()
  listFixture.ids = []
})

describe('snippet router — the `view` tier', () => {
  it.each(VIEW_TIER)('%s succeeds at an instance `view` row', async (_n, call, helper) => {
    await expect(call(caller(capabilitiesFor(ResourcePermission.view)))).resolves.toBeDefined()
    expect(snippets[helper]).toHaveBeenCalledTimes(1)
  })

  it.each(VIEW_TIER)('%s succeeds at `edit` and `admin` too', async (_n, call, helper) => {
    for (const permission of [ResourcePermission.edit, ResourcePermission.admin] as const) {
      snippets[helper].mockClear()
      await expect(call(caller(capabilitiesFor(permission)))).resolves.toBeDefined()
      expect(snippets[helper]).toHaveBeenCalledTimes(1)
    }
  })

  it.each(VIEW_TIER)('%s is refused for an explicit `none` row', async (_n, call, helper) => {
    await expect(call(caller(capabilitiesFor(ResourcePermission.none)))).rejects.toMatchObject(
      FORBIDDEN
    )
    expect(snippets[helper]).not.toHaveBeenCalled()
  })

  it('byId’s `canEdit` flag is the SAME predicate `update` asserts on', async () => {
    // The flag drives the client's read-only affordances, so a hard-coded or
    // drifting value is how a viewer gets an edit button that then 403s. Resolve
    // it at each rung and require it to agree with what `update` actually does.
    for (const [permission, expected] of [
      [ResourcePermission.view, false],
      [ResourcePermission.edit, true],
      [ResourcePermission.admin, true],
    ] as const) {
      const caps = capabilitiesFor(permission)
      const result = await caller(caps).byId({ id: SNIPPET_ID })
      expect(result.canEdit, `canEdit at ${permission}`).toBe(expected)

      const update = caller(caps).update({ id: SNIPPET_ID, title: 'x' })
      if (expected) await expect(update).resolves.toBeDefined()
      else await expect(update).rejects.toMatchObject(FORBIDDEN)
    }
  })

  it('incrementUsage 403s on the ACCESS check rather than swallowing it', async () => {
    // The procedure is deliberately best-effort about the tracking write
    // (`{ success: result.isOk() }`), which makes it the easiest place to
    // accidentally swallow the denial too. A 403 here is a real answer.
    await expect(
      caller(capabilitiesFor(ResourcePermission.none)).incrementUsage({ id: SNIPPET_ID })
    ).rejects.toMatchObject(FORBIDDEN)
  })
})

describe('snippet router — the `edit` tier', () => {
  it.each(EDIT_TIER)('%s is refused at instance `view`', async (_n, call, helper) => {
    await expect(call(caller(capabilitiesFor(ResourcePermission.view)))).rejects.toMatchObject(
      FORBIDDEN
    )
    expect(snippets[helper]).not.toHaveBeenCalled()
  })

  it.each(EDIT_TIER)('%s succeeds at instance `edit`', async (_n, call, helper) => {
    await expect(call(caller(capabilitiesFor(ResourcePermission.edit)))).resolves.toBeDefined()
    expect(snippets[helper]).toHaveBeenCalledTimes(1)
  })

  it.each(EDIT_TIER)('%s succeeds at instance `admin`', async (_n, call, helper) => {
    await expect(call(caller(capabilitiesFor(ResourcePermission.admin)))).resolves.toBeDefined()
    expect(snippets[helper]).toHaveBeenCalledTimes(1)
  })
})

describe('snippet router — the `admin` tier', () => {
  it.each(ADMIN_TIER)('%s is refused at instance `view`', async (_n, call, helper) => {
    await expect(call(caller(capabilitiesFor(ResourcePermission.view)))).rejects.toMatchObject(
      FORBIDDEN
    )
    expect(snippets[helper]).not.toHaveBeenCalled()
  })

  it.each(ADMIN_TIER)('%s is refused at instance `edit`', async (_n, call, helper) => {
    // The tier that is easiest to get wrong: an `edit` grantee may rewrite the
    // snippet but must not be able to destroy it.
    await expect(call(caller(capabilitiesFor(ResourcePermission.edit)))).rejects.toMatchObject(
      FORBIDDEN
    )
    expect(snippets[helper]).not.toHaveBeenCalled()
  })

  it.each(ADMIN_TIER)('%s succeeds at instance `admin`', async (_n, call, helper) => {
    await expect(call(caller(capabilitiesFor(ResourcePermission.admin)))).resolves.toBeDefined()
    expect(snippets[helper]).toHaveBeenCalledTimes(1)
  })
})

describe('snippet router — `baselineAtCreate: true` means no row is no access', () => {
  it.each(
    ID_BEARING
  )('%s is refused with no instance row, even at snippets: Full', async (_n, call, helper) => {
    // The posture, at the router. `Area.snippets` is `Level.Full` on the seeded
    // Member baseline, and `instanceFallbackLevel` returns `undefined` for a
    // private resource — so the most privileged area a member can hold still
    // reaches nothing they were not granted.
    const caps = capabilitiesFor(undefined)
    expect(caps.areaLevel(Area.snippets)).toBe(Level.Full)
    await expect(call(caller(caps))).rejects.toMatchObject(FORBIDDEN)
    expect(snippets[helper]).not.toHaveBeenCalled()
  })

  it.each(
    ID_BEARING
  )('%s is refused on a FOREIGN id without revealing whether it exists', async (_n, call, helper) => {
    // Snippets deliberately do NOT resolve the id before deciding (see
    // `snippet-instance-access.ts`): a foreign-org id, a deleted id and another
    // member's private id are one answer — 403, with no DB read at all. The
    // 404-before-403 dance the identifier-resolving resources need exists to
    // reach this same indistinguishability; here it is structural.
    const caps = capabilitiesFor(undefined, {
      instances: { [SNIPPET_ID]: ResourcePermission.admin, [FOREIGN_ID]: ResourcePermission.none },
    })
    await expect(call(caller(caps))).resolves.toBeDefined()
    snippets[helper].mockClear()

    await expect((caller(caps) as any)[_n]({ id: FOREIGN_ID, title: 'x' })).rejects.toMatchObject(
      FORBIDDEN
    )
    // No query ran, so nothing about the row's existence could leak.
    expect(snippets[helper]).not.toHaveBeenCalled()
  })

  it('a grantee whose snippet has since been deleted gets 404, not a silent empty', async () => {
    // The complement: once access IS held, the identity check inside the query
    // still runs and surfaces as a 404. Without this the 403-always rule above
    // would be indistinguishable from "the router never 404s".
    snippets.getSnippetWithShares.mockResolvedValue({
      isOk: () => false,
      isErr: () => true,
      error: Object.assign(new Error('Snippet not found'), {
        name: 'NotFoundError',
        statusCode: 404,
      }),
    } as any)
    await expect(
      caller(capabilitiesFor(ResourcePermission.view)).byId({ id: SNIPPET_ID })
    ).rejects.toMatchObject(NOT_FOUND)
  })
})

describe('snippet router — role and seat short-circuits', () => {
  it.each(ID_BEARING)('%s: OWNER is DENIED with no row at all', async (_n, call, helper) => {
    // User decision 2026-07-28 (plan 36 §0.6 revised): the §0.10 bypass is scoped
    // to `baselineAtCreate: false`, so org ownership does not reach a member's
    // private snippet. §0.10 exists to keep a mis-shaped PROFILE repairable —
    // being locked out of someone else's scratch content does not threaten that.
    await expect(call(caller(capabilitiesFor(undefined, { role: 'OWNER' })))).rejects.toMatchObject(
      FORBIDDEN
    )
    expect(snippets[helper]).not.toHaveBeenCalled()
  })

  it.each(ID_BEARING)('%s: OWNER reaches a snippet they hold a row on', async (_n, call, h) => {
    // The control: removing the bypass is not a self-lock. `createSnippet` writes
    // the author an `admin` row in the same transaction, so an owner reaches
    // their OWN snippets through the ordinary row path.
    await expect(
      call(caller(capabilitiesFor(ResourcePermission.admin, { role: 'OWNER' })))
    ).resolves.toBeDefined()
    expect(snippets[h]).toHaveBeenCalledTimes(1)
  })

  it.each(ID_BEARING)('%s: an org ADMIN gets NO override (decision 0.6)', async (_n, call, h) => {
    const caps = capabilitiesFor(undefined, { role: 'ADMIN' })
    await expect(call(caller(caps))).rejects.toMatchObject(FORBIDDEN)
    expect(snippets[h]).not.toHaveBeenCalled()
  })

  it.each(
    ID_BEARING
  )('%s: a WORKER seat is denied on a snippet it owns (0.5)', async (_n, c, h) => {
    // `Area.snippets` is outside `WORKER_AREAS`, and the ceiling is checked above
    // the explicit-row branch — so an `admin` row on content the field tech
    // authored buys nothing. Intended; stated in `seat-policy.ts`.
    const caps = capabilitiesFor(ResourcePermission.admin, { seatType: 'worker' })
    await expect(c(caller(caps))).rejects.toMatchObject(FORBIDDEN)
    expect(snippets[h]).not.toHaveBeenCalled()
  })
})

describe('snippet router — the folder gate (plan 36 §6.3, a LIVE BUG FIX)', () => {
  /**
   * Before this slice `updateFolder` and `deleteFolder` were bare
   * `protectedProcedure`s that checked org scope and nothing else, so **any**
   * member could rename or cascade-delete **any** folder in the org
   * (`snippet-folder-mutations.ts:166`). These four cases are the regression net.
   */
  it.each(MANAGE_TIER)('%s is refused for a member with snippets: Read', async (_n, call, h) => {
    await expect(
      call(caller(capabilitiesFor(undefined, { areaLevel: Level.Read })))
    ).rejects.toMatchObject(FORBIDDEN)
    expect(snippets[h]).not.toHaveBeenCalled()
  })

  it.each(MANAGE_TIER)('%s is refused for a member with snippets: Edit', async (_n, call, h) => {
    // The rung that matters: `Edit` is not `Manage`. A member who may rewrite
    // shared snippet CONTENT still may not restructure the org's folder tree.
    await expect(
      call(caller(capabilitiesFor(undefined, { areaLevel: Level.Edit })))
    ).rejects.toMatchObject(FORBIDDEN)
    expect(snippets[h]).not.toHaveBeenCalled()
  })

  it.each(MANAGE_TIER)('%s is refused for a member with snippets: None', async (_n, call, h) => {
    await expect(
      call(caller(capabilitiesFor(undefined, { areaLevel: Level.None })))
    ).rejects.toMatchObject(FORBIDDEN)
    expect(snippets[h]).not.toHaveBeenCalled()
  })

  it.each(MANAGE_TIER)('%s succeeds at snippets: Full', async (_n, call, h) => {
    await expect(
      call(caller(capabilitiesFor(undefined, { areaLevel: Level.Full })))
    ).resolves.toBeDefined()
    expect(snippets[h]).toHaveBeenCalledTimes(1)
  })

  it.each(
    MANAGE_TIER
  )('%s is refused for an instance `admin` grantee with the area shut', async (_n, call, h) => {
    // The share-recipient escalation this closes. Their grant makes
    // `snippets.view` true through `instanceDerivedKeys` (the coarse front
    // door), and `admin` on the instance lets them delete THAT snippet — but
    // neither may reach the instance-LESS `snippetsManage` rung. Holding an
    // `admin` row on one snippet must not confer the org's folder tree.
    const caps = capabilitiesFor(ResourcePermission.admin, {
      areaLevel: Level.None,
      derivedKeys: [PermissionKey.snippetsView],
    })
    expect(caps.can(PermissionKey.snippetsView)).toBe(true)
    expect(caps.can(PermissionKey.snippetsManage)).toBe(false)
    await expect(call(caller(caps))).rejects.toMatchObject(FORBIDDEN)
    expect(snippets[h]).not.toHaveBeenCalled()
  })

  it('a worker seat cannot create a folder either', async () => {
    // `Area.snippets` is outside `WORKER_AREAS`, so the ceiling zeroes the area
    // and `snippetsManage` is unreachable for a field seat by construction.
    expect(SEAT_CEILINGS.worker[Area.snippets]).toBe(Level.None)
    await expect(
      caller(capabilitiesFor(undefined, { seatType: 'worker' })).createFolder({ name: 'X' })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(snippets.createSnippetFolder).not.toHaveBeenCalled()
  })
})

describe('snippet router — `all` FILTERS, it never 403s', () => {
  const OTHER_ID = 'snip_othercuid00000000000000'
  const THIRD_ID = 'snip_thirdcuid00000000000000'

  it('returns an empty list — not a 403 — for a member who may see nothing', async () => {
    // The five `*.list` precedents: a server-warmed page call must not 403, or
    // the whole settings route errors for a member with no shares yet.
    listFixture.ids = [SNIPPET_ID, OTHER_ID]
    await expect(caller(capabilitiesFor(undefined)).all({})).resolves.toEqual({ snippets: [] })
    expect(snippets.listSnippetsForUser).toHaveBeenCalledTimes(1)
    expect(snippets.listSnippetsForUser.mock.calls[0]?.[3]).toEqual({ kind: 'none' })
  })

  it('narrows to exactly the granted ids', async () => {
    listFixture.ids = [SNIPPET_ID, OTHER_ID, THIRD_ID]
    const result = await caller(
      capabilitiesFor(undefined, {
        instances: {
          [SNIPPET_ID]: ResourcePermission.view,
          [OTHER_ID]: ResourcePermission.none,
          [THIRD_ID]: ResourcePermission.admin,
        },
      })
    ).all({})
    expect(result.snippets).toEqual([{ id: SNIPPET_ID }, { id: THIRD_ID }])
  })

  it('the scope goes INTO the query — it is not a post-read filter', async () => {
    // The plan 30 §finding-1 property: computed up front and handed to the
    // helper, which pushes it into the SQL `WHERE`. Filtering afterwards would
    // make any future pagination report the unfiltered totals.
    listFixture.ids = [SNIPPET_ID, OTHER_ID]
    await caller(
      capabilitiesFor(undefined, { instances: { [SNIPPET_ID]: ResourcePermission.view } })
    ).all({})
    expect(snippets.listSnippetsForUser.mock.calls[0]?.[3]).toEqual({
      kind: 'include',
      includeIds: [SNIPPET_ID],
    })
  })

  it('OWNER is filtered to their own rows, like any other member', async () => {
    // §0.6 revised — no exclusion arm survives for a `baselineAtCreate: true`
    // resource. An owner holding one row lists exactly that snippet.
    listFixture.ids = [SNIPPET_ID, OTHER_ID]
    const result = await caller(
      capabilitiesFor(undefined, {
        role: 'OWNER',
        instances: { [SNIPPET_ID]: ResourcePermission.admin },
      })
    ).all({})
    expect(result.snippets).toEqual([{ id: SNIPPET_ID }])
    expect(snippets.listSnippetsForUser.mock.calls[0]?.[3]).toEqual({
      kind: 'include',
      includeIds: [SNIPPET_ID],
    })
  })

  it('an OWNER holding no rows lists nothing at all', async () => {
    listFixture.ids = [SNIPPET_ID, OTHER_ID]
    const result = await caller(capabilitiesFor(undefined, { role: 'OWNER' })).all({})
    expect(result.snippets).toEqual([])
    expect(snippets.listSnippetsForUser.mock.calls[0]?.[3]).toEqual({ kind: 'none' })
  })

  it('an org ADMIN sees only their own shares, like any other member', async () => {
    listFixture.ids = [SNIPPET_ID, OTHER_ID]
    const result = await caller(capabilitiesFor(undefined, { role: 'ADMIN' })).all({})
    expect(result.snippets).toEqual([])
  })

  it('a worker seat sees nothing, even holding an `admin` row', async () => {
    listFixture.ids = [SNIPPET_ID]
    const result = await caller(
      capabilitiesFor(ResourcePermission.admin, { seatType: 'worker' })
    ).all({})
    expect(result.snippets).toEqual([])
    expect(snippets.listSnippetsForUser.mock.calls[0]?.[3]).toEqual({ kind: 'none' })
  })

  it('the area level alone opens nothing — snippets: Full still lists zero', async () => {
    listFixture.ids = [SNIPPET_ID, OTHER_ID]
    const result = await caller(capabilitiesFor(undefined, { areaLevel: Level.Full })).all({})
    expect(result.snippets).toEqual([])
  })
})

describe('snippet router — getFolders and the folder-count leak (§6.3)', () => {
  it('never 403s, and hands the count query the SAME scope the list uses', async () => {
    // The leak: `listSnippetFoldersWithCounts` used to count every snippet in the
    // org, so a member who could see nothing still learned how many private
    // snippets each folder held. The count is only as safe as the scope it is
    // given, and the scope must be the one `all` uses or the two disagree.
    const caps = capabilitiesFor(undefined, {
      instances: { [SNIPPET_ID]: ResourcePermission.view },
    })
    await expect(caller(caps).getFolders()).resolves.toBeDefined()
    const folderScope = snippets.listSnippetFoldersWithCounts.mock.calls[0]?.[2]
    expect(folderScope).toEqual({ kind: 'include', includeIds: [SNIPPET_ID] })

    listFixture.ids = [SNIPPET_ID]
    await caller(caps).all({})
    expect(folderScope).toEqual(snippets.listSnippetsForUser.mock.calls[0]?.[3])
  })

  it('a member who sees no snippets gets the `none` scope, not an org-wide count', async () => {
    await expect(caller(capabilitiesFor(undefined)).getFolders()).resolves.toBeDefined()
    expect(snippets.listSnippetFoldersWithCounts.mock.calls[0]?.[2]).toEqual({ kind: 'none' })
  })

  it('a worker seat gets the `none` scope too', async () => {
    await caller(capabilitiesFor(ResourcePermission.admin, { seatType: 'worker' })).getFolders()
    expect(snippets.listSnippetFoldersWithCounts.mock.calls[0]?.[2]).toEqual({ kind: 'none' })
  })

  it('OWNER gets their own rows, not an unfiltered exclusion', async () => {
    // §0.6 revised — the folder COUNTS follow the same scope as the list, so an
    // owner's counts stop reporting snippets they cannot open. That is the whole
    // point of §6.3's leak fix: the count must never be wider than the list.
    await caller(
      capabilitiesFor(undefined, {
        role: 'OWNER',
        instances: { [SNIPPET_ID]: ResourcePermission.admin },
      })
    ).getFolders()
    expect(snippets.listSnippetFoldersWithCounts.mock.calls[0]?.[2]).toEqual({
      kind: 'include',
      includeIds: [SNIPPET_ID],
    })
  })
})

describe('snippet router — create writes the owner `admin` ResourceAccess row', () => {
  /**
   * `db.transaction` captures every `insert().values()` payload in call order.
   * Drizzle table objects are `undefined` under vitest, so the ORDER of the two
   * inserts identifies them, not the table reference.
   */
  function makeCreateDb(inserts: unknown[]) {
    const record = { transactional: false }
    const tx = {
      insert: () => ({
        values: (payload: unknown) => {
          inserts.push(payload)
          return {
            returning: async () => [{ id: 'snip_new' }],
            onConflictDoNothing: async () => {
              record.transactional = true
            },
          }
        },
      }),
    }
    return {
      record,
      db: {
        transaction: async (cb: (t: typeof tx) => Promise<string>) => cb(tx),
        query: { Snippet: { findFirst: async () => ({ id: 'snip_new', title: 'T' }) } },
      },
    }
  }

  it('the row is written on the ROUTER path, with the caller as its admin', async () => {
    // Driven through the real `createSnippet` rather than the mock, because the
    // claim is about what got INSERTED. Without this row the author cannot see
    // the snippet they just created: `snippet` is `baselineAtCreate: true`, so
    // there is no area-level fallback to catch them.
    const inserts: unknown[] = []
    const { db, record } = makeCreateDb(inserts)
    snippets.createSnippet.mockImplementation(realCreateSnippet as any)

    await expect(
      caller(capabilitiesFor(undefined, { areaLevel: Level.Full }), db).create({
        title: 'T',
        content: 'C',
      })
    ).resolves.toMatchObject({ success: true })

    expect(inserts).toHaveLength(2)
    expect(inserts[0]).toMatchObject({ title: 'T', organizationId: ORG_ID, createdById: USER_ID })
    expect(inserts[1]).toMatchObject({
      organizationId: ORG_ID,
      entityDefinitionId: 'snippet',
      entityInstanceId: 'snip_new',
      granteeType: ResourceGranteeType.user,
      granteeId: USER_ID,
      permission: ResourcePermission.admin,
    })
    // Both inserts came off the transaction handle, not the bare db.
    expect(record.transactional).toBe(true)
  })

  it('no row is written when the create is refused — the gate runs first', async () => {
    const inserts: unknown[] = []
    const { db } = makeCreateDb(inserts)
    snippets.createSnippet.mockImplementation(realCreateSnippet as any)

    await expect(
      caller(capabilitiesFor(undefined, { areaLevel: Level.Edit }), db).create({
        title: 'T',
        content: 'C',
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(inserts).toEqual([])
  })

  it('busts the author’s capability cache, or they cannot see what they made', async () => {
    const { db } = makeCreateDb([])
    snippets.createSnippet.mockImplementation(realCreateSnippet as any)
    await caller(capabilitiesFor(undefined, { areaLevel: Level.Full }), db).create({
      title: 'T',
      content: 'C',
    })
    expect(resourceAccess.emitResourceAccessInstanceChanged).toHaveBeenCalledWith(ORG_ID, [
      { granteeType: ResourceGranteeType.user, granteeId: USER_ID },
    ])
  })
})

/**
 * `snippet.share` is DELETED. Sharing funnels through
 * `resourceAccess.grantInstance`, which resolves any `INSTANCE_ACCESS_RESOURCES`
 * key generically and gates on `assertAdminInstance` — so `snippet` inherited a
 * fully-gated share surface by joining the registry, and there is no second,
 * unaudited writer to keep in step.
 */
describe('snippet sharing goes through resourceAccess.grantInstance', () => {
  const shareCaller = () =>
    resourceAccessRouter.createCaller({
      db: {},
      headers: new Headers(),
      session: { organizationId: ORG_ID, userId: USER_ID, user: { id: USER_ID } },
    } as any)

  const share = (permission: ResourcePermission = ResourcePermission.view) =>
    shareCaller().grantInstance({
      recordId: SNIPPET_RECORD_ID,
      granteeType: ResourceGranteeType.user,
      granteeId: 'usr_grantee',
      permission,
    })

  it('the snippet router exposes no `share` procedure of its own', () => {
    expect(Object.keys((snippetsRouter as any)._def.procedures).sort()).toEqual(PROCEDURES)
  })

  it('an instance `admin` holder can share', async () => {
    getCapabilities.mockResolvedValue(capabilitiesFor(ResourcePermission.admin))
    await expect(share()).resolves.toEqual({ success: true })
    expect(resourceAccess.grantInstanceAccess).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_ID }),
      expect.objectContaining({ recordId: SNIPPET_RECORD_ID, permission: ResourcePermission.view })
    )
    // The snippet target never falls through to the mail-sharing authorizer.
    expect(resourceAccess.assertCanManageMailSharing).not.toHaveBeenCalled()
  })

  it('an instance `edit` holder cannot re-share', async () => {
    getCapabilities.mockResolvedValue(capabilitiesFor(ResourcePermission.edit))
    await expect(share()).rejects.toMatchObject(FORBIDDEN)
    expect(resourceAccess.grantInstanceAccess).not.toHaveBeenCalled()
  })

  it('snippets: Full with no instance row cannot share (the private posture holds here too)', async () => {
    getCapabilities.mockResolvedValue(capabilitiesFor(undefined, { areaLevel: Level.Full }))
    await expect(share()).rejects.toMatchObject(FORBIDDEN)
    expect(resourceAccess.grantInstanceAccess).not.toHaveBeenCalled()
  })

  it('an org ADMIN who is not a grantee cannot share it either (decision 0.6)', async () => {
    getCapabilities.mockResolvedValue(capabilitiesFor(undefined, { role: 'ADMIN' }))
    await expect(share()).rejects.toMatchObject(FORBIDDEN)
    expect(resourceAccess.grantInstanceAccess).not.toHaveBeenCalled()
  })

  it('revoking is gated the same way', async () => {
    getCapabilities.mockResolvedValue(capabilitiesFor(ResourcePermission.edit))
    await expect(
      shareCaller().revokeInstance({
        recordId: SNIPPET_RECORD_ID,
        granteeType: ResourceGranteeType.user,
        granteeId: 'usr_grantee',
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(resourceAccess.revokeInstanceAccess).not.toHaveBeenCalled()
  })

  it('the workspace-baseline `none` marker is legal for a snippet target', async () => {
    // `isInstanceAccessKey('snippet')` is what makes `none` acceptable here; on a
    // mail target the same call is a 400. This pins that snippets really did join
    // the registry rather than merely being spelled like a member of it.
    getCapabilities.mockResolvedValue(capabilitiesFor(ResourcePermission.admin))
    await expect(
      shareCaller().grantInstance({
        recordId: SNIPPET_RECORD_ID,
        granteeType: ResourceGranteeType.role,
        granteeId: 'org_member',
        permission: ResourcePermission.none,
      })
    ).resolves.toEqual({ success: true })
    expect(resourceAccess.grantInstanceAccess).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ permission: ResourcePermission.none })
    )
  })
})

/**
 * The behavioral blocks above run against a stubbed `~/server/api/trpc`, so they
 * cannot see a downgrade of the procedure BUILDER itself — and this router's
 * pre-plan-36 state was exactly that: ten bare `protectedProcedure`s. Pin it in
 * source, the same idiom as `segment-instance-access.test.ts`.
 */
describe('snippet router — structural invariants', () => {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), 'src/server/api/routers/snippet.ts'),
    'utf8'
  )

  it('every procedure is a capabilityProcedure — no bare protectedProcedure', () => {
    for (const name of PROCEDURES) {
      expect(src, `${name} must build on capabilityProcedure`).toContain(
        `${name}: capabilityProcedure`
      )
    }
    // Matched with the colon: the file's own doc comment names
    // `protectedProcedure` when explaining what these used to be.
    expect(src).not.toContain(': protectedProcedure')
    expect(src).not.toContain(': publicProcedure')
  })

  it('the procedure list is exhaustive — a new procedure must be gated too', () => {
    const declared = [...src.matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9]*): capabilityProcedure/gm)].map(
      (m) => m[1]
    )
    expect(declared.sort()).toEqual(PROCEDURES)
  })
})
