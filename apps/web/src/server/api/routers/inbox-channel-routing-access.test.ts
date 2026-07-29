// apps/web/src/server/api/routers/inbox-channel-routing-access.test.ts

import fs from 'node:fs'
import path from 'node:path'
import { ResourcePermission } from '@auxx/database/enums'
import type { OrganizationRole, SeatType } from '@auxx/database/types'
import { PermissionKey } from '@auxx/lib/permissions/capabilities/registry'
import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 40 phase 0a — the channels↔inboxes seam, driven for real.
 *
 * The hole this closes (plan 40 §5.1, verified at HEAD before the fix):
 *
 *  1. `inbox.create` was a bare `protectedProcedure` — any member could make an
 *     inbox.
 *  2. `createInbox` writes the creator an `admin` ResourceAccess row, so they
 *     are its Manager by construction.
 *  3. `inbox.addIntegration` asserted manage access on the TARGET inbox only.
 *  4. `InboxService.addIntegration` silently RE-POINTS an already-routed
 *     channel rather than refusing.
 *
 * Four calls, and an ordinary member owns the company's support mail: future
 * messages land in their inbox (`defaultLens: 'full'`, and they hold `admin`)
 * and stop arriving in the real one. Exfiltration plus denial of service.
 *
 * The gate map under test (§1.0 — channels own the plumbing, inboxes own the
 * work; `inbox` is not an `InstanceAccessKey` until phase 1, so the inbox half
 * stays on the existing `InboxService` predicates):
 *
 * | procedure                | coarse key        | instance assert                    |
 * |--------------------------|-------------------|------------------------------------|
 * | `getIntegrations`        | `inboxes.view`    | `assertViewInstance` on target      |
 * | `create`                 | `channels.manage` | —                                   |
 * | `delete`                 | `channels.manage` | manage on target                    |
 * | `addIntegration`         | `channels.manage` | manage on target AND on the SOURCE  |
 * | `removeIntegration`      | `channels.manage` | manage on target (target IS source) |
 * | `moveIntegrationThreads` | `channels.manage` | manage on both sides                |
 *
 * These are behavioral: the router module is imported for real and driven
 * through a tRPC caller whose `ctx.capabilities` is a REAL `CapabilitySet`, so
 * the coarse assert is the shipped one. The inbox-side asserts are observed
 * through a fixture-backed `InboxService` stand-in — deleting an assert makes
 * the matching "refused" case fail, because the mocked write would be reached.
 */

const ORG_ID = 'org_cuid000000000000000000000'
/** The attacker: an ordinary member, no admin rank. */
const USER_ID = 'usr_member00000000000000000'
/** The org's real support inbox. The member manages nothing on it. */
const SUPPORT_INBOX = 'ibx_support0000000000000000'
/** An inbox the member created — Manager of it by construction (step 2). */
const OWN_INBOX = 'ibx_own00000000000000000000'
/** A third inbox the member neither created nor was granted. */
const OTHER_INBOX = 'ibx_other000000000000000000'
/** A personal mailbox — §11 isolation, unreachable from this endpoint. */
const PERSONAL_INBOX = 'ibx_personal000000000000000'
/** The company support channel, currently routed to {@link SUPPORT_INBOX}. */
const SUPPORT_CHANNEL = 'int_support0000000000000000'
/** A channel that routes nowhere yet. */
const FRESH_CHANNEL = 'int_fresh000000000000000000'

/**
 * The world the stand-in `InboxService` answers from. Mutated per test.
 *
 * `manage` / `view` are the two predicates the router actually consults
 * (`canManageInboxAccess` / `hasUserAccess`), kept as plain id sets so a test
 * states its premise — "this member manages exactly their own inbox" — instead
 * of stubbing a call sequence.
 */
const { world, service } = vi.hoisted(() => {
  const world = {
    manage: new Set<string>(),
    view: new Set<string>(),
    personal: new Set<string>(),
    /** integrationId → the inbox instance it currently routes to. */
    routes: {} as Record<string, string | undefined>,
  }

  const instanceIdOf = (recordId: unknown) => String(recordId).split(':')[1] ?? String(recordId)
  const inboxFor = (id: string) => ({
    id,
    recordId: `inbox:${id}`,
    name: id,
    isPersonal: world.personal.has(id),
  })

  const service = {
    canManageInboxAccess: vi.fn(async (recordId: unknown) =>
      world.manage.has(instanceIdOf(recordId))
    ),
    hasUserAccess: vi.fn(async (recordId: unknown) => world.view.has(instanceIdOf(recordId))),
    getInbox: vi.fn(async (recordId: unknown) => inboxFor(instanceIdOf(recordId))),
    getIntegrationInbox: vi.fn(async (integrationId: string) => {
      const inboxId = world.routes[integrationId]
      return inboxId ? inboxFor(inboxId) : null
    }),
    getInboxWithIntegrationsById: vi.fn(async (inboxId: string) => ({
      ...inboxFor(inboxId),
      integrations: [{ id: 'lnk_1', integrationId: SUPPORT_CHANNEL }],
    })),
    createInbox: vi.fn(async () => ({ id: 'ibx_new0000000000000000000' })),
    deleteInboxById: vi.fn(async () => undefined),
    addIntegration: vi.fn(async () => ({ id: 'lnk_new' })),
    removeIntegration: vi.fn(async () => true),
  }

  return { world, service }
})

