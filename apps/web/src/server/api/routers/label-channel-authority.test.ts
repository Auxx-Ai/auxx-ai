// apps/web/src/server/api/routers/label-channel-authority.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The label router's three channel-scoped procedures, driven for real.
 *
 * The hole (found while testing personal inboxes, 2026-07-29): `getIntegrationLabels`,
 * `toggleLabelEnabled` and `discoverFolders` were `permissionProcedure(channels.manage)`
 * — a COARSE org-wide assert with no per-channel path. The channel settings page is
 * reachable by the owner of a personal channel (§11: `requireChannelManageAccess`
 * carves them out, and they hold no `channels.manage` at all), so opening the Routing
 * tab on their own Gmail/Outlook channel fired
 * `label.getIntegrationLabels` and got a hard 403 —
 * "You don't have permission to Manage Channels" — on a channel they own.
 *
 * They now authorize on the CHANNEL via `requireChannelManageAccess`, which is the
 * same authority `channel.toggle` / `syncMessages` / `updateSettings` / `disconnect`
 * already use, so all of a channel's write surfaces answer to one predicate.
 *
 * `toggleLabelEnabled` takes only a `labelId`, so it resolves the label ORG-SCOPED
 * first and authorizes on the channel that label belongs to. Order matters and is
 * asserted: a foreign-org label id must 404 before any authorization decision, and a
 * label whose channel the caller may not manage must be refused before the UPDATE.
 */

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_member00000000000000000'
/** The member's OWN personal channel — `requireChannelManageAccess` allows it. */
const OWN_CHANNEL = 'int_personal000000000000000'
/** A shared channel the member has no authority over. */
const SHARED_CHANNEL = 'int_shared00000000000000000'
const OWN_LABEL = 'lbl_own00000000000000000000'
const SHARED_LABEL = 'lbl_shared00000000000000000'

const { world, requireChannelManageAccess, dbCalls, db } = vi.hoisted(() => {
  const world = {
    /** Channels this caller may manage (the predicate's answer, stated as a premise). */
    manageable: new Set<string>(),
    /** labelId → the channel it belongs to. Absent ⇒ no such label in this org. */
    labels: {} as Record<string, string | undefined>,
  }

  const requireChannelManageAccess = vi.fn(async (_ctx: unknown, integrationId: string) => {
    if (world.manageable.has(integrationId)) return
    const error = new Error("You don't have permission to Manage Channels.")
    error.name = 'ForbiddenError'
    ;(error as Error & { statusCode: number }).statusCode = 403
    throw error
  })

  /** Every db operation the router reached, in order — the ordering assertions read this. */
  const dbCalls: string[] = []

  /**
   * Minimal drizzle stand-in. `select` serves the label lookup and the label list;
   * `update` records that the write was reached. The chain's TERMINAL methods
   * (`orderBy` / `limit` / `returning` — the ones the router awaits) resolve to the
   * rows the current `world` implies, so a test never stubs a call sequence.
   */
  const selectRows: unknown[] = []
  const chain = (kind: string) => {
    const settle = async () => {
      dbCalls.push(kind)
      return kind === 'update' ? [{ id: OWN_LABEL }] : (selectRows.shift() ?? [])
    }
    const self: Record<string, unknown> = {}
    for (const m of ['from', 'where', 'set']) self[m] = () => self
    for (const m of ['orderBy', 'limit', 'returning']) self[m] = settle
    return self
  }

  const db = {
    select: () => chain('select'),
    update: () => chain('update'),
    __queueSelect: (rows: unknown) => selectRows.push(rows),
    __reset: () => {
      selectRows.length = 0
      dbCalls.length = 0
    },
  }

  return { world, requireChannelManageAccess, dbCalls, db }
})

vi.mock('@auxx/database', () => ({
  database: db,
  schema: {
    Label: {
      id: 'Label.id',
      name: 'Label.name',
      enabled: 'Label.enabled',
      updatedAt: 'Label.updatedAt',
      integrationId: 'Label.integrationId',
      organizationId: 'Label.organizationId',
    },
    Integration: {
      id: 'Integration.id',
      organizationId: 'Integration.organizationId',
      deletedAt: 'Integration.deletedAt',
      provider: 'Integration.provider',
    },
  },
}))
vi.mock('drizzle-orm', () => ({
  and: (...parts: unknown[]) => parts,
  eq: (a: unknown, b: unknown) => [a, b],
  isNull: (a: unknown) => a,
}))

