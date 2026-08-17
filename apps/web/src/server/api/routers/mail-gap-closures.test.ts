// apps/web/src/server/api/routers/mail-gap-closures.test.ts

import fs from 'node:fs'
import path from 'node:path'
import { ResourceGranteeType, type ResourcePermission } from '@auxx/database/enums'
import type { OrganizationRole, SeatType } from '@auxx/database/types'
import { isGoverningInstanceRow } from '@auxx/lib/cache/providers/governing-instance-ids-provider'
import { PermissionKey } from '@auxx/lib/permissions/capabilities/registry'
import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_ROOT } from '../../../test/app-root'

/**
 * Plan 40 phase 3 — the three gaps phase 3 left behind.
 *
 *  1. **The drafts router was ungated.** §5.3's table lists "drafts" under the
 *     thread router, but they live in `draft.ts`, which phase 3 never touched.
 *     A member at `inboxes: None` could compose, autosave, list and delete
 *     drafts — most of the mail write experience — while every `thread.*`
 *     procedure refused them. The front door now covers both.
 *  2. **`revokeInstance` on an inbox lost self-revoke.** Phase 1 made
 *     `isInstanceAccessKey('inbox')` true, so inbox targets began routing
 *     through `authorizeInstanceTarget` → `assertAdminInstance` and skipped
 *     `assertCanManageMailSharing`'s `selfRevokeGranteeId` hatch entirely. A
 *     `view` grantee could no longer drop their own inbox grant.
 *  3. **`inbox.getIntegrations` stayed on `InboxService.hasUserAccess`**, against
 *     §5.3's `assertViewInstance` prescription, because the two predicates
 *     disagreed on the majority path. **That gap closed on 2026-07-29** when the
 *     capability layer adopted mail's `rowGoverned` predicate
 *     (`governingInstanceIds`) and started reading the caller's own row before
 *     the org-wide set. The last block pins the AGREEMENT that unblocked it. The
 *     §5.3 migration itself has since LANDED — `inbox.getIntegrations` is on
 *     `assertViewInstance` now, tested in `inbox-channel-routing-access.test.ts`
 *     and `inbox-personal-def-recordid.test.ts`. These cases stay as the
 *     predicate-level evidence that keeps the two layers honest.
 *
 * Behavioral, with a **real** `CapabilitySet` — the barrel hangs under vitest,
 * so every permissions import is a deep one.
 */

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const OTHER_USER_ID = 'usr_cuid000000000000000000001'

const THREAD_ID = 'thr_cuid00000000000000000a'
const INBOX_ID = 'ibx_cuid00000000000000000a'
const DRAFT_ID = 'drf_cuid00000000000000000a'

const INBOX_DEF_ID = 'edf_inboxcuid00000000000000'
const CONTACT_DEF_ID = 'edf_contactcuid000000000000'
const DATASET_ID = 'dst_cuid00000000000000000a'

const INBOX_RECORD_ID = `inbox:${INBOX_ID}`
const CONTACT_RECORD_ID = `${CONTACT_DEF_ID}:cnt_cuid00000000000000000a`

// ─────────────────────────────────────────────────────────────────────────────
// Doubles
// ─────────────────────────────────────────────────────────────────────────────

const { draftService, cache, resourceAccess, isAdminOrOwner, recordAuditFromCtx, getCapabilities } =
  vi.hoisted(() => ({
    draftService: {
      upsert: vi.fn(async () => DRAFT_ROW()),
      delete: vi.fn(async () => ({ success: true })),
      getById: vi.fn(async () => DRAFT_ROW()),
      getByThreadId: vi.fn(async () => DRAFT_ROW()),
      hasDraft: vi.fn(async () => true),
      getDraftId: vi.fn(async () => DRAFT_ID),
      listUserDrafts: vi.fn(async () => [DRAFT_ROW()]),
      getStandaloneDraftMetas: vi.fn(async () => []),
    },
    cache: {
      getCachedUserInstanceGrants: vi.fn(),
      getCachedResources: vi.fn(),
    },
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
      isMailSharingDef: vi.fn((d: string) =>
        ['inbox', 'personal_inbox', 'thread', 'contact'].includes(d)
      ),
    },
    isAdminOrOwner: vi.fn(async () => false),
    recordAuditFromCtx: vi.fn(async () => undefined),
    getCapabilities: vi.fn(),
  }))

