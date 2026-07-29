// apps/web/src/server/api/routers/inbox-routing-recordid-canonicalization.test.ts

import fs from 'node:fs'
import path from 'node:path'
import type { OrganizationRole, SeatType } from '@auxx/database/types'
import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 40 §5.1 / 40a §5.1 — the CLIENT-MINTED half of the inbox RecordId bug,
 * on the three channel-routing procedures whose RecordId arrives over the wire.
 *
 * `settings/channels/_components/integration-routing.tsx` builds its inbox
 * RecordId as `toRecordId(useResource('inboxes').id, inboxId)` — the entity
 * definition's **CUID**, never the `'inbox'` slug — and record-layer callers
 * carry their owning definition's CUID too. `InboxService.canManageInboxAccess`
 * forwards straight to `hasPermission`, which matches
 * `ResourceAccess.entityDefinitionId` **literally**, so a CUID-keyed RecordId
 * matches no grant row at all.
 *
 * **Why it was invisible, and why it is not any more.** Until plan 40 phase 2
 * the `vis.isAdmin` short-circuit inside `canManageInboxAccess` answered first,
 * so only a non-admin inbox Manager ever hit the 403. Phase 2 deletes that
 * short-circuit by design (§4.2 — admins read mail through rows), which turns a
 * narrow bug into "channel routing denies everyone, admins included".
 *
 * The world below is the same shape as `inbox-personal-def-recordid.test.ts`'s:
 * grants are held as the RecordId STRING their row is keyed by, so a wrong def
 * prefix simply misses. No mock of `toInboxRecordId` — the real resolver runs
 * against a real-shaped `inboxes` org cache, because resolving the def from the
 * INSTANCE (never from the caller's guess, never from `isPersonal`) is the
 * property under test.
 */

const ORG_ID = 'org_cuid000000000000000000000'
/** An ordinary member who MANAGES one inbox — no admin rank anywhere here. */
const USER_ID = 'usr_manager00000000000000000'

/** The shared `inbox` definition's CUID — what `useResource('inboxes').id` is. */
const INBOX_DEF_CUID = 'edf_inboxcuid00000000000000'

const SUPPORT_INBOX = 'ibx_support0000000000000000'
const TEAM_INBOX = 'ibx_team00000000000000000000'
/** Moved onto `personal_inbox` by migration 060; its grants re-keyed with it. */
const PERSONAL_INBOX = 'ibx_personal000000000000000'
const CHANNEL = 'int_channel0000000000000000'

const { world, service, threadMutation, recordAuditFromCtx } = vi.hoisted(() => {
  const world = {
    /** RecordId STRINGS, exactly as the `ResourceAccess` rows are keyed. */
    manage: new Set<string>(),
    /** The merged `inboxes` org-cache list — the def discriminator seam. */
    inboxes: [] as Array<{ id: string; entityDefinitionKey: string; isPersonal: boolean }>,
    /** integrationId → the inbox instance it currently routes to. */
    routes: {} as Record<string, string | undefined>,
  }

  const instanceIdOf = (recordId: unknown) => String(recordId).split(':')[1] ?? String(recordId)
  const inboxFor = (id: string) => {
    const entry = world.inboxes.find((i) => i.id === id)
    return {
      id,
      // Minted SERVER-side from the instance's own def — never crosses the wire,
      // so it is already canonical (the `sourceInbox` assert relies on this).
      recordId: `${entry?.entityDefinitionKey ?? 'inbox'}:${id}`,
      name: id,
      isPersonal: !!entry?.isPersonal,
    }
  }

  const service = {
    canManageInboxAccess: vi.fn(async (recordId: unknown) => world.manage.has(String(recordId))),
    hasUserAccess: vi.fn(async () => true),
    getInbox: vi.fn(async (recordId: unknown) => inboxFor(instanceIdOf(recordId))),
    getIntegrationInbox: vi.fn(async (integrationId: string) => {
      const inboxId = world.routes[integrationId]
      return inboxId ? inboxFor(inboxId) : null
    }),
    getInboxWithIntegrationsById: vi.fn(async (inboxId: string) => ({
      ...inboxFor(inboxId),
      integrations: [],
    })),
    addIntegration: vi.fn(async () => ({ id: 'lnk_new' })),
    removeIntegration: vi.fn(async () => true),
    createInbox: vi.fn(async () => ({ id: 'ibx_new' })),
    deleteInboxById: vi.fn(async () => undefined),
  }

  return {
    world,
    service,
    threadMutation: {
      moveIntegrationThreadsToInbox: vi.fn(async () => ({ count: 3 })),
      countIntegrationThreadsInInbox: vi.fn(async () => 3),
    },
    recordAuditFromCtx: vi.fn(async () => undefined),
  }
})

vi.mock('@auxx/lib/inboxes', () => ({
  InboxService: class {
    canManageInboxAccess = service.canManageInboxAccess
    hasUserAccess = service.hasUserAccess
    getInbox = service.getInbox
    getIntegrationInbox = service.getIntegrationInbox
    getInboxWithIntegrationsById = service.getInboxWithIntegrationsById
    addIntegration = service.addIntegration
    removeIntegration = service.removeIntegration
    createInbox = service.createInbox
    deleteInboxById = service.deleteInboxById
  },
}))

// The org cache is the def authority — `toInboxRecordId` runs FOR REAL against
// this list, which is the point of the test.
vi.mock('@auxx/lib/cache', () => ({
  getCachedUserMailVisibility: vi.fn(async () => ({ isAdmin: false, inboxLens: {} })),
  getOrgCache: () => ({ get: async () => world.inboxes }),
}))

vi.mock('@auxx/lib/threads', () => ({
  ThreadMutationService: class {
    moveIntegrationThreadsToInbox = threadMutation.moveIntegrationThreadsToInbox
    countIntegrationThreadsInInbox = threadMutation.countIntegrationThreadsInInbox
  },
}))
vi.mock('@auxx/lib/channels', () => ({
  claimPersonalInbox: vi.fn(),
  deleteOwnPersonalInbox: vi.fn(),
  deletePersonalInbox: vi.fn(),
}))
vi.mock('~/server/api/audit-context', () => ({ recordAuditFromCtx }))
vi.mock('@auxx/lib/permissions/visibility', () => ({ inboxLensFor: () => 'none' }))

vi.mock('@auxx/lib/permissions', async () => {
  const registry = await import('@auxx/lib/permissions/capabilities/registry')
  return { PermissionKey: registry.PermissionKey }
})

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

const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { inboxRouter } = await import('./inbox')

const FORBIDDEN = { code: 'FORBIDDEN' }

/** The RecordId the FE actually sends: the shared def's CUID, for BOTH defs. */
const asClientSends = (inboxId: string) => `${INBOX_DEF_CUID}:${inboxId}`

function caller(opts: { role?: OrganizationRole; seatType?: SeatType } = {}) {
  const capabilities = new CapabilitySet(
    new Set(expandLevelsToKeys({ [Area.channels]: Level.Full })),
    {},
    opts.role ?? 'MEMBER',
    opts.seatType ?? 'full'
  )
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

beforeEach(() => {
  world.manage = new Set()
  world.routes = {}
  world.inboxes = [
    { id: SUPPORT_INBOX, entityDefinitionKey: 'inbox', isPersonal: false },
    { id: TEAM_INBOX, entityDefinitionKey: 'inbox', isPersonal: false },
    { id: PERSONAL_INBOX, entityDefinitionKey: 'personal_inbox', isPersonal: true },
  ]
  // `mockReset` (not `mockClear`) per the repo rule; vitest restores the
  // implementation passed to `vi.fn`, so the fixture-backed behaviour survives.
  for (const fn of Object.values(service)) fn.mockReset()
  threadMutation.moveIntegrationThreadsToInbox.mockReset()
  threadMutation.countIntegrationThreadsInInbox.mockReset()
  recordAuditFromCtx.mockReset()
})

// ═══════════════════════════════════════════════════════════════════════════
// addIntegration
// ═══════════════════════════════════════════════════════════════════════════

describe('addIntegration — a CUID-keyed RecordId from the FE', () => {
  it('a non-admin inbox MANAGER succeeds (the live regression)', async () => {
    // The grant row is slug-keyed, as every inbox grant is. Before the router
    // canonicalized, the CUID-keyed RecordId reached `hasPermission` verbatim,
    // matched nothing, and 403'd the inbox's own Manager.
    world.manage.add(`inbox:${SUPPORT_INBOX}`)

    await expect(
      caller().addIntegration({
        recordId: asClientSends(SUPPORT_INBOX),
        integrationId: CHANNEL,
        isDefault: true,
      })
    ).resolves.toEqual({ id: 'lnk_new' })

    expect(service.canManageInboxAccess).toHaveBeenCalledWith(`inbox:${SUPPORT_INBOX}`, USER_ID)
    // …and the canonical id is what reaches the write, not just the gate.
    expect(service.addIntegration).toHaveBeenCalledWith(
      `inbox:${SUPPORT_INBOX}`,
      CHANNEL,
      true,
      undefined,
      { repointFromInboxId: undefined }
    )
  })

  it('a member with NO grant on that inbox is still refused', async () => {
    // The negative control. Canonicalization must not become an authorization:
    // it fixes which row is looked up, never whether one is required.
    await expect(
      caller().addIntegration({ recordId: asClientSends(SUPPORT_INBOX), integrationId: CHANNEL })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(service.addIntegration).not.toHaveBeenCalled()
  })

  it('a grant on a DIFFERENT inbox does not carry over', async () => {
    world.manage.add(`inbox:${TEAM_INBOX}`)
    await expect(
      caller().addIntegration({ recordId: asClientSends(SUPPORT_INBOX), integrationId: CHANNEL })
    ).rejects.toMatchObject(FORBIDDEN)
  })

  it('the SOURCE-inbox assert (§5.1) still runs on a re-route', async () => {
    // Phase 0a's hijack fix: re-routing is a move OUT of the source as much as
    // into the target. Manager of the target only ⇒ still refused.
    world.routes[CHANNEL] = TEAM_INBOX
    world.manage.add(`inbox:${SUPPORT_INBOX}`)

    await expect(
      caller().addIntegration({ recordId: asClientSends(SUPPORT_INBOX), integrationId: CHANNEL })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(service.addIntegration).not.toHaveBeenCalled()

    // With BOTH ends it goes through, and carries the repoint acknowledgement.
    world.manage.add(`inbox:${TEAM_INBOX}`)
    await expect(
      caller().addIntegration({ recordId: asClientSends(SUPPORT_INBOX), integrationId: CHANNEL })
    ).resolves.toEqual({ id: 'lnk_new' })
    expect(service.addIntegration).toHaveBeenCalledWith(
      `inbox:${SUPPORT_INBOX}`,
      CHANNEL,
      undefined,
      undefined,
      { repointFromInboxId: TEAM_INBOX }
    )
  })

  it('the §11 personal-inbox routing invariants still hold', async () => {
    world.manage.add(`personal_inbox:${PERSONAL_INBOX}`)
    await expect(
      caller().addIntegration({ recordId: asClientSends(PERSONAL_INBOX), integrationId: CHANNEL })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })

    // …and a personal channel cannot be re-routed OUT either.
    world.routes[CHANNEL] = PERSONAL_INBOX
    world.manage.add(`inbox:${SUPPORT_INBOX}`)
    await expect(
      caller().addIntegration({ recordId: asClientSends(SUPPORT_INBOX), integrationId: CHANNEL })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// moveIntegrationThreads
// ═══════════════════════════════════════════════════════════════════════════

describe('moveIntegrationThreads — both ends are canonicalized', () => {
  it('a Manager of both inboxes succeeds through CUID-keyed RecordIds', async () => {
    world.manage.add(`inbox:${SUPPORT_INBOX}`)
    world.manage.add(`inbox:${TEAM_INBOX}`)

    await expect(
      caller().moveIntegrationThreads({
        integrationId: CHANNEL,
        fromInboxRecordId: asClientSends(TEAM_INBOX),
        toInboxRecordId: asClientSends(SUPPORT_INBOX),
      })
    ).resolves.toEqual({ count: 3 })

    expect(service.canManageInboxAccess).toHaveBeenCalledWith(`inbox:${TEAM_INBOX}`, USER_ID)
    expect(service.canManageInboxAccess).toHaveBeenCalledWith(`inbox:${SUPPORT_INBOX}`, USER_ID)
    expect(threadMutation.moveIntegrationThreadsToInbox).toHaveBeenCalledWith(
      CHANNEL,
      `inbox:${TEAM_INBOX}`,
      `inbox:${SUPPORT_INBOX}`
    )
  })

  it('one end without a grant refuses the whole move', async () => {
    world.manage.add(`inbox:${SUPPORT_INBOX}`)
    await expect(
      caller().moveIntegrationThreads({
        integrationId: CHANNEL,
        fromInboxRecordId: asClientSends(TEAM_INBOX),
        toInboxRecordId: asClientSends(SUPPORT_INBOX),
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(threadMutation.moveIntegrationThreadsToInbox).not.toHaveBeenCalled()
  })

  it('resolves EACH end from its own instance, not one def for the pair', async () => {
    // Both ends are canonicalized off one `org:inboxes` read, so a batch helper
    // that resolved the def once and reused it — or hard-coded `'inbox'` — would
    // still pass every case above, since those move between two shared inboxes.
    //
    // Moving across the personal boundary is refused on product grounds (§11),
    // and that refusal comes AFTER the two manage gates. So the observable is
    // which rows the gates looked up: a `BAD_REQUEST` means both passed, where a
    // pair-wide `'inbox'` def would have produced `FORBIDDEN` on the personal end.
    world.manage.add(`personal_inbox:${PERSONAL_INBOX}`)
    world.manage.add(`inbox:${SUPPORT_INBOX}`)

    await expect(
      caller().moveIntegrationThreads({
        integrationId: CHANNEL,
        fromInboxRecordId: asClientSends(PERSONAL_INBOX),
        toInboxRecordId: asClientSends(SUPPORT_INBOX),
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })

    expect(service.canManageInboxAccess).toHaveBeenCalledWith(
      `personal_inbox:${PERSONAL_INBOX}`,
      USER_ID
    )
    expect(service.canManageInboxAccess).toHaveBeenCalledWith(`inbox:${SUPPORT_INBOX}`, USER_ID)
    expect(threadMutation.moveIntegrationThreadsToInbox).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// The def must come from the INSTANCE
// ═══════════════════════════════════════════════════════════════════════════

describe('the definition is resolved from the instance, not from the caller', () => {
  it('a personal mailbox resolves to `personal_inbox` even though the FE sent the SHARED def', async () => {
    // The case a def-part translation (`buildDefIdToSlug`) would still get
    // wrong: the client asked for `useResource('inboxes')` regardless of which
    // def the instance sits on, so translating its def part yields `'inbox'` —
    // which post-060 matches none of that mailbox's rows.
    //
    // Routing INTO a personal inbox is refused on product grounds (§11), so the
    // observable proof is which row the GATE looked up: it must have passed,
    // leaving `BAD_REQUEST` rather than `FORBIDDEN` as the answer.
    world.manage.add(`personal_inbox:${PERSONAL_INBOX}`)

    await expect(
      caller().addIntegration({ recordId: asClientSends(PERSONAL_INBOX), integrationId: CHANNEL })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(service.canManageInboxAccess).toHaveBeenCalledWith(
      `personal_inbox:${PERSONAL_INBOX}`,
      USER_ID
    )
    expect(service.canManageInboxAccess).not.toHaveBeenCalledWith(
      `inbox:${PERSONAL_INBOX}`,
      USER_ID
    )
  })

  it('a stale `inbox`-keyed grant does NOT authorize a mailbox that has moved defs', async () => {
    world.manage.add(`inbox:${PERSONAL_INBOX}`)
    await expect(
      caller().addIntegration({ recordId: asClientSends(PERSONAL_INBOX), integrationId: CHANNEL })
    ).rejects.toMatchObject(FORBIDDEN)
  })

  it('an id the cache does not know falls back to the shared def (closed)', async () => {
    const unknown = 'ibx_unknown0000000000000000'
    world.manage.add(`inbox:${unknown}`)
    await expect(
      caller().addIntegration({ recordId: asClientSends(unknown), integrationId: CHANNEL })
    ).resolves.toEqual({ id: 'lnk_new' })
    expect(service.canManageInboxAccess).toHaveBeenCalledWith(`inbox:${unknown}`, USER_ID)
  })

  it('an already-slug-keyed RecordId is idempotent', async () => {
    // Server-minted ids (`Inbox.recordId`) and any future slug-keyed caller must
    // survive the same funnel unchanged.
    world.manage.add(`inbox:${SUPPORT_INBOX}`)
    await expect(
      caller().addIntegration({ recordId: `inbox:${SUPPORT_INBOX}`, integrationId: CHANNEL })
    ).resolves.toEqual({ id: 'lnk_new' })
    expect(service.canManageInboxAccess).toHaveBeenCalledWith(`inbox:${SUPPORT_INBOX}`, USER_ID)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Structural
// ═══════════════════════════════════════════════════════════════════════════

describe('inbox router — canonicalization is applied where a RecordId crosses the wire', () => {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), 'src/server/api/routers/inbox.ts'),
    'utf8'
  )

  it('no gate is handed a raw client RecordId any more', () => {
    // The bug in one line: `input.recordId` / `input.*InboxRecordId` reaching a
    // gate or a service call without passing through the funnel first.
    expect(src).not.toMatch(/requireInbox\w+Access\(\s*inboxService,\s*input\./)
    expect(src).not.toMatch(/getInbox\(input\./)
  })

  it('`countMovableThreads` is deliberately left alone', () => {
    // It reads `getInstanceId` only, so a re-key there would be inert ceremony —
    // documented rather than done, so the omission is not read as an oversight.
    expect(src).toContain('input.fromInboxRecordId')
  })
})
