// apps/web/src/server/api/routers/resource-access-record-lane.test.ts

import { ResourceGranteeType, type ResourcePermission } from '@auxx/database/enums'
import type { OrganizationRole, SeatType } from '@auxx/database/types'
import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan v3/03 §7.1–7.3 — the record lane's write and read authorization.
 *
 * Three defects, one test file, because they share a cause: `resourceAccess`
 * treated "not a mail def and not an instance-access key" as "nothing to check".
 *
 *  1. **§7.1 — `grantInstance` failed OPEN for record defs.**
 *     `canonicalMailRecordId` passes a record CUID through unchanged →
 *     `authorizeInstanceTarget` answered `false` *without asserting anything* →
 *     `assertCanManageMailSharing` early-returns for a non-mail def →
 *     `assertMailSharingFeature` early-returns too → the row was written. Same
 *     hole on `setInstance` and `revokeInstance`. Any member could grant any
 *     access on any record in the org.
 *  2. **§7.2 — `resourceAccess.forInstance` had no authorization at all.** Any
 *     member could enumerate the grantees (user/group/profile ids, permission,
 *     lens) of any recordId, `inbox:*` / `thread:*` / `contact:*` included.
 *  3. **§7.3 — `rung: 'none'` must never land on a record def** (raise-only,
 *     D7). Already enforced when this file was written; pinned as a regression so
 *     a future "simplify the enum branches" pass cannot delete it silently.
 *     Its unlisted SIBLING is `grantType`, which accepted `none` for ANY grantee
 *     — a restriction marker that grants nobody while flipping the whole def into
 *     the grantee-agnostic restricted set. Closed here.
 *
 * **Every denial asserts the STATUS**, not merely that something threw: the
 * asserts raise `AuxxError` subclasses which `auxxErrorMiddleware` maps, and a
 * denial that surfaces as a 500 is a different and worse outcome than a 403.
 *
 * Behavioral, not source-text: the real router is driven through a tRPC caller
 * with a **real** `CapabilitySet`. Only the lib write funnels and the lens
 * computation are stubbed — the authorization arithmetic is the thing under test.
 */

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'

/** A generic record def (`deals`) — a CUID with no mail slug to canonicalize to. */
const DEALS_DEF_ID = 'edf_dealscuid00000000000000'
const RECORD_ID = 'rec_cuid00000000000000000a'
const DEALS_RECORD_ID = `${DEALS_DEF_ID}:${RECORD_ID}`

const CONTACT_DEF_ID = 'edf_contactcuid000000000000'
const INBOX_DEF_ID = 'edf_inboxcuid00000000000000'
const INBOX_ID = 'ibx_cuid00000000000000000a'
const INBOX_RECORD_ID = `inbox:${INBOX_ID}`
const THREAD_ID = 'thr_cuid00000000000000000a'
const THREAD_RECORD_ID = `thread:${THREAD_ID}`
const DATASET_ID = 'dst_cuid00000000000000000a'
const DATASET_RECORD_ID = `dataset:${DATASET_ID}`

/** What the org `resources` cache projects, as `buildDefIdToSlug` reads it. */
const RESOURCES = [
  { id: DEALS_DEF_ID, apiSlug: 'deals', entityDefinitionId: DEALS_DEF_ID, entityType: undefined },
  {
    id: CONTACT_DEF_ID,
    apiSlug: 'contacts',
    entityDefinitionId: CONTACT_DEF_ID,
    entityType: 'contact',
  },
  { id: INBOX_DEF_ID, apiSlug: 'inboxes', entityDefinitionId: INBOX_DEF_ID, entityType: 'inbox' },
]