vi.mock('@auxx/lib/inboxes', () => ({
  InboxService: class {
    canManageInboxAccess = service.canManageInboxAccess
    hasUserAccess = service.hasUserAccess
    getInbox = service.getInbox
    getIntegrationInbox = service.getIntegrationInbox
    getInboxWithIntegrationsById = service.getInboxWithIntegrationsById
    createInbox = service.createInbox
    deleteInboxById = service.deleteInboxById
    addIntegration = service.addIntegration
    removeIntegration = service.removeIntegration
  },
}))

const { threadMutation, channels, recordAuditFromCtx } = vi.hoisted(() => ({
  threadMutation: {
    moveIntegrationThreadsToInbox: vi.fn(async () => ({ count: 3 })),
    countIntegrationThreadsInInbox: vi.fn(async () => 3),
  },
  channels: {
    claimPersonalInbox: vi.fn(async () => undefined),
    deletePersonalInbox: vi.fn(async () => undefined),
  },
  recordAuditFromCtx: vi.fn(async () => undefined),
}))

vi.mock('@auxx/lib/threads', () => ({
  ThreadMutationService: class {
    moveIntegrationThreadsToInbox = threadMutation.moveIntegrationThreadsToInbox
    countIntegrationThreadsInInbox = threadMutation.countIntegrationThreadsInInbox
  },
}))
vi.mock('@auxx/lib/channels', () => channels)
vi.mock('~/server/api/audit-context', () => ({ recordAuditFromCtx }))
vi.mock('@auxx/lib/cache', () => ({
  getCachedUserMailVisibility: vi.fn(async () => ({ isAdmin: false, inboxLens: {} })),
  getOrgCache: () => ({ get: async () => [] }),
}))
vi.mock('@auxx/lib/permissions/visibility', () => ({ inboxLensFor: () => 'none' }))

// The `@auxx/lib/permissions` barrel reaches redis/db at import time and hangs
// under vitest. Re-export the REAL registry — `PermissionKey.channelsManage` is
// the value the gates are keyed on, so a stub would test nothing.
vi.mock('@auxx/lib/permissions', async () => {
  const registry = await import('@auxx/lib/permissions/capabilities/registry')
  return { PermissionKey: registry.PermissionKey }
})

/**
 * The `permissionProcedure` stand-in mirrors the REAL builder's gate: a plain
 * `capabilities.assert(key)`. Only the plan-AND and the `getCapabilities` read
 * are dropped (ctx carries the set already) — and `channels.manage` carries no
 * `featureKey` in `PERMISSION_REGISTRY`, so there is no plan-AND to reproduce.
 * Asserted below so that stays true.
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
  }
})

// Deep path on purpose — the permissions barrel hangs under vitest.
const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { PERMISSION_REGISTRY_MAP } = await import('@auxx/lib/permissions/capabilities/registry')
const { inboxRouter } = await import('./inbox')

/** AuxxError, wrapped by tRPC as `cause`; the app's middleware maps it to 403. */
const FORBIDDEN_CAPABILITY = { cause: { name: 'ForbiddenError', statusCode: 403 } }
/** The inbox-side asserts are router-local `TRPCError`s (pre-existing shape). */
const FORBIDDEN_INSTANCE = { code: 'FORBIDDEN' }
const BAD_REQUEST = { code: 'BAD_REQUEST' }

interface CapsOpts {
  role?: OrganizationRole
  seatType?: SeatType
  /** The member's `Area.channels` level. Defaults to `None` — the USER floor. */
  channels?: Level
  /** The member's `Area.inboxes` level. Defaults to `Read` — the Member baseline. */
  inboxes?: Level
  /** The member's OWN instance rows, `instanceId → permission`. */
  instances?: Record<string, ResourcePermission>
  /**
   * The org-wide ROW-GOVERNED set (`governingInstanceIds`): a `role:org_member`
   * baseline at any permission, or any `none` marker. **Not** "carries ≥1 row" —
   * a creator's `user @ admin` row governs nothing, which is exactly what
   * unblocked the `assertViewInstance` migration. Defaults to the granted ids.
   */
  governing?: string[]
  /** Front-door keys synthesized from instance grants (`instanceDerivedKeys`). */
  derivedKeys?: PermissionKey[]
}