/** Shape `transformDraftForFrontend` needs; content is irrelevant to the gate. */
function DRAFT_ROW() {
  return {
    id: DRAFT_ID,
    threadId: THREAD_ID,
    integrationId: 'int_1',
    inReplyToMessageId: null,
    content: {
      subject: 'hi',
      bodyJson: null,
      bodyHtml: '',
      bodyText: '',
      signatureId: null,
      recipients: { to: [], cc: [], bcc: [] },
      attachments: [],
      actions: [],
      metadata: {},
    },
    createdAt: new Date(0),
    updatedAt: new Date(0),
  }
}

vi.mock('@auxx/lib/drafts', () => ({
  DraftService: class {
    upsert = draftService.upsert
    delete = draftService.delete
    getById = draftService.getById
    getByThreadId = draftService.getByThreadId
    hasDraft = draftService.hasDraft
    getDraftId = draftService.getDraftId
    listUserDrafts = draftService.listUserDrafts
    getStandaloneDraftMetas = draftService.getStandaloneDraftMetas
  },
}))
vi.mock('@auxx/lib/cache', () => cache)
vi.mock('@auxx/lib/resource-access', () => resourceAccess)
vi.mock('@auxx/lib/members', () => ({ isAdminOrOwner }))
vi.mock('~/server/api/audit-context', () => ({ recordAuditFromCtx }))
vi.mock('~/server/lib/signature-instance-access', () => ({
  assertSignatureUsable: vi.fn(async () => undefined),
}))
vi.mock('@auxx/logger', async () => (await import('~/test/logger-mock')).mockAuxxLogger())

/**
 * The REAL registry + REAL `INSTANCE_ACCESS_RESOURCES` (they are what makes
 * `inbox` an instance-access key, which is the whole cause of gap 2) + the REAL
 * `buildDefIdToSlug`. Only capability resolution and the plan service are stubbed.
 */
vi.mock('@auxx/lib/permissions', async () => {
  const instanceAccess = await import('@auxx/lib/permissions/capabilities/instance-access')
  const registry = await import('@auxx/lib/permissions/capabilities/registry')
  const resolve = await import('@auxx/lib/permissions/capabilities/resolve-capability-inputs')
  const types = await import('@auxx/lib/permissions/types')
  return {
    ...instanceAccess,
    PermissionKey: registry.PermissionKey,
    buildDefIdToSlug: resolve.buildDefIdToSlug,
    FeatureKey: types.FeatureKey,
    FeaturePermissionService: class {
      requireAccess = vi.fn(async () => undefined)
    },
    getCapabilities,
  }
})

/**
 * Mirrors the REAL `permissionProcedure`: a plain `capabilities.assert(key)`.
 * Only the plan-AND (`inboxes.view` carries no `featureKey`) and the
 * `getCapabilities` read are dropped — ctx already carries the set. So the gate
 * on the BUILDER is under test: deleting `permissionProcedure(inboxesView)` from
 * `draft.ts` fails the whole first block.
 */
vi.mock('~/server/api/trpc', async () => {
  const { initTRPC } = await import('@trpc/server')
  const t = initTRPC.context<Record<string, unknown>>().create()
  return {
    createTRPCRouter: t.router,
    capabilityProcedure: t.procedure,
    protectedProcedure: t.procedure,
    permissionProcedure: (key: string) =>
      t.procedure.use(({ ctx, next }) => {
        ;(ctx as { capabilities: { assert: (k: string) => void } }).capabilities.assert(key)
        return next()
      }),
    notDemo:
      () =>
      ({ next }: { next: () => unknown }) =>
        next(),
    isAuxxError: (e: unknown) =>
      typeof e === 'object' && e !== null && 'statusCode' in (e as Record<string, unknown>),
  }
})

