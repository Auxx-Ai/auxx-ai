// apps/web/src/server/api/routers/inbox-personal-def-recordid.test.ts

import { ResourcePermission } from '@auxx/database/enums'
import type { OrganizationRole, SeatType } from '@auxx/database/types'
import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 40a §5.1 (item B) — `inbox.ts`'s three bare `toRecordId('inbox', …)`
 * mints, driven against the POST-060 world.
 *
 * `InboxService.canManageInboxAccess` / `hasUserAccess` forward the caller's
 * RecordId to `hasPermission`, which matches `ResourceAccess.entityDefinitionId`
 * LITERALLY. Data migration 060 re-keys a personal mailbox's grant rows to
 * `'personal_inbox'` — so a router that keeps minting `inbox:<id>` stops
 * matching the owner's own `admin` row and 403s them out of their own mailbox.
 *
 * The world below models exactly that: grants are held as the RecordId STRING
 * the row is keyed by, so a wrong def prefix simply misses. That is what makes
 * these behavioral rather than a spy on an argument — though the calls are
 * asserted too, because the argument IS the bug.
 */

const ORG_ID = 'org_cuid000000000000000000000'
/** The personal mailbox's owner — an ordinary member, no admin rank. */
const USER_ID = 'usr_owner000000000000000000'
/** Moved onto `personal_inbox` by migration 060; its grants re-keyed with it. */
const PERSONAL_INBOX = 'ibx_personal000000000000000'
/** An ordinary org inbox the member manages — stays on `inbox`. */
const SHARED_INBOX = 'ibx_shared00000000000000000'
const CHANNEL = 'int_channel0000000000000000'

const { world, service, channels } = vi.hoisted(() => {
  const world = {
    /** RecordId STRINGS, exactly as the ResourceAccess rows are keyed. */
    manage: new Set<string>(),
    view: new Set<string>(),
    /** The merged `inboxes` org-cache list — the def discriminator seam. */
    inboxes: [] as Array<{ id: string; entityDefinitionKey: string; isPersonal: boolean }>,
  }

  const service = {
    canManageInboxAccess: vi.fn(async (recordId: unknown) => world.manage.has(String(recordId))),
    hasUserAccess: vi.fn(async (recordId: unknown) => world.view.has(String(recordId))),
    getInboxWithIntegrationsById: vi.fn(async (inboxId: string) => ({
      id: inboxId,
      integrations: [{ id: 'lnk_1', integrationId: CHANNEL }],
    })),
    deleteInbox: vi.fn(async () => undefined),
    deleteInboxById: vi.fn(async () => undefined),
    removeIntegration: vi.fn(async () => true),
  }

  const channels = {
    claimPersonalInbox: vi.fn(async () => undefined),
    deleteOwnPersonalInbox: vi.fn(async () => undefined),
    deletePersonalInbox: vi.fn(async () => undefined),
  }

  return { world, service, channels }
})

vi.mock('@auxx/lib/inboxes', () => ({
  InboxService: class {
    canManageInboxAccess = service.canManageInboxAccess
    hasUserAccess = service.hasUserAccess
    getInboxWithIntegrationsById = service.getInboxWithIntegrationsById
    deleteInbox = service.deleteInbox
    deleteInboxById = service.deleteInboxById
    removeIntegration = service.removeIntegration
    // Unused by the three procedures under test, present so the class shape
    // does not surprise a future addition.
    getInbox = vi.fn(async () => null)
    getIntegrationInbox = vi.fn(async () => null)
    createInbox = vi.fn(async () => ({ id: 'ibx_new' }))
    addIntegration = vi.fn(async () => ({ id: 'lnk_new' }))
  },
}))

// The org cache is the def authority — `toInboxRecordId` runs FOR REAL against
// this list, which is the point of the test.
vi.mock('@auxx/lib/cache', () => ({
  getCachedUserInstanceGrants: vi.fn(async () => ({ isAdmin: false, inboxLens: {} })),
  getOrgCache: () => ({ get: async () => world.inboxes }),
}))

vi.mock('@auxx/lib/threads', () => ({ ThreadMutationService: class {} }))
vi.mock('@auxx/lib/channels', () => channels)
vi.mock('~/server/api/audit-context', () => ({ recordAuditFromCtx: vi.fn(async () => undefined) }))
vi.mock('@auxx/lib/permissions/visibility', () => ({ inboxLensFor: () => 'none' }))

// The `@auxx/lib/permissions` barrel reaches redis/db at import time and hangs
// under vitest — re-export the REAL registry value the gates are keyed on.
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