const { resourceAccess, cache, isAdminOrOwner, recordAuditFromCtx, getThreadLens } = vi.hoisted(
  () => ({
    resourceAccess: {
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
      assertCanManageMailSharing: vi.fn(async () => undefined),
      assertCanManageMailTypeAccess: vi.fn(async () => undefined),
      assertMailSharingFeature: vi.fn(async () => undefined),
    },
    cache: {
      getCachedResources: vi.fn(async () => RESOURCES),
      getCachedUserInstanceGrants: vi.fn(async () => ({ isAdmin: false, grants: {} })),
      getCachedPermissionProfiles: vi.fn(async () => []),
      // Plan v3/03 P5 — the row-effective share gate resolves the member's
      // grantee union (cache-only) before it can build the `_access` read. A
      // member holding no groups and no profile still resolves to the `user` +
      // `role:org_member` matchers, which is the shape these denial cases need.
      getCachedUserGroupIds: vi.fn(async () => []),
      getOrgCache: () => ({
        get: vi.fn(async (_org: string, key: string) => (key === 'profiles' ? [] : {})),
      }),
    },
    isAdminOrOwner: vi.fn(async () => false),
    recordAuditFromCtx: vi.fn(async () => undefined),
    getThreadLens: vi.fn(async () => 'none'),
  })
)

// `isMailSharingDef` + `ORG_MEMBER_GRANTEE_ID` stay REAL — they decide which lane
// a target takes and which grantee may carry a `none` marker, i.e. half of the
// behaviour under test. Both live in dependency-free leaves.
vi.mock('@auxx/lib/resource-access', async () => {
  const { isMailSharingDef } = await import('@auxx/lib/resource-access/mail-sharing-defs')
  return { ...resourceAccess, isMailSharingDef, ORG_MEMBER_GRANTEE_ID: 'org_member' }
})
vi.mock('@auxx/lib/cache', () => cache)
vi.mock('@auxx/lib/members', () => ({ isAdminOrOwner }))
vi.mock('~/server/api/audit-context', () => ({ recordAuditFromCtx }))
// The router lazy-imports this barrel for the `thread` read branch only.
vi.mock('@auxx/lib/permissions/visibility', () => ({ getThreadLens }))

const { featureService } = vi.hoisted(() => ({
  featureService: { requireAccess: vi.fn(async () => undefined) },
}))

/**
 * The `@auxx/lib/permissions` barrel reaches redis/db at import time and hangs
 * under vitest. Hand back the REAL instance-access registry (it is what makes
 * `dataset`/`inbox` instance-access targets) and the REAL `buildDefIdToSlug`; stub
 * only the plan service. `getCapabilities` is not stubbed to a fake object — the
 * caller injects a real `CapabilitySet` and this resolver returns it, so the
 * arithmetic under test is the shipped arithmetic.
 */
const { capsHolder } = vi.hoisted(() => ({ capsHolder: { current: null as unknown } }))

vi.mock('@auxx/lib/permissions', async () => {
  const instanceAccess = await import('@auxx/lib/permissions/capabilities/instance-access')
  const resolve = await import('@auxx/lib/permissions/capabilities/resolve-capability-inputs')
  const types = await import('@auxx/lib/permissions/types')
  return {
    ...instanceAccess,
    buildDefIdToSlug: resolve.buildDefIdToSlug,
    FeatureKey: types.FeatureKey,
    FeaturePermissionService: class {
      requireAccess = featureService.requireAccess
    },
    getCapabilities: vi.fn(async () => capsHolder.current),
    // Plan v3/03 P5 — the record-lane share authorizer now takes a ROW-EFFECTIVE
    // read. These two are the real implementations, passed through: the arm
    // decision is pure and is exactly what these denial cases assert (a member
    // with no def view and no grants resolves arm 4 and is refused without a
    // query), so stubbing them would test the stub instead of the gate.
    recordAccessRankSql: (
      await import('@auxx/lib/permissions/capabilities/record-visibility-scope')
    ).recordAccessRankSql,
    resolveRecordVisibilityScope: (
      await import('@auxx/lib/permissions/capabilities/record-visibility-scope')
    ).resolveRecordVisibilityScope,
    satisfiesRung: (await import('@auxx/lib/permissions/capabilities/rung')).satisfiesRung,
  }
})