const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { draftRouter } = await import('./draft')
const { resourceAccessRouter } = await import('./resourceAccess')

/**
 * Asserting the STATUS, not merely "it rejected". The asserts throw `AuxxError`
 * (never `TRPCError`); tRPC exposes it as `cause`, and in the app
 * `auxxErrorMiddleware` + `errorFormatter` map it onto this status. A denial
 * that surfaces as a 500 is a different and worse outcome — which is exactly
 * what `draft.ts`'s blanket `catch` used to do to the §7 lens denial.
 */
const FORBIDDEN = { cause: { name: 'ForbiddenError', statusCode: 403 } }

/** What the org `resources` cache projects, as `buildDefIdToSlug` reads it. */
const RESOURCES = [
  { id: 'res_inbox', apiSlug: 'inboxes', entityDefinitionId: INBOX_DEF_ID, entityType: 'inbox' },
  {
    id: 'res_contact',
    apiSlug: 'contacts',
    entityDefinitionId: CONTACT_DEF_ID,
    entityType: 'contact',
  },
]

interface CapsOpts {
  role?: OrganizationRole
  seatType?: SeatType
  inboxes?: Level
  records?: Level
  instances?: Record<string, ResourcePermission>
  /**
   * Org-wide ROW-GOVERNED set (`governingInstanceIds`): a `role:org_member`
   * baseline at any permission, or any `none` marker. Defaults to the granted
   * ids. NOT "carries ≥1 row" — see `isGoverningInstanceRow`.
   */
  restricted?: string[]
  derivedKeys?: PermissionKey[]
}

function capabilitiesFor(opts: CapsOpts = {}) {
  const instances = opts.instances ?? {}
  const toSlug = (id: string) =>
    RESOURCES.find((r) => r.id === id || r.apiSlug === id || r.entityDefinitionId === id)
      ?.entityType ?? id
  return new CapabilitySet(
    new Set(
      expandLevelsToKeys({
        [Area.inboxes]: opts.inboxes ?? Level.Read,
        [Area.records]: opts.records ?? Level.Edit,
      })
    ),
    {},
    opts.role ?? 'MEMBER',
    opts.seatType ?? 'full',
    toSlug,
    undefined,
    toSlug,
    instances,
    new Set(opts.restricted ?? Object.keys(instances)),
    {},
    new Set(opts.derivedKeys ?? [])
  )
}

/** The one row `InboxService.createInbox` writes: the creator's Manager grant. */
const CREATOR_ROW = {
  instanceId: INBOX_ID,
  granteeType: ResourceGranteeType.user,
  granteeId: 'usr_creator',
  rung: 'admin',
}

type Caps = InstanceType<typeof CapabilitySet>

function ctxFor(capabilities: Caps) {
  return {
    db: {},
    capabilities,
    headers: new Headers(),
    session: {
      organizationId: ORG_ID,
      userId: USER_ID,
      user: { id: USER_ID, defaultOrganizationId: ORG_ID },
    },
  } as never
}

const drafts = (c: Caps) => draftRouter.createCaller(ctxFor(c))
const sharing = (c: Caps) => resourceAccessRouter.createCaller(ctxFor(c))

const VIEWER = {
  userId: USER_ID,
  role: 'MEMBER',
  isAdmin: false,
  isMailAdmin: false,
  inboxLens: {},
  personalInboxIds: {},
  grants: {},
}