function capabilitiesFor(opts: CapsOpts = {}) {
  const instances = opts.instances ?? {}
  return new CapabilitySet(
    new Set(
      expandLevelsToKeys({
        [Area.channels]: opts.channels ?? Level.None,
        [Area.inboxes]: opts.inboxes ?? Level.Read,
      })
    ),
    {},
    opts.role ?? 'MEMBER',
    opts.seatType ?? 'full',
    (id) => id,
    new Set(),
    (id) => id,
    instances,
    new Set(opts.governing ?? Object.keys(instances)),
    {},
    new Set(opts.derivedKeys ?? [])
  )
}

function caller(capabilities: InstanceType<typeof CapabilitySet>) {
  return inboxRouter.createCaller({
    db: {},
    headers: new Headers(),
    capabilities,
    session: {
      organizationId: ORG_ID,
      userId: USER_ID,
      user: { id: USER_ID, defaultOrganizationId: ORG_ID },
    },
  } as never)
}

/** A member with the coarse channels key but no inbox rows of their own. */
const CHANNEL_ADMIN = () => capabilitiesFor({ channels: Level.Full })
/** The §5.1 attacker: an ordinary member, `Area.channels` shut. */
const PLAIN_MEMBER = () => capabilitiesFor({ channels: Level.None })

/**
 * Every mutation that shapes inbox inventory or channel routing, with the
 * minimum valid input and the side effect that proves it got through. Used for
 * the coarse-key sweeps, where the member manages EVERY inbox — so the only
 * thing that can refuse them is `channels.manage`.
 */
type Caller = ReturnType<typeof caller>
const CHANNEL_KEYED = [
  ['create', (c: Caller) => c.create({ name: 'Mine' }), () => service.createInbox],
  ['delete', (c: Caller) => c.delete({ inboxId: OWN_INBOX }), () => service.deleteInboxById],
  [
    'addIntegration',
    (c: Caller) =>
      c.addIntegration({ recordId: `inbox:${OWN_INBOX}`, integrationId: FRESH_CHANNEL }),
    () => service.addIntegration,
  ],
  [
    'removeIntegration',
    (c: Caller) => c.removeIntegration({ inboxId: OWN_INBOX, integrationId: SUPPORT_CHANNEL }),
    () => service.removeIntegration,
  ],
  [
    'moveIntegrationThreads',
    (c: Caller) =>
      c.moveIntegrationThreads({
        integrationId: SUPPORT_CHANNEL,
        fromInboxRecordId: `inbox:${SUPPORT_INBOX}`,
        toInboxRecordId: `inbox:${OWN_INBOX}`,
      }),
    () => threadMutation.moveIntegrationThreadsToInbox,
  ],
] as const

beforeEach(() => {
  // `mockReset()`, not `mockClear()`: a `mockResolvedValueOnce` queue survives
  // `mockClear`, and a leftover once-value shifts every later one — which makes
  // a mutated source line look caught when it is not.
  for (const fn of Object.values(service)) fn.mockReset()
  service.canManageInboxAccess.mockImplementation(async (recordId: unknown) =>
    world.manage.has(String(recordId).split(':')[1] ?? '')
  )
  service.hasUserAccess.mockImplementation(async (recordId: unknown) =>
    world.view.has(String(recordId).split(':')[1] ?? '')
  )
  service.getInbox.mockImplementation(async (recordId: unknown) => {
    const id = String(recordId).split(':')[1] ?? ''
    return { id, recordId: `inbox:${id}`, name: id, isPersonal: world.personal.has(id) }
  })
  service.getIntegrationInbox.mockImplementation(async (integrationId: string) => {
    const id = world.routes[integrationId]
    return id ? { id, recordId: `inbox:${id}`, name: id, isPersonal: world.personal.has(id) } : null
  })
  service.getInboxWithIntegrationsById.mockImplementation(async (inboxId: string) => ({
    id: inboxId,
    recordId: `inbox:${inboxId}`,
    name: inboxId,
    isPersonal: false,
    integrations: [{ id: 'lnk_1', integrationId: SUPPORT_CHANNEL }],
  }))
  service.createInbox.mockResolvedValue({ id: 'ibx_new0000000000000000000' } as never)
  service.deleteInboxById.mockResolvedValue(undefined as never)
  service.addIntegration.mockResolvedValue({ id: 'lnk_new' } as never)
  service.removeIntegration.mockResolvedValue(true as never)

  threadMutation.moveIntegrationThreadsToInbox.mockReset()
  threadMutation.moveIntegrationThreadsToInbox.mockResolvedValue({ count: 3 } as never)
  threadMutation.countIntegrationThreadsInInbox.mockReset()
  threadMutation.countIntegrationThreadsInInbox.mockResolvedValue(3 as never)
  recordAuditFromCtx.mockReset()
  recordAuditFromCtx.mockResolvedValue(undefined as never)

  world.manage = new Set()
  world.view = new Set()
  world.personal = new Set([PERSONAL_INBOX])
  world.routes = { [SUPPORT_CHANNEL]: SUPPORT_INBOX, [FRESH_CHANNEL]: undefined }
})