vi.mock('@auxx/lib/channels', () => ({ requireChannelManageAccess }))
vi.mock('@auxx/lib/email', () => ({
  FolderDiscoveryService: class {
    discoverAndUpsert = vi.fn(async () => undefined)
  },
  LabelService: class {},
  ReauthenticationRequiredError: class extends Error {},
  getUserOrganizationId: () => ORG_ID,
}))
vi.mock('@auxx/lib/providers', () => ({
  ProviderRegistryService: class {
    getProvider = vi.fn(async () => ({ discoverLabels: async () => [] }))
  },
}))

vi.mock('~/server/api/trpc', async () => {
  const { initTRPC } = await import('@trpc/server')
  const t = initTRPC.context<Record<string, unknown>>().create()
  return {
    createTRPCRouter: t.router,
    protectedProcedure: t.procedure,
    // Present so an accidental revert to the coarse gate is visible: it asserts
    // nothing, so a reverted procedure would let an unauthorized caller through
    // and the "refused" cases below would fail.
    permissionProcedure: () => t.procedure,
  }
})

const { labelRouter } = await import('./label')

const caller = () =>
  labelRouter.createCaller({
    db: {},
    session: { userId: USER_ID, organizationId: ORG_ID, user: { id: USER_ID } },
  } as never)

/** The shape `auxxErrorMiddleware` maps to a 403. */
const FORBIDDEN = { cause: { name: 'ForbiddenError', statusCode: 403 } }

beforeEach(() => {
  world.manageable.clear()
  world.labels = { [OWN_LABEL]: OWN_CHANNEL, [SHARED_LABEL]: SHARED_CHANNEL }
  requireChannelManageAccess.mockClear()
  db.__reset()
})

describe('label router — per-channel authority', () => {
  describe('getIntegrationLabels', () => {
    it('serves the owner of a personal channel, who holds no channels.manage', async () => {
      world.manageable.add(OWN_CHANNEL)
      db.__queueSelect([{ id: OWN_LABEL, name: 'Inbox' }])

      const result = await caller().getIntegrationLabels({ integrationId: OWN_CHANNEL })

      expect(result.labels).toHaveLength(1)
      expect(requireChannelManageAccess).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORG_ID, userId: USER_ID }),
        OWN_CHANNEL
      )
    })

    it('refuses a channel the caller may not manage, before reading any label', async () => {
      await expect(
        caller().getIntegrationLabels({ integrationId: SHARED_CHANNEL })
      ).rejects.toMatchObject(FORBIDDEN)

      expect(dbCalls).toEqual([])
    })
  })

  describe('toggleLabelEnabled', () => {
    it('authorizes on the channel the label belongs to, then writes', async () => {
      world.manageable.add(OWN_CHANNEL)
      db.__queueSelect([{ integrationId: OWN_CHANNEL }])

      await caller().toggleLabelEnabled({ labelId: OWN_LABEL, enabled: false })

      expect(requireChannelManageAccess).toHaveBeenCalledWith(expect.anything(), OWN_CHANNEL)
      // Resolve the label FIRST, authorize, and only then update.
      expect(dbCalls).toEqual(['select', 'update'])
    })

    it('refuses before the update when the label belongs to another channel', async () => {
      world.manageable.add(OWN_CHANNEL)
      db.__queueSelect([{ integrationId: SHARED_CHANNEL }])

      await expect(
        caller().toggleLabelEnabled({ labelId: SHARED_LABEL, enabled: true })
      ).rejects.toMatchObject(FORBIDDEN)

      expect(dbCalls).toEqual(['select'])
      expect(dbCalls).not.toContain('update')
    })

    it('404s an unknown label id without making an authorization decision', async () => {
      world.manageable.add(OWN_CHANNEL)
      db.__queueSelect([])

      await expect(
        caller().toggleLabelEnabled({ labelId: 'lbl_foreign', enabled: true })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })

      expect(requireChannelManageAccess).not.toHaveBeenCalled()
    })
  })

  describe('discoverFolders', () => {
    it('refuses a channel the caller may not manage, before touching the provider', async () => {
      await expect(
        caller().discoverFolders({ integrationId: SHARED_CHANNEL })
      ).rejects.toMatchObject(FORBIDDEN)

      expect(dbCalls).toEqual([])
    })

    it('runs for a channel the caller manages', async () => {
      world.manageable.add(OWN_CHANNEL)
      db.__queueSelect([{ id: OWN_CHANNEL, provider: 'google' }])
      db.__queueSelect([{ id: OWN_LABEL, name: 'Inbox' }])

      const result = await caller().discoverFolders({ integrationId: OWN_CHANNEL })

      expect(result.labels).toHaveLength(1)
      expect(requireChannelManageAccess).toHaveBeenCalledWith(expect.anything(), OWN_CHANNEL)
    })
  })
})