beforeEach(() => {
  // `mockReset()`, not `mockClear()` — a `mockResolvedValueOnce` queue survives
  // `mockClear` and shifts every later value, which makes a mutated source line
  // look caught when it is not.
  for (const fn of Object.values(draftService)) fn.mockClear()
  for (const fn of Object.values(resourceAccess)) fn.mockClear()

  cache.getCachedUserInstanceGrants.mockReset()
  cache.getCachedUserInstanceGrants.mockResolvedValue(VIEWER as never)
  cache.getCachedResources.mockReset()
  cache.getCachedResources.mockResolvedValue(RESOURCES as never)

  getCapabilities.mockReset()
  isAdminOrOwner.mockReset()
  isAdminOrOwner.mockResolvedValue(false as never)
  recordAuditFromCtx.mockReset()
  recordAuditFromCtx.mockResolvedValue(undefined as never)
})

// ═══════════════════════════════════════════════════════════════════════════
// GAP 1 — the drafts router joins the front door
// ═══════════════════════════════════════════════════════════════════════════

/** Every procedure the router declares — the gate is one middleware, so shape
 *  coverage is what matters, but exhaustiveness is pinned structurally below. */
const DRAFT_CALLS = [
  [
    'upsert',
    (c: ReturnType<typeof drafts>) => c.upsert({ integrationId: 'int_1', threadId: THREAD_ID }),
  ],
  ['delete', (c: ReturnType<typeof drafts>) => c.delete({ draftId: DRAFT_ID })],
  ['getById', (c: ReturnType<typeof drafts>) => c.getById({ draftId: DRAFT_ID })],
  ['getByThreadId', (c: ReturnType<typeof drafts>) => c.getByThreadId({ threadId: THREAD_ID })],
  ['hasDraft', (c: ReturnType<typeof drafts>) => c.hasDraft({ threadId: THREAD_ID })],
  ['getDraftId', (c: ReturnType<typeof drafts>) => c.getDraftId({ threadId: THREAD_ID })],
  ['list', (c: ReturnType<typeof drafts>) => c.list()],
  ['getByIds', (c: ReturnType<typeof drafts>) => c.getByIds({ ids: [DRAFT_ID] })],
] as const