/**
 * Plan 40 §12: "a non-admin member must not re-route a channel into an inbox
 * they created." Driven end to end, in the order the exploit runs.
 */
describe('§5.1 regression — the four-call channel hijack', () => {
  it('step 1: an ordinary member can no longer create an inbox at all', async () => {
    await expect(caller(PLAIN_MEMBER()).create({ name: 'Mine' })).rejects.toMatchObject(
      FORBIDDEN_CAPABILITY
    )
    expect(service.createInbox).not.toHaveBeenCalled()
  })

  it('step 3: even holding admin on their OWN inbox, the member cannot re-route', async () => {
    // The exploit's premise granted in full — they created the inbox, so they
    // are its Manager (step 2), and the target assert passes. `channels.manage`
    // is what stops them, and it is the gate `create` denies them anyway.
    world.manage = new Set([OWN_INBOX])
    world.view = new Set([OWN_INBOX])
    await expect(
      caller(PLAIN_MEMBER()).addIntegration({
        recordId: `inbox:${OWN_INBOX}`,
        integrationId: SUPPORT_CHANNEL,
      })
    ).rejects.toMatchObject(FORBIDDEN_CAPABILITY)
    expect(service.addIntegration).not.toHaveBeenCalled()
  })

  it('THE FIX: `channels.manage` alone does not let them steal a channel they do not source-manage', async () => {
    // The layered half, and the one that survives independently of the coarse
    // key: a genuine channel administrator who manages their own inbox but NOT
    // the support inbox still cannot pull the support channel out of it.
    // Before phase 0a the router asserted the target only, so this succeeded.
    world.manage = new Set([OWN_INBOX])
    await expect(
      caller(CHANNEL_ADMIN()).addIntegration({
        recordId: `inbox:${OWN_INBOX}`,
        integrationId: SUPPORT_CHANNEL,
      })
    ).rejects.toMatchObject(FORBIDDEN_INSTANCE)
    expect(service.addIntegration).not.toHaveBeenCalled()
    // The source WAS consulted — a fix that merely re-asserted the target would
    // pass the line above by accident.
    expect(service.canManageInboxAccess).toHaveBeenCalledWith(`inbox:${SUPPORT_INBOX}`, USER_ID)
  })

  it('step 4: the service is told which inbox the caller authorized moving FROM', async () => {
    // The router's decision has to reach the write, or the service is back to
    // re-pointing on trust. `repointFromInboxId` is what `InboxService` re-checks
    // inside its transaction.
    world.manage = new Set([OWN_INBOX, SUPPORT_INBOX])
    await expect(
      caller(CHANNEL_ADMIN()).addIntegration({
        recordId: `inbox:${OWN_INBOX}`,
        integrationId: SUPPORT_CHANNEL,
      })
    ).resolves.toBeDefined()
    expect(service.addIntegration).toHaveBeenCalledWith(
      `inbox:${OWN_INBOX}`,
      SUPPORT_CHANNEL,
      undefined,
      undefined,
      { repointFromInboxId: SUPPORT_INBOX }
    )
  })

  it('and the source it names is the one it authorized, not the one it was handed', async () => {
    // Guards the shape of the fix: the acknowledgement must be derived from the
    // inbox the router checked, so a caller cannot supply their own.
    world.manage = new Set([OWN_INBOX, SUPPORT_INBOX])
    await caller(CHANNEL_ADMIN()).addIntegration({
      recordId: `inbox:${OWN_INBOX}`,
      integrationId: SUPPORT_CHANNEL,
    })
    const authorized = service.canManageInboxAccess.mock.calls.map((c) => c[0])
    const [, , , , options] = service.addIntegration.mock.calls[0] as unknown as [
      string,
      string,
      unknown,
      unknown,
      { repointFromInboxId?: string },
    ]
    expect(authorized).toContain(`inbox:${options.repointFromInboxId}`)
  })
})