vi.mock('../trpc', async () => {
  const { initTRPC } = await import('@trpc/server')
  const t = initTRPC.context<Record<string, unknown>>().create()
  return { createTRPCRouter: t.router, protectedProcedure: t.procedure }
})

// Deep path on purpose: the barrel hangs, and `CapabilitySet` is not on the
// client-safe subpath. Test files are excluded from apps/web's tsconfig.
const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { resourceAccessRouter } = await import('./resourceAccess')

/** The AuxxError→HTTP mappings this file asserts. */
const FORBIDDEN = { cause: { name: 'ForbiddenError', statusCode: 403 } }
const BAD_REQUEST = { cause: { name: 'BadRequestError', statusCode: 400 } }

interface CapsOpts {
  role?: OrganizationRole
  seatType?: SeatType
  /** `Area.records` level. Defaults to `Level.Read` — enough to view, not to share. */
  records?: Level
  /** `Area.datasets` level. Defaults to `Level.None` — the share-dialog case. */
  datasets?: Level
  /** `Area.inboxes` level. Defaults to `Level.None`. */
  inboxes?: Level
  /** Explicit INDIVIDUAL `ResourceAccess` instance rows reaching this member. */
  instances?: Record<string, ResourcePermission>
}

function capabilitiesFor(opts: CapsOpts = {}) {
  const toSlug = (id: string) =>
    RESOURCES.find((r) => r.id === id || r.apiSlug === id || r.entityDefinitionId === id)
      ?.entityType ?? id
  const toDefId = (id: string) =>
    RESOURCES.find((r) => r.id === id || r.apiSlug === id || r.entityType === id)
      ?.entityDefinitionId ?? id
  return new CapabilitySet(
    new Set(
      expandLevelsToKeys({
        [Area.records]: opts.records ?? Level.Read,
        [Area.datasets]: opts.datasets ?? Level.None,
        [Area.inboxes]: opts.inboxes ?? Level.None,
      })
    ),
    {},
    opts.role ?? 'MEMBER',
    opts.seatType ?? 'full',
    toSlug,
    undefined,
    toDefId,
    opts.instances ?? {},
    new Set(),
    {},
    new Set()
  )
}

type Caps = InstanceType<typeof CapabilitySet>

function sharing(capabilities: Caps) {
  capsHolder.current = capabilities
  return resourceAccessRouter.createCaller({
    // The row-effective share read (plan v3/03 §5.3) issues ONE
    // `select(...).from(EntityInstance).where(...).limit(1)`. These members hold
    // no grant, so it comes back empty — which denies for the strongest possible
    // reason: the read path itself hid the row.
    db: {
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => [] }) }),
      }),
    },
    headers: new Headers(),
    session: { organizationId: ORG_ID, userId: USER_ID, user: { id: USER_ID } },
  } as never)
}

beforeEach(() => {
  for (const fn of Object.values(resourceAccess)) fn.mockReset()
  resourceAccess.revokeInstanceAccess.mockResolvedValue(true)
  resourceAccess.getInstanceAccess.mockResolvedValue([])
  resourceAccess.getTypeAccess.mockResolvedValue([])
  resourceAccess.assertCanManageMailSharing.mockResolvedValue(undefined)
  resourceAccess.assertCanManageMailTypeAccess.mockResolvedValue(undefined)
  resourceAccess.assertMailSharingFeature.mockResolvedValue(undefined)
  isAdminOrOwner.mockReset().mockResolvedValue(false)
  recordAuditFromCtx.mockReset()
  featureService.requireAccess.mockReset().mockResolvedValue(undefined)
  getThreadLens.mockReset().mockResolvedValue('none')
  cache.getCachedResources.mockReset().mockResolvedValue(RESOURCES)
  cache.getCachedUserInstanceGrants.mockReset().mockResolvedValue({ isAdmin: false, grants: {} })
})

// ═══════════════════════════════════════════════════════════════════════════
// §7.1 — the write funnels
// ═══════════════════════════════════════════════════════════════════════════