const FORBIDDEN_INSTANCE = { code: 'FORBIDDEN' }

function caller(
  opts: {
    role?: OrganizationRole
    seatType?: SeatType
    inboxes?: Level
    /** The caller's OWN instance rows, `instanceId → permission`. */
    instances?: Record<string, ResourcePermission>
  } = {}
) {
  const instances = opts.instances ?? {}
  const capabilities = new CapabilitySet(
    new Set(
      expandLevelsToKeys({
        [Area.channels]: Level.Full,
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
    // Governing = the AUTHORED restrictions only. A creator's `user @ admin` row
    // governs nothing, so an ordinary inbox is unrestricted org-wide.
    new Set(),
    {},
    new Set()
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
  world.view = new Set()
  world.inboxes = [
    { id: PERSONAL_INBOX, entityDefinitionKey: 'personal_inbox', isPersonal: true },
    { id: SHARED_INBOX, entityDefinitionKey: 'inbox', isPersonal: false },
  ]
  // `mockReset` (not `mockClear`) per the repo rule; vitest restores the
  // implementation passed to `vi.fn`, so the fixture-backed behaviour survives.
  service.canManageInboxAccess.mockReset()
  service.hasUserAccess.mockReset()
  service.deleteInbox.mockReset()
  service.deleteInboxById.mockReset()
  service.removeIntegration.mockReset()
  channels.deleteOwnPersonalInbox.mockReset()
})

describe('inbox router RecordId minting after migration 060 (plan 40a §5.1 item B)', () => {
  describe('the personal mailbox’s own owner', () => {
    beforeEach(() => {
      // Post-060: every grant on this mailbox is keyed `personal_inbox`.
      world.manage.add(`personal_inbox:${PERSONAL_INBOX}`)
      world.view.add(`personal_inbox:${PERSONAL_INBOX}`)
    })

    it('can still DELETE it — routed to the owner path, not the inventory one', async () => {
      await expect(caller().delete({ inboxId: PERSONAL_INBOX })).resolves.toEqual({ success: true })

      // The def resolved off the org cache picks the BRANCH, so this is the same
      // minting invariant the rest of the file pins, one level up: a stray
      // `inbox:` prefix here would send a personal mailbox down the shared path
      // and 403 its own owner on `channels.manage`.
      expect(channels.deleteOwnPersonalInbox).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        userId: USER_ID,
        inboxId: PERSONAL_INBOX,
      })
      // Authority moved INTO the lib function (ownership of the mailbox, which a
      // shareable `admin` grant does not confer) — the router must not also run
      // the Manager gate, or a personal inbox stays undeletable by design.
      expect(service.canManageInboxAccess).not.toHaveBeenCalled()
      expect(service.deleteInbox).not.toHaveBeenCalled()
    })

    it('can still REMOVE AN INTEGRATION from it', async () => {
      await expect(
        caller().removeIntegration({ inboxId: PERSONAL_INBOX, integrationId: CHANNEL })
      ).resolves.toBe(true)

      expect(service.removeIntegration).toHaveBeenCalledWith(
        `personal_inbox:${PERSONAL_INBOX}`,
        CHANNEL
      )
    })

    it('can still READ its channel routing', async () => {
      // `getIntegrations` moved onto `assertViewInstance` (plan §5.3), which
      // takes the DEF KEY plus the bare instance id rather than a RecordId. The
      // owner's `admin` row opens it under either key — the discriminating case
      // is the NON-owner one below.
      await expect(
        caller({
          instances: { [PERSONAL_INBOX]: ResourcePermission.admin },
        }).getIntegrations({ inboxId: PERSONAL_INBOX })
      ).resolves.toHaveLength(1)
    })
  })

  describe('a shared org inbox (negative control — the def must NOT drift)', () => {
    beforeEach(() => {
      world.manage.add(`inbox:${SHARED_INBOX}`)
      world.view.add(`inbox:${SHARED_INBOX}`)
    })

    it('still mints the shared slug on delete / removeIntegration / getIntegrations', async () => {
      await expect(caller().delete({ inboxId: SHARED_INBOX })).resolves.toEqual({ success: true })
      await expect(
        caller().removeIntegration({ inboxId: SHARED_INBOX, integrationId: CHANNEL })
      ).resolves.toBe(true)
      // No row needed: `inbox` is the `baselineAtCreate: false` key, so the
      // `Area.inboxes` fallback answers for a row-less shared inbox.
      await expect(caller().getIntegrations({ inboxId: SHARED_INBOX })).resolves.toHaveLength(1)

      expect(service.canManageInboxAccess).toHaveBeenCalledWith(`inbox:${SHARED_INBOX}`, USER_ID)
      expect(service.deleteInbox).toHaveBeenCalledWith(`inbox:${SHARED_INBOX}`)
      expect(channels.deleteOwnPersonalInbox).not.toHaveBeenCalled()
    })
  })

  describe('the gates still refuse', () => {
    it('a member with no grant on the personal mailbox', async () => {
      await expect(
        caller().removeIntegration({ inboxId: PERSONAL_INBOX, integrationId: CHANNEL })
      ).rejects.toMatchObject(FORBIDDEN_INSTANCE)
      expect(service.removeIntegration).not.toHaveBeenCalled()
      // `delete` is deliberately absent here: since the personal branch landed,
      // its authority is OWNERSHIP inside `deleteOwnPersonalInbox` rather than a
      // grant the router can see, and that assert has its own test in
      // `packages/lib/src/channels/delete-own-personal-inbox.test.ts`.
    })

    it('THE FAIL-OPEN CASE: a non-owner is refused the personal mailbox’s channel list', async () => {
      // `assertViewInstance`'s answer for a row-less instance depends entirely on
      // the KEY: `personal_inbox` is `baselineAtCreate: true` (no row ⇒ no
      // access), `inbox` is `false` (no row ⇒ the area fallback). So a hard-coded
      // `'inbox'` here would hand every member at the Member baseline the channel
      // routing of somebody's private mailbox — a fail-OPEN, not a fail-closed.
      // The def is resolved from the org cache's `entityDefinitionKey`, never from
      // `isPersonal` (the two disagree by design between 059 and 060).
      await expect(caller().getIntegrations({ inboxId: PERSONAL_INBOX })).rejects.toMatchObject({
        cause: { name: 'ForbiddenError', statusCode: 403 },
      })
      expect(service.getInboxWithIntegrationsById).not.toHaveBeenCalled()

      // The control that proves the assertion above is about the DEF and not
      // about the member: the same member, same area level, no row — allowed on
      // the shared inbox.
      await expect(caller().getIntegrations({ inboxId: SHARED_INBOX })).resolves.toHaveLength(1)
    })

    it('...and not even a mail admin (`inboxes: Full`) gets in without a row', async () => {
      // The one behaviour this migration NARROWS. §4.4's `metadata` floor made
      // `hasUserAccess` true for a mail admin on another member's mailbox, so the
      // old gate let them read its channels. That floor is a THREAD view; an
      // inbox's routing is its configuration, which §1.3/§5.3 put with the
      // Manager. Claim/delete of an orphaned mailbox is `channels.manage` and is
      // unaffected.
      await expect(
        caller({ role: 'ADMIN', inboxes: Level.Full }).getIntegrations({ inboxId: PERSONAL_INBOX })
      ).rejects.toMatchObject({ cause: { name: 'ForbiddenError', statusCode: 403 } })
      // Not even the OWNER — the bypass is scoped to `baselineAtCreate: false`.
      await expect(
        caller({ role: 'OWNER', inboxes: Level.Full }).getIntegrations({ inboxId: PERSONAL_INBOX })
      ).rejects.toMatchObject({ cause: { name: 'ForbiddenError', statusCode: 403 } })
    })

    it('a stale `inbox`-keyed grant on a mailbox that has already moved defs', async () => {
      // The pre-060 row, left behind. It must NOT authorize the new keyspace.
      world.manage.add(`inbox:${PERSONAL_INBOX}`)

      await expect(
        caller().removeIntegration({ inboxId: PERSONAL_INBOX, integrationId: CHANNEL })
      ).rejects.toMatchObject(FORBIDDEN_INSTANCE)
      expect(service.removeIntegration).not.toHaveBeenCalled()
    })
  })

  it('falls back to the shared def for an inbox the cache does not know', async () => {
    world.manage.add('inbox:ibx_unknown0000000000000000')

    await expect(caller().delete({ inboxId: 'ibx_unknown0000000000000000' })).resolves.toEqual({
      success: true,
    })
    // Closed fallback: an unknown id takes the SHARED branch, which still has to
    // clear `channels.manage` + Manager. Sending it down the personal one would
    // skip both gates on an id the cache cannot vouch for.
    expect(channels.deleteOwnPersonalInbox).not.toHaveBeenCalled()
    expect(service.deleteInbox).toHaveBeenCalledWith('inbox:ibx_unknown0000000000000000')
  })
})