describe('addIntegration — the source-inbox gate', () => {
  it('a fresh channel needs no source assert and carries no acknowledgement', async () => {
    // The positive control the denial tests are blind to: routing a channel
    // that is not yet linked anywhere must stay a one-sided operation, or every
    // channel connect breaks.
    world.manage = new Set([OWN_INBOX])
    await expect(
      caller(CHANNEL_ADMIN()).addIntegration({
        recordId: `inbox:${OWN_INBOX}`,
        integrationId: FRESH_CHANNEL,
      })
    ).resolves.toBeDefined()
    expect(service.addIntegration).toHaveBeenCalledWith(
      `inbox:${OWN_INBOX}`,
      FRESH_CHANNEL,
      undefined,
      undefined,
      { repointFromInboxId: undefined }
    )
  })

  it('re-adding a channel to the inbox it already routes to is not a re-point', async () => {
    // Idempotent settings/isDefault updates must not demand an assert on the
    // inbox the caller already passed the target assert for.
    world.manage = new Set([SUPPORT_INBOX])
    await expect(
      caller(CHANNEL_ADMIN()).addIntegration({
        recordId: `inbox:${SUPPORT_INBOX}`,
        integrationId: SUPPORT_CHANNEL,
        isDefault: true,
      })
    ).resolves.toBeDefined()
    expect(service.addIntegration).toHaveBeenCalledWith(
      `inbox:${SUPPORT_INBOX}`,
      SUPPORT_CHANNEL,
      true,
      undefined,
      { repointFromInboxId: undefined }
    )
  })

  it('managing the SOURCE but not the target is refused too — both ends, not either', async () => {
    world.manage = new Set([SUPPORT_INBOX])
    await expect(
      caller(CHANNEL_ADMIN()).addIntegration({
        recordId: `inbox:${OTHER_INBOX}`,
        integrationId: SUPPORT_CHANNEL,
      })
    ).rejects.toMatchObject(FORBIDDEN_INSTANCE)
    expect(service.addIntegration).not.toHaveBeenCalled()
  })

  it('the §11 personal-channel rules still hold ahead of the source gate', async () => {
    // Ordering matters: a personal channel must read as "cannot be re-routed"
    // (400) rather than leaking whether the caller manages its owner's mailbox.
    world.manage = new Set([OWN_INBOX])
    world.routes = { [SUPPORT_CHANNEL]: PERSONAL_INBOX }
    await expect(
      caller(CHANNEL_ADMIN()).addIntegration({
        recordId: `inbox:${OWN_INBOX}`,
        integrationId: SUPPORT_CHANNEL,
      })
    ).rejects.toMatchObject(BAD_REQUEST)
    expect(service.addIntegration).not.toHaveBeenCalled()
  })

  it('routing INTO a personal inbox is still refused', async () => {
    world.manage = new Set([PERSONAL_INBOX])
    await expect(
      caller(CHANNEL_ADMIN()).addIntegration({
        recordId: `inbox:${PERSONAL_INBOX}`,
        integrationId: FRESH_CHANNEL,
      })
    ).rejects.toMatchObject(BAD_REQUEST)
    expect(service.addIntegration).not.toHaveBeenCalled()
  })
})

describe('the coarse `channels.manage` gate', () => {
  it.each(CHANNEL_KEYED)('%s is refused at channels: None', async (_name, call, effect) => {
    // Every inbox manageable, so nothing but the coarse key can refuse them.
    world.manage = new Set([OWN_INBOX, SUPPORT_INBOX, OTHER_INBOX])
    await expect(call(caller(capabilitiesFor({ channels: Level.None })))).rejects.toMatchObject(
      FORBIDDEN_CAPABILITY
    )
    expect(effect()).not.toHaveBeenCalled()
  })

  it.each(
    CHANNEL_KEYED
  )('%s is refused for an org ADMIN whose profile shut the area', async (_name, call, effect) => {
    // Profile is THE control (plan 39): admin RANK buys nothing here.
    world.manage = new Set([OWN_INBOX, SUPPORT_INBOX, OTHER_INBOX])
    await expect(
      call(caller(capabilitiesFor({ role: 'ADMIN', channels: Level.None })))
    ).rejects.toMatchObject(FORBIDDEN_CAPABILITY)
    expect(effect()).not.toHaveBeenCalled()
  })

  it.each(
    CHANNEL_KEYED
  )('%s succeeds at channels: Full with manage on every inbox', async (_name, call, effect) => {
    // The positive control. Without it every case above would also pass on a
    // router that refused unconditionally.
    world.manage = new Set([OWN_INBOX, SUPPORT_INBOX, OTHER_INBOX])
    await expect(call(caller(CHANNEL_ADMIN()))).resolves.toBeDefined()
    expect(effect()).toHaveBeenCalledTimes(1)
  })

  it('`channels` is a Full-only area — there is no Read rung to hold', () => {
    // Pins the premise of the sweeps above: if a Read rung were ever added,
    // `Level.None` would stop being the only denying level and these tests
    // would silently narrow.
    const caps = capabilitiesFor({ channels: Level.Read })
    expect(caps.can(PermissionKey.channelsManage)).toBe(false)
  })

  it('neither gate key carries a featureKey, so the stand-in is faithful', () => {
    // The real `permissionProcedure` runs a plan-AND when the key links a
    // `FeatureKey`. Neither does — and if that changes, this mock stops
    // modelling the shipped builder and the suite must be updated.
    for (const key of [PermissionKey.channelsManage, PermissionKey.inboxesView]) {
      expect(PERMISSION_REGISTRY_MAP.get(key)?.featureKey).toBeUndefined()
    }
  })
})