describe('draft router — the mail front door (§5.3, the surface phase 3 missed)', () => {
  it.each(DRAFT_CALLS)('%s is REFUSED at inboxes: None', async (_name, call) => {
    await expect(call(drafts(capabilitiesFor({ inboxes: Level.None })))).rejects.toMatchObject(
      FORBIDDEN
    )
    // The middleware answered — no service was constructed, no visibility read.
    expect(cache.getCachedUserInstanceGrants).not.toHaveBeenCalled()
    for (const fn of Object.values(draftService)) expect(fn).not.toHaveBeenCalled()
  })

  it.each(DRAFT_CALLS)('%s is permitted at the Member baseline (Read)', async (_n, call) => {
    await expect(call(drafts(capabilitiesFor()))).resolves.toBeDefined()
  })

  it.each(DRAFT_CALLS)('%s is permitted at inboxes: Full too', async (_n, call) => {
    await expect(call(drafts(capabilitiesFor({ inboxes: Level.Full })))).resolves.toBeDefined()
  })

  it('records authority is irrelevant in BOTH directions', async () => {
    // A draft is mail, not a record. `records: Full` must not open the door and
    // `records: None` must not close it — the same independence §5.5 established
    // for the Tags field.
    await expect(
      drafts(capabilitiesFor({ inboxes: Level.None, records: Level.Full })).upsert({
        integrationId: 'int_1',
      })
    ).rejects.toMatchObject(FORBIDDEN)
    await expect(
      drafts(capabilitiesFor({ records: Level.None })).upsert({ integrationId: 'int_1' })
    ).resolves.toBeDefined()
  })

  it('the §7 lens denial from the service surfaces as 403, not 500', async () => {
    // `DraftService.assertCanDraftOnThread` throws a `ForbiddenError` from
    // inside `upsert`'s try block. The blanket `INTERNAL_SERVER_ERROR` catch
    // turned every lens denial into "Failed to save draft." — a 500 that reads
    // as a bug rather than a denial, and that no test could distinguish from
    // one. Guarded on `isAuxxError` now.
    draftService.upsert.mockRejectedValueOnce(
      Object.assign(new Error('no full lens'), { name: 'ForbiddenError', statusCode: 403 })
    )
    await expect(
      drafts(capabilitiesFor()).upsert({ integrationId: 'int_1', threadId: THREAD_ID })
    ).rejects.toMatchObject(FORBIDDEN)
  })

  it('a genuine failure is still a 500', async () => {
    // The over-denial control for the line above: `isAuxxError` must not swallow
    // the blanket catch it guards.
    draftService.upsert.mockRejectedValueOnce(new Error('db exploded'))
    await expect(
      drafts(capabilitiesFor()).upsert({ integrationId: 'int_1' })
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' })
  })
})

describe('positive control — the dispatch-org assignee must still be able to draft', () => {
  it('baseline Read, records: None, an explicit `none` row on the inbox — drafts anyway', async () => {
    // The controller/dispatch pattern (§1.4): the shared inbox is floored at
    // `none`, a controller assigns, and the assignee holds NO positive row on
    // that inbox by construction. Assignment confers the `full` lens, and
    // replying is the entire job. An inbox-instance assert on this router — the
    // "defence in depth" that looks obviously right — would deny exactly them.
    //
    // The first expectation is the proof that such a gate WOULD have bitten.
    const assignee = capabilitiesFor({
      inboxes: Level.Read,
      records: Level.None,
      instances: { [INBOX_ID]: 'none' },
    })
    expect(assignee.canViewInstance('inbox', INBOX_ID)).toBe(false)

    await expect(
      drafts(assignee).upsert({ integrationId: 'int_1', threadId: THREAD_ID })
    ).resolves.toBeDefined()
    await expect(drafts(assignee).getByThreadId({ threadId: THREAD_ID })).resolves.toBeDefined()
    await expect(drafts(assignee).delete({ draftId: DRAFT_ID })).resolves.toBeDefined()
    await expect(drafts(assignee).list()).resolves.toBeDefined()
  })

  it('a member at area None with ONE explicit inbox `view` row gets in', async () => {
    // Plan 25 §2 / `INSTANCE_ACCESS_READ_KEYS`: the composer synthesizes the
    // area's Read rung from instance grants, so the front door opens for them.
    const single = capabilitiesFor({
      inboxes: Level.None,
      records: Level.None,
      instances: { [INBOX_ID]: 'read' },
      derivedKeys: [PermissionKey.inboxesView],
    })
    expect(single.areaLevel(Area.inboxes)).toBe(Level.None)
    await expect(drafts(single).list()).resolves.toBeDefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// GAP 2 — self-revoke on an inbox grant
// ═══════════════════════════════════════════════════════════════════════════

describe('resourceAccess.revokeInstance — self-revoke on an inbox (restored)', () => {
  const revoke = (
    recordId: string,
    granteeId: string,
    granteeType: ResourceGranteeType = ResourceGranteeType.user
  ) => sharing(capabilitiesFor()).revokeInstance({ recordId, granteeType, granteeId })

  it('a `view` grantee removes their OWN inbox row without manage rights', async () => {
    // The regression: phase 1 made `inbox` an instance-access key, so this call
    // started routing through `assertAdminInstance` — which a `view` grantee
    // fails — and never reached the guard's self-revoke hatch.
    getCapabilities.mockResolvedValue(capabilitiesFor({ instances: { [INBOX_ID]: 'read' } }))
    await expect(revoke(INBOX_RECORD_ID, USER_ID)).resolves.toEqual({ revoked: true })
    expect(resourceAccess.revokeInstanceAccess).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_ID }),
      expect.objectContaining({ recordId: INBOX_RECORD_ID, granteeId: USER_ID })
    )
    // Neither authorizer ran — the hatch answered first, as it did pre-phase-1.
    expect(getCapabilities).not.toHaveBeenCalled()
    expect(resourceAccess.assertCanManageMailSharing).not.toHaveBeenCalled()
  })

  it('a member with NO row at all can self-revoke (a no-op delete, not an escalation)', async () => {
    // Pre-phase-1 behaviour, restored faithfully: the hatch never consulted the
    // caller's permission, and `revokeInstanceAccess` only ever deletes the row
    // naming them — so the worst case is deleting nothing.
    getCapabilities.mockResolvedValue(capabilitiesFor())
    await expect(revoke(INBOX_RECORD_ID, USER_ID)).resolves.toEqual({ revoked: true })
  })

  it('it works for a personal_inbox target too', async () => {
    getCapabilities.mockResolvedValue(capabilitiesFor())
    await expect(revoke(`personal_inbox:${INBOX_ID}`, USER_ID)).resolves.toEqual({ revoked: true })
    expect(getCapabilities).not.toHaveBeenCalled()
  })

  it('it survives a CUID-keyed inbox RecordId (canonicalization runs first)', async () => {
    // Record-layer callers carry the def CUID. `canonicalMailRecordId` rewrites
    // it to the slug BEFORE authorization, so the self-revoke test must see the
    // canonical key — testing the raw input would miss this shape.
    getCapabilities.mockResolvedValue(capabilitiesFor())
    await expect(revoke(`${INBOX_DEF_ID}:${INBOX_ID}`, USER_ID)).resolves.toEqual({ revoked: true })
    expect(resourceAccess.revokeInstanceAccess).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recordId: INBOX_RECORD_ID })
    )
  })

  // ── the negatives ────────────────────────────────────────────────────────

  it('CANNOT revoke someone ELSE’s inbox row', async () => {
    getCapabilities.mockResolvedValue(capabilitiesFor({ instances: { [INBOX_ID]: 'read' } }))
    await expect(revoke(INBOX_RECORD_ID, OTHER_USER_ID)).rejects.toMatchObject(FORBIDDEN)
    expect(resourceAccess.revokeInstanceAccess).not.toHaveBeenCalled()
    // It fell through to the instance authorizer, exactly as before.
    expect(getCapabilities).toHaveBeenCalled()
  })

  it('CANNOT self-revoke a group/profile/role row — shared policy is not one holder’s', async () => {
    // Deleting a `group` row that happens to carry the caller's id would
    // silently revoke everyone else in the group. `user` grantees only.
    getCapabilities.mockResolvedValue(capabilitiesFor({ instances: { [INBOX_ID]: 'read' } }))
    for (const granteeType of [
      ResourceGranteeType.group,
      ResourceGranteeType.role,
      ResourceGranteeType.profile,
    ]) {
      await expect(revoke(INBOX_RECORD_ID, USER_ID, granteeType)).rejects.toMatchObject(FORBIDDEN)
    }
    expect(resourceAccess.revokeInstanceAccess).not.toHaveBeenCalled()
  })

  it('does NOT leak to non-mail instance-access targets (datasets keep assertAdminInstance)', async () => {
    // Datasets never had the hatch — `assertCanManageMailSharing` no-ops on a
    // non-mail def — so widening the restoration to every instance-access key
    // would be a new capability, not a restoration.
    getCapabilities.mockResolvedValue(capabilitiesFor({ instances: { [DATASET_ID]: 'read' } }))
    await expect(revoke(`dataset:${DATASET_ID}`, USER_ID)).rejects.toMatchObject(FORBIDDEN)
    expect(resourceAccess.revokeInstanceAccess).not.toHaveBeenCalled()
  })

  it('a THREAD/CONTACT target still routes to the mail guard, hatch and all', async () => {
    // Those two branches are explicitly out of scope (§2). They keep their own
    // self-revoke handling INSIDE the guard, which is where it always was.
    getCapabilities.mockResolvedValue(capabilitiesFor())
    await expect(revoke(CONTACT_RECORD_ID, USER_ID)).resolves.toEqual({ revoked: true })
    // Canonicalized to the slug keyspace first (#1388), then handed to the guard
    // WITH the self-revoke opts — the hatch stays where it always lived.
    expect(resourceAccess.assertCanManageMailSharing).toHaveBeenCalledWith(
      expect.anything(),
      'contact:cnt_cuid00000000000000000a',
      { selfRevokeGranteeId: USER_ID, selfRevokeGranteeType: ResourceGranteeType.user }
    )
  })

  it('self-revoke is confined to revokeInstance — it is no route around the Enterprise gate', async () => {
    // The only mail plan gate is `assertMailSharingFeature`, and it lives on the
    // WIDENING procedures. A caller naming themselves as grantee on
    // `grantInstance`/`setInstance` gets no hatch: both still take the instance
    // authorizer AND the plan gate on its own unconditional line (§2).
    getCapabilities.mockResolvedValue(capabilitiesFor({ instances: { [INBOX_ID]: 'read' } }))
    await expect(
      sharing(capabilitiesFor()).grantInstance({
        recordId: INBOX_RECORD_ID,
        granteeType: ResourceGranteeType.user,
        granteeId: USER_ID,
        rung: 'admin',
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(resourceAccess.grantInstanceAccess).not.toHaveBeenCalled()

    await expect(
      sharing(capabilitiesFor()).setInstance({
        recordId: INBOX_RECORD_ID,
        granteeType: ResourceGranteeType.user,
        grants: [{ granteeId: USER_ID, rung: 'admin' }],
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(resourceAccess.setInstanceAccess).not.toHaveBeenCalled()
  })

  it('a Manager self-revoking still fires the plan gate on the GRANT side (hoist intact)', async () => {
    // Phase 3 hoisted `assertMailSharingFeature` out of the
    // `if (!authorizeInstanceTarget)` block. Pin it: an inbox Manager granting a
    // sub-`full` lens must still hit the gate.
    getCapabilities.mockResolvedValue(capabilitiesFor({ instances: { [INBOX_ID]: 'admin' } }))
    await expect(
      sharing(capabilitiesFor()).grantInstance({
        recordId: INBOX_RECORD_ID,
        granteeType: ResourceGranteeType.user,
        granteeId: OTHER_USER_ID,
        rung: 'identity',
      })
    ).resolves.toEqual({ success: true })
    expect(resourceAccess.assertMailSharingFeature).toHaveBeenCalledWith(
      expect.anything(),
      INBOX_RECORD_ID,
      [expect.objectContaining({ rung: 'identity' })]
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// GAP 3 — why `getIntegrations` did NOT move to assertViewInstance
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Plan §5.3 prescribes `assertViewInstance('inbox' | 'personal_inbox', id)` for
 * `inbox.getIntegrations`. This block WAS the evidence for leaving that gate on
 * `InboxService.hasUserAccess`: the two predicates disagreed on the majority
 * path, because `effectiveInstanceLevel` read the org-wide set as "carries ≥1
 * row for anyone" while mail's `rowGoverned` counted only a `role:org_member`
 * baseline or a `none` marker — and `createInbox` writes a creator row on every
 * inbox.
 *
 * **That divergence is GONE (2026-07-29).** The capability layer now uses mail's
 * predicate verbatim (`governingInstanceIds`) and reads the caller's own row
 * before the set, so a creator-row-only inbox is unrestricted in BOTH layers.
 * Per this block's own standing instruction — "if they ever start failing, the
 * migration has become safe and should be done" — these cases were rewritten to
 * pin the AGREEMENT, and **the migration has since been done**: `getIntegrations`
 * asserts `assertViewInstance(resolveInboxDefKey(...), inboxId)`. This block stays
 * as the predicate-level evidence underneath that router test — if these ever
 * start failing again, the router gate is the thing that has to move back.
 */
describe('gap 3 — `assertViewInstance` and mail visibility now AGREE on the majority path', () => {
  // `createInbox` writes its creator a `user @ admin` row on every inbox, and
  // `isGoverningInstanceRow` rejects it — sharing is not restricting — so the
  // governing set is EMPTY for an otherwise-untouched inbox.
  const withCreatorRow = (opts: CapsOpts = {}) =>
    capabilitiesFor({
      ...opts,
      instances: opts.instances ?? {},
      restricted: [CREATOR_ROW].filter(isGoverningInstanceRow).map((r) => r.instanceId),
    })

  it('a baseline member can open an ordinary shared inbox they can fully read', () => {
    // Was `false` — the live 403. The creator's row governs nothing, so the
    // `Area.inboxes` fallback supplies `view`, matching the `full` lens
    // `composeUserInstanceGrants` computes from the same absence.
    expect(withCreatorRow().canViewInstance('inbox', INBOX_ID)).toBe(true)
  })

  it('so can a non-granted ADMIN, who also gets Manager authority', () => {
    const admin = withCreatorRow({ role: 'ADMIN', inboxes: Level.Full })
    expect(admin.canViewInstance('inbox', INBOX_ID)).toBe(true)
    expect(admin.canAdminInstance('inbox', INBOX_ID)).toBe(true)
  })

  it('the OWNER passes on a shared inbox, and still NOT on a personal mailbox', () => {
    expect(withCreatorRow({ role: 'OWNER' }).canViewInstance('inbox', INBOX_ID)).toBe(true)
    // The privacy property (§0.2) is unaffected: the OWNER bypass is scoped to
    // `baselineAtCreate: false`, and own-row-first cannot manufacture a row.
    expect(withCreatorRow({ role: 'OWNER' }).canViewInstance('personal_inbox', INBOX_ID)).toBe(
      false
    )
  })

  it('an AUTHORED restriction still parts the two layers the way it should', () => {
    // The remaining asymmetry is the intended one: a `role:org_member @ none`
    // baseline governs, so a non-grantee is refused — in both layers.
    expect(capabilitiesFor({ restricted: [INBOX_ID] }).canViewInstance('inbox', INBOX_ID)).toBe(
      false
    )
  })

  it('an explicit grantee is served, on either inbox def', () => {
    expect(
      withCreatorRow({ instances: { [INBOX_ID]: 'read' } }).canViewInstance('inbox', INBOX_ID)
    ).toBe(true)
    // A personal mailbox's owner holds the `admin` row, keyed by the def the
    // instance actually lives on — never derived from `isPersonal`.
    expect(
      withCreatorRow({ instances: { [INBOX_ID]: 'admin' } }).canViewInstance(
        'personal_inbox',
        INBOX_ID
      )
    ).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Structural invariants
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The behavioral blocks run against a stubbed `~/server/api/trpc`, so they
 * cannot see a downgrade of the procedure BUILDER itself — and this router's
 * pre-fix state was exactly that: eight bare `protectedProcedure`s.
 */
describe('draft router — structural invariants', () => {
  const src = fs.readFileSync(path.resolve(APP_ROOT, 'src/server/api/routers/draft.ts'), 'utf8')

  const PROCEDURES = [
    'delete',
    'getById',
    'getByIds',
    'getByThreadId',
    'getDraftId',
    'hasDraft',
    'list',
    'upsert',
  ]

  it('the front door is the inboxes Read rung, declared once', () => {
    expect(src).toContain('permissionProcedure(PermissionKey.inboxesView)')
  })

  it('every procedure builds on it — no bare protectedProcedure survives', () => {
    for (const name of PROCEDURES) {
      expect(src, `${name} must build on the mail front door`).toContain(`${name}: mailProcedure`)
    }
    expect(src).not.toContain(': protectedProcedure')
    expect(src).not.toContain(': publicProcedure')
  })

  it('the procedure list is exhaustive — a NEW draft procedure must be gated too', () => {
    const declared = [...src.matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9]*): mailProcedure/gm)].map(
      (m) => m[1] as string
    )
    expect(declared.sort()).toEqual([...PROCEDURES].sort())
  })

  it('no draft procedure reaches for the inbox instance layer (§1.4)', () => {
    expect(src).not.toContain('canViewInstance')
    expect(src).not.toContain('assertViewInstance')
    expect(src).not.toContain('assertAdminInstance')
  })
})