/** The three write funnels, each naming the same record row. */
const WRITE_CALLS = [
  [
    'grantInstance',
    (c: ReturnType<typeof sharing>) =>
      c.grantInstance({
        recordId: DEALS_RECORD_ID,
        granteeType: ResourceGranteeType.user,
        granteeId: 'usr_grantee',
        rung: 'read',
      }),
    () => resourceAccess.grantInstanceAccess,
  ],
  [
    'setInstance',
    (c: ReturnType<typeof sharing>) =>
      c.setInstance({
        recordId: DEALS_RECORD_ID,
        granteeType: ResourceGranteeType.user,
        grants: [{ granteeId: 'usr_grantee', rung: 'read' }],
      }),
    () => resourceAccess.setInstanceAccess,
  ],
  [
    'revokeInstance',
    (c: ReturnType<typeof sharing>) =>
      c.revokeInstance({
        recordId: DEALS_RECORD_ID,
        granteeType: ResourceGranteeType.user,
        granteeId: 'usr_grantee',
      }),
    () => resourceAccess.revokeInstanceAccess,
  ],
] as const

describe('§7.1 — sharing a RECORD row requires row-effective edit', () => {
  it.each(
    WRITE_CALLS
  )('%s: a Records-READ member is refused with 403 and writes nothing', async (_name, call, write) => {
    await expect(call(sharing(capabilitiesFor({ records: Level.Read })))).rejects.toMatchObject(
      FORBIDDEN
    )
    expect(write()).not.toHaveBeenCalled()
  })

  it.each(
    WRITE_CALLS
  )('%s: a Records-NONE member is refused with 403 and writes nothing', async (_name, call, write) => {
    await expect(call(sharing(capabilitiesFor({ records: Level.None })))).rejects.toMatchObject(
      FORBIDDEN
    )
    expect(write()).not.toHaveBeenCalled()
  })

  it.each(WRITE_CALLS)('%s: OVER-DENIAL CONTROL — Records Edit is allowed', async (_n, call, w) => {
    await expect(call(sharing(capabilitiesFor({ records: Level.Edit })))).resolves.toBeDefined()
    expect(w()).toHaveBeenCalled()
  })

  it('a worker seat is refused even at Records Full — the seat ceiling dominates', async () => {
    // `Area.records` is outside `WORKER_AREAS`, so `SEAT_CEILINGS.worker` clamps it
    // to None inside `effectiveRecordLevel`. The clamp has to bite HERE too or the
    // sharing endpoint becomes the seam that defeats it.
    const caps = capabilitiesFor({ seatType: 'worker', records: Level.Full })
    await expect(WRITE_CALLS[0][1](sharing(caps))).rejects.toMatchObject(FORBIDDEN)
    expect(resourceAccess.grantInstanceAccess).not.toHaveBeenCalled()
  })

  it('a record target never reaches the mail authorizer or the mail plan gate', async () => {
    // The lane routing, stated positively: the mail funnels are no-ops for a
    // record def, so if the record arm ever stops asserting there is nothing
    // behind it. (This is exactly how the hole survived.)
    await WRITE_CALLS[0][1](sharing(capabilitiesFor({ records: Level.Edit })))
    expect(resourceAccess.assertCanManageMailSharing).not.toHaveBeenCalled()
  })

  it('the record arm does NOT gate on def ADMIN — an Edit member may share a row', async () => {
    // Base records levels cap at `edit` (`levelToRecordBasePermission`), so an
    // `admin` bar would be unreachable from any profile and only OWNER could ever
    // share a row. Records Full ⇒ base `edit` ⇒ allowed.
    const caps = capabilitiesFor({ records: Level.Full })
    expect(caps.canAdministerDef(DEALS_DEF_ID)).toBe(false)
    await expect(WRITE_CALLS[0][1](sharing(caps))).resolves.toBeDefined()
  })

  it('OVER-DENIAL CONTROL: an instance-access target still routes to assertAdminInstance', async () => {
    // A dataset the member holds an `admin` row on, at `datasets: None` — the
    // #1346 share case. The record arm must not have swallowed this lane.
    const caps = capabilitiesFor({
      records: Level.None,
      instances: { [DATASET_ID]: 'admin' },
    })
    await expect(
      sharing(caps).grantInstance({
        recordId: DATASET_RECORD_ID,
        granteeType: ResourceGranteeType.user,
        granteeId: 'usr_grantee',
        rung: 'read',
      })
    ).resolves.toBeDefined()
  })

  it('OVER-DENIAL CONTROL: a thread target still falls through to the mail guard', async () => {
    await sharing(capabilitiesFor({ records: Level.None })).grantInstance({
      recordId: THREAD_RECORD_ID,
      granteeType: ResourceGranteeType.user,
      granteeId: 'usr_grantee',
      rung: 'identity',
    })
    expect(resourceAccess.assertCanManageMailSharing).toHaveBeenCalledWith(
      expect.anything(),
      THREAD_RECORD_ID
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// §7.2 — the read funnel
// ═══════════════════════════════════════════════════════════════════════════

describe('§7.2 — forInstance is gated on "may I see the target"', () => {
  it('a Records-NONE member cannot enumerate a record row’s grantees (403)', async () => {
    await expect(
      sharing(capabilitiesFor({ records: Level.None })).forInstance({ recordId: DEALS_RECORD_ID })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(resourceAccess.getInstanceAccess).not.toHaveBeenCalled()
  })

  it('a Records-READ member may read them — sharing is visible to viewers, not just sharers', async () => {
    await expect(
      sharing(capabilitiesFor({ records: Level.Read })).forInstance({ recordId: DEALS_RECORD_ID })
    ).resolves.toEqual([])
    expect(resourceAccess.getInstanceAccess).toHaveBeenCalledWith(
      expect.anything(),
      DEALS_RECORD_ID
    )
  })

  it('an inbox with no access is refused (403); one the member holds a row on is served', async () => {
    await expect(
      sharing(capabilitiesFor({ inboxes: Level.None })).forInstance({ recordId: INBOX_RECORD_ID })
    ).rejects.toMatchObject(FORBIDDEN)

    const shared = capabilitiesFor({
      inboxes: Level.None,
      instances: { [INBOX_ID]: 'read' },
    })
    await expect(sharing(shared).forInstance({ recordId: INBOX_RECORD_ID })).resolves.toEqual([])
  })

  it('a thread the member cannot see is refused (403) — canViewEntity is useless here', async () => {
    // `thread` is in `NON_RECORD_DEF_SLUGS`, so `canViewEntity('thread')` answers
    // `true` for everyone. Mail visibility is the only real authority.
    const caps = capabilitiesFor({ records: Level.Full })
    expect(caps.canViewEntity('thread')).toBe(true)
    getThreadLens.mockResolvedValue('none')
    await expect(sharing(caps).forInstance({ recordId: THREAD_RECORD_ID })).rejects.toMatchObject(
      FORBIDDEN
    )
    expect(resourceAccess.getInstanceAccess).not.toHaveBeenCalled()
  })

  it.each([
    'metadata',
    'subject',
    'full',
  ])('a thread visible at a `%s` lens IS served — the read-only grantee list must render', async (lens) => {
    // `ThreadSharePopover` shows the list to a non-sharer once the thread has
    // grants; gating this read on the WRITE authority would blank it.
    getThreadLens.mockResolvedValue(lens)
    await expect(
      sharing(capabilitiesFor({ records: Level.None })).forInstance({
        recordId: THREAD_RECORD_ID,
      })
    ).resolves.toEqual([])
  })

  it('the LEGITIMATE share dialog still works: a dataset grantee at datasets: None', async () => {
    // `use-instance-share.ts` reads `forInstance` for exactly this member.
    const caps = capabilitiesFor({
      records: Level.None,
      datasets: Level.None,
      instances: { [DATASET_ID]: 'read' },
    })
    await expect(sharing(caps).forInstance({ recordId: DATASET_RECORD_ID })).resolves.toEqual([])
  })

  it('a dataset the member holds nothing on is refused (403)', async () => {
    await expect(
      sharing(capabilitiesFor({ datasets: Level.None })).forInstance({
        recordId: DATASET_RECORD_ID,
      })
    ).rejects.toMatchObject(FORBIDDEN)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// §7.3 — `none` is a restriction marker, never a grant
// ═══════════════════════════════════════════════════════════════════════════

describe('§7.3 — `permission: none` is confined to the restriction lanes', () => {
  it('REGRESSION: grantInstance rejects `none` on a record def with 400', async () => {
    // Raise-only (D7). A record CUID is not an `isInstanceAccessKey`, so the guard
    // that exists for mail targets covers record defs too — and the 400 must fire
    // BEFORE any authorization, so it cannot be mistaken for a permission answer.
    await expect(
      sharing(capabilitiesFor({ records: Level.Full })).grantInstance({
        recordId: DEALS_RECORD_ID,
        granteeType: ResourceGranteeType.user,
        granteeId: 'usr_grantee',
        rung: 'none',
      })
    ).rejects.toMatchObject(BAD_REQUEST)
    expect(resourceAccess.grantInstanceAccess).not.toHaveBeenCalled()
  })

  it('REGRESSION: grantInstance rejects `none` on a thread too', async () => {
    await expect(
      sharing(capabilitiesFor()).grantInstance({
        recordId: THREAD_RECORD_ID,
        granteeType: ResourceGranteeType.user,
        granteeId: 'usr_grantee',
        rung: 'none',
      })
    ).rejects.toMatchObject(BAD_REQUEST)
  })

  it('grantInstance still accepts `none` on an instance-access key — the lockdown marker', async () => {
    const caps = capabilitiesFor({ instances: { [DATASET_ID]: 'admin' } })
    await expect(
      sharing(caps).grantInstance({
        recordId: DATASET_RECORD_ID,
        granteeType: ResourceGranteeType.role,
        granteeId: 'org_member',
        rung: 'none',
      })
    ).resolves.toEqual({ success: true })
  })

  it.each([
    [ResourceGranteeType.user, 'usr_x'],
    [ResourceGranteeType.group, 'grp_x'],
    [ResourceGranteeType.profile, 'prof_x'],
    [ResourceGranteeType.role, 'admin'],
  ])('grantType rejects `none` for a %s grantee with 400', async (granteeType, granteeId) => {
    // The unlisted hole beside §7.3: unenforced, such a row granted the grantee
    // nothing AND put the def into `restrictedEntityDefIds`, privatizing the whole
    // definition for the entire org.
    isAdminOrOwner.mockResolvedValue(true)
    await expect(
      sharing(capabilitiesFor()).grantType({
        entityDefinitionId: DEALS_DEF_ID,
        granteeType,
        granteeId,
        rung: 'none',
      })
    ).rejects.toMatchObject(BAD_REQUEST)
    expect(resourceAccess.grantTypeAccess).not.toHaveBeenCalled()
  })

  it('grantType accepts `none` for role:org_member — the def lockdown marker', async () => {
    isAdminOrOwner.mockResolvedValue(true)
    await expect(
      sharing(capabilitiesFor()).grantType({
        entityDefinitionId: DEALS_DEF_ID,
        granteeType: ResourceGranteeType.role,
        granteeId: 'org_member',
        rung: 'none',
      })
    ).resolves.toEqual({ success: true })
    expect(resourceAccess.grantTypeAccess).toHaveBeenCalled()
  })

  it('grantType still accepts positive permissions for every grantee kind', async () => {
    isAdminOrOwner.mockResolvedValue(true)
    await expect(
      sharing(capabilitiesFor()).grantType({
        entityDefinitionId: DEALS_DEF_ID,
        granteeType: ResourceGranteeType.group,
        granteeId: 'grp_x',
        rung: 'read',
      })
    ).resolves.toEqual({ success: true })
  })
})