describe('delete keeps its instance assert alongside the new key', () => {
  it('a channel administrator cannot delete an inbox they do not manage', async () => {
    world.manage = new Set([OWN_INBOX])
    await expect(caller(CHANNEL_ADMIN()).delete({ inboxId: SUPPORT_INBOX })).rejects.toMatchObject(
      FORBIDDEN_INSTANCE
    )
    expect(service.deleteInboxById).not.toHaveBeenCalled()
  })

  it('and can delete one they do', async () => {
    world.manage = new Set([OWN_INBOX])
    await expect(caller(CHANNEL_ADMIN()).delete({ inboxId: OWN_INBOX })).resolves.toEqual({
      success: true,
    })
    expect(service.deleteInboxById).toHaveBeenCalledWith(OWN_INBOX)
  })
})

describe('removeIntegration keeps its instance assert alongside the new key', () => {
  it('a channel administrator cannot unroute a channel from an inbox they do not manage', async () => {
    world.manage = new Set([OWN_INBOX])
    await expect(
      caller(CHANNEL_ADMIN()).removeIntegration({
        inboxId: SUPPORT_INBOX,
        integrationId: SUPPORT_CHANNEL,
      })
    ).rejects.toMatchObject(FORBIDDEN_INSTANCE)
    expect(service.removeIntegration).not.toHaveBeenCalled()
  })
})

describe('moveIntegrationThreads keeps its both-side asserts alongside the new key', () => {
  it('is refused when the caller manages only the destination', async () => {
    world.manage = new Set([OWN_INBOX])
    await expect(
      caller(CHANNEL_ADMIN()).moveIntegrationThreads({
        integrationId: SUPPORT_CHANNEL,
        fromInboxRecordId: `inbox:${SUPPORT_INBOX}`,
        toInboxRecordId: `inbox:${OWN_INBOX}`,
      })
    ).rejects.toMatchObject(FORBIDDEN_INSTANCE)
    expect(threadMutation.moveIntegrationThreadsToInbox).not.toHaveBeenCalled()
  })

  it('is refused when the caller manages only the source', async () => {
    world.manage = new Set([SUPPORT_INBOX])
    await expect(
      caller(CHANNEL_ADMIN()).moveIntegrationThreads({
        integrationId: SUPPORT_CHANNEL,
        fromInboxRecordId: `inbox:${SUPPORT_INBOX}`,
        toInboxRecordId: `inbox:${OWN_INBOX}`,
      })
    ).rejects.toMatchObject(FORBIDDEN_INSTANCE)
    expect(threadMutation.moveIntegrationThreadsToInbox).not.toHaveBeenCalled()
  })
})

/**
 * `getIntegrations` moved from `InboxService.hasUserAccess` onto §5.3's
 * prescribed `assertViewInstance` once the capability layer adopted mail's
 * `rowGoverned` predicate (`governingInstanceIds` + own-row-first, 2026-07-29).
 * Phase 0a could not: `createInbox` writes a creator `user @ admin` row on every
 * inbox, and the old "carries ≥1 row" reading turned that into "grantees only",
 * so the gate would have 403'd the ordinary member on the ordinary inbox.
 */
describe('getIntegrations — the read gate, now assertViewInstance (§5.2/§5.3)', () => {
  /** What `createInbox` leaves behind: a creator row that governs NOTHING. */
  const CREATOR_ROW_ONLY = { governing: [] as string[] }

  it('THE MIGRATION: a baseline member reads an ordinary shared inbox', async () => {
    // The case that blocked this for a phase: `SUPPORT_INBOX` carries the
    // creator's `user @ admin` row and no governing row, so the `Area.inboxes`
    // fallback supplies `view` — matching the `full` lens mail computes from the
    // same absence. Narrow the governing set back to "carries any row" and this
    // is the first thing that fails.
    await expect(
      caller(capabilitiesFor(CREATOR_ROW_ONLY)).getIntegrations({ inboxId: SUPPORT_INBOX })
    ).resolves.toEqual([{ id: 'lnk_1', integrationId: SUPPORT_CHANNEL }])
    expect(service.canManageInboxAccess).not.toHaveBeenCalled()
  })

  it('...and so does a default ADMIN holding no row of their own', async () => {
    await expect(
      caller(
        capabilitiesFor({ ...CREATOR_ROW_ONLY, role: 'ADMIN', inboxes: Level.Full })
      ).getIntegrations({ inboxId: SUPPORT_INBOX })
    ).resolves.toBeDefined()
  })

  it('needs no `channels.manage` — reading is not administering', async () => {
    await expect(
      caller(capabilitiesFor({ ...CREATOR_ROW_ONLY, channels: Level.None })).getIntegrations({
        inboxId: SUPPORT_INBOX,
      })
    ).resolves.toBeDefined()
  })

  it('an explicit `view` grantee reads it with the area shut', async () => {
    // Plan 25 §2: the front-door key is synthesized from the grant, and the
    // instance assert answers from the row. The single-inbox member must work.
    await expect(
      caller(
        capabilitiesFor({
          inboxes: Level.None,
          instances: { [SUPPORT_INBOX]: ResourcePermission.view },
          derivedKeys: [PermissionKey.inboxesView],
        })
      ).getIntegrations({ inboxId: SUPPORT_INBOX })
    ).resolves.toBeDefined()
  })

  // ── the negatives ────────────────────────────────────────────────────────

  it('an inbox at `role:org_member @ none` is refused for a non-grantee', async () => {
    // The AUTHORED restriction — the one thing that still parts a member from a
    // shared inbox, in both layers.
    await expect(
      caller(capabilitiesFor({ governing: [SUPPORT_INBOX] })).getIntegrations({
        inboxId: SUPPORT_INBOX,
      })
    ).rejects.toMatchObject(FORBIDDEN_CAPABILITY)
    expect(service.getInboxWithIntegrationsById).not.toHaveBeenCalled()
  })

  it('an explicit `none` row denies the member specifically', async () => {
    await expect(
      caller(
        capabilitiesFor({ instances: { [SUPPORT_INBOX]: ResourcePermission.none } })
      ).getIntegrations({ inboxId: SUPPORT_INBOX })
    ).rejects.toMatchObject(FORBIDDEN_CAPABILITY)
  })

  it('the coarse front door closes it too — `inboxes: None` means none', async () => {
    await expect(
      caller(capabilitiesFor({ ...CREATOR_ROW_ONLY, inboxes: Level.None })).getIntegrations({
        inboxId: SUPPORT_INBOX,
      })
    ).rejects.toMatchObject(FORBIDDEN_CAPABILITY)
    expect(service.getInboxWithIntegrationsById).not.toHaveBeenCalled()
  })

  it('denies before the lookup, so it cannot be used as an existence oracle', async () => {
    // A 403 for an inbox that does not exist must be indistinguishable from a
    // 403 for one that does. `resolveInboxDefKey` is an org-CACHE read, so the
    // gate itself takes no DB roundtrip that could leak the difference.
    const denied = capabilitiesFor({ governing: [SUPPORT_INBOX, 'ibx_doesnotexist0000000000'] })
    await expect(
      caller(denied).getIntegrations({ inboxId: 'ibx_doesnotexist0000000000' })
    ).rejects.toMatchObject(FORBIDDEN_CAPABILITY)
    await expect(caller(denied).getIntegrations({ inboxId: SUPPORT_INBOX })).rejects.toMatchObject(
      FORBIDDEN_CAPABILITY
    )
    expect(service.getInboxWithIntegrationsById).not.toHaveBeenCalled()
  })
})

/**
 * The four procedures phase 3 left on a bare `protectedProcedure` — each has a
 * per-instance guard or is lens-scoped, so they failed closed in practice, but
 * the coarse `Area.inboxes` front door was absent and `inboxes: None` did not
 * close them.
 *
 * `setAccessFloor` is exercised in `inbox-access-floor.test.ts`, which is the
 * only file that mocks `setInboxFloor`/`assertInboxFloorFeature`.
 */
describe('the mail front door (§5.3) — `inboxes: None` closes the working reads', () => {
  const MAIL_READS = [
    ['myLenses', (c: Caller) => c.myLenses()],
    ['getIntegrations', (c: Caller) => c.getIntegrations({ inboxId: SUPPORT_INBOX })],
    [
      'countMovableThreads',
      (c: Caller) =>
        c.countMovableThreads({
          integrationId: SUPPORT_CHANNEL,
          fromInboxRecordId: `inbox:${SUPPORT_INBOX}`,
        }),
    ],
  ] as const

  it.each(MAIL_READS)('%s is refused at inboxes: None', async (_name, call) => {
    await expect(call(caller(capabilitiesFor({ inboxes: Level.None })))).rejects.toMatchObject(
      FORBIDDEN_CAPABILITY
    )
    // The middleware answered — no service work happened at all.
    expect(service.getInboxWithIntegrationsById).not.toHaveBeenCalled()
    expect(threadMutation.countIntegrationThreadsInInbox).not.toHaveBeenCalled()
  })

  it.each(MAIL_READS)('%s is permitted at the Member baseline (Read)', async (_name, call) => {
    await expect(call(caller(capabilitiesFor({ governing: [] })))).resolves.toBeDefined()
  })

  it('OVER-DENIAL CONTROL: `channels.manage` is neither required nor sufficient', async () => {
    // The two areas are independent (§1.0). A channel administrator whose
    // profile shut mail gets nothing here, and a plain member with mail open
    // needs no channels key.
    await expect(
      caller(capabilitiesFor({ channels: Level.Full, inboxes: Level.None })).myLenses()
    ).rejects.toMatchObject(FORBIDDEN_CAPABILITY)
    await expect(
      caller(capabilitiesFor({ channels: Level.None, inboxes: Level.Read })).myLenses()
    ).resolves.toBeDefined()
  })

  it('a dispatch-org assignee still works — the front door is not the inbox row', async () => {
    // §1.4's positive control: the shared inbox is floored at `none` and the
    // assignee holds no positive row on it, but `inboxes: Read` opens the door
    // and assignment confers the `full` lens. An inbox-instance assert on these
    // reads — the "defence in depth" that looks obviously right — would deny
    // exactly them.
    const assignee = capabilitiesFor({
      inboxes: Level.Read,
      instances: { [SUPPORT_INBOX]: ResourcePermission.none },
    })
    expect(assignee.canViewInstance('inbox', SUPPORT_INBOX)).toBe(false)
    await expect(caller(assignee).myLenses()).resolves.toBeDefined()
    await expect(
      caller(assignee).countMovableThreads({
        integrationId: SUPPORT_CHANNEL,
        fromInboxRecordId: `inbox:${SUPPORT_INBOX}`,
      })
    ).resolves.toBeDefined()
  })
})

/**
 * The behavioral blocks run against a stubbed `~/server/api/trpc`, so they
 * cannot see a downgrade of the procedure BUILDER itself — and this router's
 * pre-0a state was exactly that: bare `protectedProcedure`s on five mutations.
 * Pin it in source, the idiom `snippet-instance-access.test.ts` uses.
 */
describe('inbox router — structural invariants', () => {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), 'src/server/api/routers/inbox.ts'),
    'utf8'
  )

  it.each([
    'create',
    'delete',
    'addIntegration',
    'removeIntegration',
    'moveIntegrationThreads',
    'claimPersonal',
    'deletePersonal',
  ])('%s builds on permissionProcedure(channelsManage)', (name) => {
    expect(src).toContain(`${name}: permissionProcedure(PermissionKey.channelsManage)`)
  })

  it('the mail-side procedures build on the inboxes front door', () => {
    expect(src).toContain('const mailProcedure = permissionProcedure(PermissionKey.inboxesView)')
    for (const name of ['myLenses', 'setAccessFloor', 'getIntegrations', 'countMovableThreads']) {
      expect(src, `${name} must build on the mail front door`).toContain(`${name}: mailProcedure`)
    }
  })

  it('no bare protectedProcedure survives in this router', () => {
    // Every procedure is now behind one of the two coarse keys; a new one added
    // without a gate fails here rather than shipping open.
    expect(src).not.toContain(': protectedProcedure')
    expect(src).not.toContain(': publicProcedure')
  })

  it('the procedure list is exhaustive — a NEW procedure must be gated too', () => {
    const declared = [
      ...src.matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9]*): (mailProcedure|permissionProcedure)/gm),
    ].map((m) => m[1] as string)
    expect(declared.sort()).toEqual(
      [
        'addIntegration',
        'claimPersonal',
        'countMovableThreads',
        'create',
        'delete',
        'deletePersonal',
        'getIntegrations',
        'moveIntegrationThreads',
        'myLenses',
        'removeIntegration',
        'setAccessFloor',
      ].sort()
    )
  })
})
