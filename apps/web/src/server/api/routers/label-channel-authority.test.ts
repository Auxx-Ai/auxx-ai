// apps/web/src/server/api/routers/label-channel-authority.test.ts

import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

/**
 * The label router's authority model, driven through real tRPC callers.
 *
 * ## The hole this file was created for (2026-07-29, #1396)
 *
 * `getIntegrationLabels`, `toggleLabelEnabled` and `discoverFolders` were
 * `permissionProcedure(channels.manage)` — a COARSE org-wide assert with no
 * per-channel path. The channel settings page is reachable by the owner of a
 * personal channel (§11: `requireChannelManageAccess` carves them out, and they
 * hold no `channels.manage` at all), so opening the Routing tab on their own
 * Gmail/Outlook channel fired `label.getIntegrationLabels` and got a hard 403 —
 * "You don't have permission to Manage Channels" — on a channel they own.
 *
 * They authorize on the CHANNEL via `requireChannelManageAccess`, the same
 * authority `channel.toggle` / `syncMessages` / `updateSettings` / `disconnect`
 * already use, so all of a channel's write surfaces answer to one predicate.
 *
 * ## Why the harness changed shape in phase 6
 *
 * The router no longer issues its own queries — `@auxx/lib/email/labels` does — so
 * the original ordering assertions (`expect(dbCalls).toEqual(['select','update'])`)
 * had nothing left to observe. They are re-expressed as call ordering over the
 * MOCKED LIB FUNCTIONS in one shared `calls` log. The invariant is unchanged and
 * is the whole point of this file:
 *
 *   **resolve org-scoped → authorize → write**
 *
 * plus: a foreign-org label id 404s with `requireChannelManageAccess` NEVER
 * called, so a 403 can never be used as an existence oracle for another org's
 * labels.
 *
 * The mock db is also passed as `ctx.db` rather than sitting behind a
 * `vi.mock('@auxx/database', { database })` module singleton, because the router
 * now takes its connection from the context like every other router.
 *
 * `permissionProcedure` used to be stubbed as `() => t.procedure`, asserting
 * nothing. It now ENFORCES against `world.capabilities` and records the asserted
 * key in `gate`, because phase 6 puts `syncAll` on `channels.manage` and the
 * thread ops on `inboxes.view`, and those denials are untestable through an inert
 * stub. The revert tripwire survives in a stronger form: every positive test for a
 * per-channel procedure runs with `world.capabilities` EMPTY and asserts `gate`
 * is `[]`, so reverting one of them to a coarse gate fails twice over — the key
 * appears in `gate`, and the call 403s.
 *
 * Thread label ops are deliberately NOT channel config (§5.2): they gate on
 * `inboxes.view` + `assertCanActOnThreads`, and `requireChannelManageAccess` must
 * never be reached from them.
 */

/** The two capability keys this router asserts, as the real registry spells them. */
const CHANNELS_MANAGE = 'channels.manage'
const INBOXES_VIEW = 'inboxes.view'

// The fixture ids live INSIDE the hoisted block (and are re-exported from it)
// because `vi.hoisted` runs before every other top-level binding in this file, and
// the mock return values below reference them eagerly.
const hoisted = vi.hoisted(() => {
  const ORG_ID = 'org_cuid000000000000000000000'
  const USER_ID = 'usr_member00000000000000000'
  /** The member's OWN personal channel — `requireChannelManageAccess` allows it. */
  const OWN_CHANNEL = 'int_personal000000000000000'
  /** A shared channel the member has no authority over. */
  const SHARED_CHANNEL = 'int_shared00000000000000000'
  const OWN_LABEL = 'lbl_own00000000000000000000'
  const SHARED_LABEL = 'lbl_shared00000000000000000'
  const THREAD_ID = 'thr_cuid00000000000000000000'

  type ManageScope = { kind: 'all' } | { kind: 'ids'; integrationIds: string[] }

  const world = {
    /** Layer-2 capability keys the caller holds. EMPTY is the interesting case. */
    capabilities: new Set<string>(),
    /** Channels this caller may manage (the predicate's answer, stated as a premise). */
    manageable: new Set<string>(),
    /** labelId → the channel it belongs to. Absent ⇒ no such label in THIS org. */
    labels: {} as Record<string, string | undefined>,
    /** Every label row in the org, for `listLabels`' scope filtering. */
    labelRows: [] as Array<{ id: string; name: string; integrationId: string }>,
    /** What `listManageableChannelIds` answers. */
    manageScope: { kind: 'all' } as ManageScope,
    /** Whether `assertCanActOnThreads` allows the action. */
    threadActionAllowed: true,
    /** Make `syncIntegrationLabels` fail with this error. */
    syncError: undefined as Error | undefined,
  }

  /**
   * Every authorization gate and lib helper the router reached, in order. The
   * ordering assertions read this — it replaces the drizzle-call log, which went
   * silent once the queries moved into lib.
   */
  const calls: string[] = []
  /** Capability keys `permissionProcedure` asserted, in order. */
  const gate: string[] = []

  /**
   * The two fields `auxxErrorMiddleware` maps on. Hand-rolled rather than using
   * the real `@auxx/lib/errors` classes because everything in this block is
   * hoisted above the import graph.
   */
  const failure = (name: string, statusCode: number, message: string): Error => {
    const error = new Error(message)
    error.name = name
    ;(error as Error & { statusCode: number }).statusCode = statusCode
    return error
  }

  /**
   * Minimal stand-in for a neverthrow `Result`. The router reads only `isErr()`,
   * `.value` and `.error`, so reproducing those three is the whole contract.
   */
  const ok = <T>(value: T) => ({ isOk: () => true, isErr: () => false, value })
  const errResult = (error: Error) => ({ isOk: () => false, isErr: () => true, error })

  /**
   * The real `requireChannelManageAccess` throws a `TRPCError` today (plan §5.4
   * debt, deliberately out of scope); either shape reaches the caller as a 403.
   */
  const requireChannelManageAccess = vi.fn(async (_ctx: unknown, integrationId: string) => {
    calls.push('requireChannelManageAccess')
    if (world.manageable.has(integrationId)) return
    throw failure('ForbiddenError', 403, "You don't have permission to Manage Channels.")
  })

  const listManageableChannelIds = vi.fn(async (_ctx: unknown): Promise<ManageScope> => {
    calls.push('listManageableChannelIds')
    return world.manageScope
  })

  /**
   * Faithful stand-in for `listLabels`' SQL scope filter, empty-allowlist case
   * included. It has to be faithful: if the router forgot to pass `filters.scope`,
   * this returns the org's whole label set and the `list` positive control fails —
   * which is exactly the regression worth catching.
   */
  const listLabels = vi.fn(
    async (
      _db: unknown,
      _organizationId: string,
      filters: {
        integrationId?: string
        integrationType?: string
        scope?: ManageScope
      } = {}
    ) => {
      calls.push('listLabels')
      let rows = world.labelRows
      if (filters.integrationId) {
        rows = rows.filter((row) => row.integrationId === filters.integrationId)
      }
      if (filters.scope && filters.scope.kind === 'ids') {
        const allowed = new Set(filters.scope.integrationIds)
        rows = rows.filter((row) => allowed.has(row.integrationId))
      }
      return ok(rows)
    }
  )

  const getLabelById = vi.fn(async (_db: unknown, _organizationId: string, labelId: string) => {
    calls.push('getLabelById')
    const integrationId = world.labels[labelId]
    if (!integrationId) return errResult(failure('NotFoundError', 404, 'Label not found'))
    return ok({ id: labelId, integrationId, enabled: true, isVisible: true })
  })

  /** One recorder per remaining lib helper; each returns `ok` and takes no asserted args. */
  const recorder = <T>(name: string, value: T) =>
    vi.fn(async () => {
      calls.push(name)
      return ok(value)
    })

  const syncIntegrationLabels = vi.fn(async () => {
    calls.push('syncIntegrationLabels')
    return world.syncError ? errResult(world.syncError) : ok([])
  })

  const assertCanActOnThreads = vi.fn(
    async (_db: unknown, _organizationId: string, _viewer: unknown, _threadIds: string[]) => {
      calls.push('assertCanActOnThreads')
      if (world.threadActionAllowed) return
      throw failure('ForbiddenError', 403, 'You do not have full access to this thread.')
    }
  )

  const labels = {
    addLabelToThread: recorder('addLabelToThread', undefined),
    createLabel: recorder('createLabel', { id: OWN_LABEL }),
    deleteLabel: recorder('deleteLabel', undefined),
    discoverAndUpsertFolders: recorder('discoverAndUpsertFolders', undefined),
    getLabelById,
    listLabels,
    listThreadLabels: recorder('listThreadLabels', []),
    removeLabelFromThread: recorder('removeLabelFromThread', undefined),
    setLabelEnabled: recorder('setLabelEnabled', { id: OWN_LABEL, enabled: false }),
    setLabelVisibility: recorder('setLabelVisibility', { id: OWN_LABEL, isVisible: false }),
    syncAllIntegrationLabels: recorder('syncAllIntegrationLabels', []),
    syncIntegrationLabels,
    updateLabel: recorder('updateLabel', { id: OWN_LABEL }),
  }

  /**
   * Minimal drizzle stand-in for the ONE query the router still owns: resolving an
   * integration's provider inside `discoverFolders`. Handed in as `ctx.db`.
   */
  const selectRows: unknown[] = []
  const db = {
    select: () => {
      const settle = async () => {
        calls.push('db.select')
        return selectRows.shift() ?? []
      }
      const self: Record<string, unknown> = {}
      for (const method of ['from', 'where']) self[method] = () => self
      self.limit = settle
      return self
    },
    __queueSelect: (rows: unknown) => selectRows.push(rows),
    __reset: () => {
      selectRows.length = 0
    },
  }

  const getCachedUserInstanceGrants = vi.fn(async () => ({ userId: USER_ID, isAdmin: false }))

  return {
    ORG_ID,
    USER_ID,
    OWN_CHANNEL,
    SHARED_CHANNEL,
    OWN_LABEL,
    SHARED_LABEL,
    THREAD_ID,
    world,
    calls,
    gate,
    db,
    failure,
    labels,
    requireChannelManageAccess,
    listManageableChannelIds,
    assertCanActOnThreads,
    getCachedUserInstanceGrants,
  }
})

const {
  ORG_ID,
  USER_ID,
  OWN_CHANNEL,
  SHARED_CHANNEL,
  OWN_LABEL,
  SHARED_LABEL,
  THREAD_ID,
  world,
  calls,
  gate,
  db,
  failure,
  labels: lib,
  requireChannelManageAccess,
  listManageableChannelIds,
  assertCanActOnThreads,
} = hoisted

vi.mock('@auxx/database', async () =>
  (await import('~/test/database-mock')).mockAuxxDatabase({
    schema: {
      Integration: {
        id: 'Integration.id',
        organizationId: 'Integration.organizationId',
        deletedAt: 'Integration.deletedAt',
        provider: 'Integration.provider',
      },
    },
  })
)
vi.mock('drizzle-orm', () => ({
  and: (...parts: unknown[]) => parts,
  eq: (a: unknown, b: unknown) => [a, b],
  isNull: (a: unknown) => a,
}))

vi.mock('@auxx/lib/channels', () => ({
  requireChannelManageAccess: hoisted.requireChannelManageAccess,
  listManageableChannelIds: hoisted.listManageableChannelIds,
}))
vi.mock('@auxx/lib/email/labels', () => hoisted.labels)
vi.mock('@auxx/lib/cache', () => ({
  getCachedUserInstanceGrants: hoisted.getCachedUserInstanceGrants,
}))
vi.mock('@auxx/lib/threads/thread-action-access', () => ({
  assertCanActOnThreads: hoisted.assertCanActOnThreads,
}))
vi.mock('@auxx/lib/providers', () => ({
  ProviderRegistryService: class {
    getProvider = vi.fn(async () => ({
      discoverLabels: async () => [
        { externalId: 'INBOX', name: 'Inbox', isSentBox: false, parentExternalId: null },
      ],
    }))
  },
}))

vi.mock('~/server/api/trpc', async () => {
  const { initTRPC } = await import('@trpc/server')
  const t = initTRPC.context<Record<string, unknown>>().create()
  return {
    createTRPCRouter: t.router,
    protectedProcedure: t.procedure,
    /**
     * Really enforces, unlike the inert `() => t.procedure` it replaces, and
     * RECORDS the key it asserted — that recording is the revert tripwire for the
     * per-channel procedures, which must assert NO capability key at all.
     */
    permissionProcedure: (key: string) =>
      t.procedure.use(({ next }) => {
        hoisted.gate.push(key)
        if (!hoisted.world.capabilities.has(key)) {
          throw hoisted.failure('ForbiddenError', 403, `You don't have permission: ${key}`)
        }
        return next()
      }),
  }
})

const { labelRouter } = await import('./label')

/** `ctx.db` is the fake drizzle — the router reads `ctx.db`, never a module singleton. */
const caller = () =>
  labelRouter.createCaller({
    db,
    session: { userId: USER_ID, organizationId: ORG_ID, user: { id: USER_ID } },
  } as never)

/**
 * Procedures are invoked through an untyped view of the caller so one test body
 * can cover several of them; the router's own types are checked by `tsc`, not here.
 */
const invoke = (procedure: string, input?: unknown): Promise<unknown> => {
  const fn = (caller() as unknown as Record<string, (arg?: unknown) => Promise<unknown>>)[procedure]
  if (!fn) throw new Error(`label router has no procedure "${procedure}"`)
  return fn(input)
}

/** The shape `auxxErrorMiddleware` maps to a 403. */
const FORBIDDEN = { cause: { name: 'ForbiddenError', statusCode: 403 } }
/** …and to a 404. */
const NOT_FOUND = { cause: { name: 'NotFoundError', statusCode: 404 } }

const CHANNEL_REF = { integrationType: 'google', integrationId: OWN_CHANNEL }

beforeEach(() => {
  world.capabilities.clear()
  world.manageable.clear()
  world.labels = { [OWN_LABEL]: OWN_CHANNEL, [SHARED_LABEL]: SHARED_CHANNEL }
  world.labelRows = [
    { id: OWN_LABEL, name: 'Personal Inbox', integrationId: OWN_CHANNEL },
    { id: SHARED_LABEL, name: 'Support', integrationId: SHARED_CHANNEL },
  ]
  world.manageScope = { kind: 'all' }
  world.threadActionAllowed = true
  world.syncError = undefined
  db.__reset()
  vi.clearAllMocks()
  calls.length = 0
  gate.length = 0
})

describe('label router — per-channel authority', () => {
  describe('getIntegrationLabels', () => {
    it('serves the owner of a personal channel, who holds no channels.manage', async () => {
      world.manageable.add(OWN_CHANNEL)

      const result = await caller().getIntegrationLabels({ integrationId: OWN_CHANNEL })

      expect(result.labels).toEqual([expect.objectContaining({ id: OWN_LABEL })])
      expect(requireChannelManageAccess).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORG_ID, userId: USER_ID }),
        OWN_CHANNEL
      )
      // No coarse capability gate — this is the #1396 regression, asserted directly.
      expect(gate).toEqual([])
    })

    it('refuses a channel the caller may not manage, before reading any label', async () => {
      await expect(
        caller().getIntegrationLabels({ integrationId: SHARED_CHANNEL })
      ).rejects.toMatchObject(FORBIDDEN)

      expect(calls).toEqual(['requireChannelManageAccess'])
    })
  })

  describe('discoverFolders', () => {
    it('refuses a channel the caller may not manage, before touching the provider', async () => {
      await expect(
        caller().discoverFolders({ integrationId: SHARED_CHANNEL })
      ).rejects.toMatchObject(FORBIDDEN)

      expect(calls).toEqual(['requireChannelManageAccess'])
    })

    it('runs for a channel the caller manages, with no coarse gate', async () => {
      world.manageable.add(OWN_CHANNEL)
      db.__queueSelect([{ provider: 'google' }])

      const result = await caller().discoverFolders({ integrationId: OWN_CHANNEL })

      expect(result.labels).toEqual([expect.objectContaining({ id: OWN_LABEL })])
      // Authorize → resolve the integration → write → re-read.
      expect(calls).toEqual([
        'requireChannelManageAccess',
        'db.select',
        'discoverAndUpsertFolders',
        'listLabels',
      ])
      expect(gate).toEqual([])
    })

    it('404s an integration that is missing or soft-deleted', async () => {
      world.manageable.add(OWN_CHANNEL)
      db.__queueSelect([])

      await expect(caller().discoverFolders({ integrationId: OWN_CHANNEL })).rejects.toMatchObject(
        NOT_FOUND
      )

      expect(lib.discoverAndUpsertFolders).not.toHaveBeenCalled()
    })
  })

  /**
   * The four procedures that were bare `protectedProcedure`s with ZERO
   * authorization until phase 6. `create` and `remove` mutate the customer's real
   * Gmail/Outlook account, so "any authenticated member of any org" was the gate.
   */
  const channelWrites: Array<{ procedure: string; input: object; helper: Mock }> = [
    {
      procedure: 'create',
      input: { ...CHANNEL_REF, name: 'Escalations' },
      helper: lib.createLabel,
    },
    {
      procedure: 'update',
      input: { ...CHANNEL_REF, labelId: OWN_LABEL, name: 'Renamed' },
      helper: lib.updateLabel,
    },
    {
      procedure: 'remove',
      input: { ...CHANNEL_REF, labelId: OWN_LABEL },
      helper: lib.deleteLabel,
    },
    { procedure: 'sync', input: CHANNEL_REF, helper: lib.syncIntegrationLabels },
  ]

  for (const { procedure, input, helper } of channelWrites) {
    describe(procedure, () => {
      it('authorizes on the integrationId from the input, then writes', async () => {
        world.manageable.add(OWN_CHANNEL)

        await invoke(procedure, { ...input, integrationId: OWN_CHANNEL })

        expect(requireChannelManageAccess).toHaveBeenCalledWith(
          expect.objectContaining({ organizationId: ORG_ID, userId: USER_ID }),
          OWN_CHANNEL
        )
        expect(helper).toHaveBeenCalledTimes(1)
        expect(gate).toEqual([])
      })

      it('refuses a channel the caller may not manage, before the write', async () => {
        world.manageable.add(OWN_CHANNEL)

        await expect(
          invoke(procedure, { ...input, integrationId: SHARED_CHANNEL })
        ).rejects.toMatchObject(FORBIDDEN)

        expect(calls).toEqual(['requireChannelManageAccess'])
        expect(helper).not.toHaveBeenCalled()
      })
    })
  }

  describe('sync — error propagation', () => {
    /**
     * Phase 5 made `ReauthenticationRequiredError` an `AuxxError` with
     * `statusCode = 401`, and phase 6 deleted the router's
     * `instanceof ReauthenticationRequiredError` special case. What has to hold
     * HERE is the router-level half: `result.error` is rethrown UNCHANGED, so its
     * status survives. Nine `try/catch` blocks used to flatten every error class
     * but one into an INTERNAL_SERVER_ERROR, which is why a reauth failure on
     * `syncLabels` read as "Failed to sync labels".
     */
    it('propagates a 401-class AuxxError instead of flattening it to a 500', async () => {
      world.manageable.add(OWN_CHANNEL)
      world.syncError = failure('UnauthorizedError', 401, 'User re-authentication required')

      await expect(caller().sync(CHANNEL_REF)).rejects.toMatchObject({
        cause: { name: 'UnauthorizedError', statusCode: 401 },
      })
    })
  })

  /**
   * Both label-keyed toggles. They take only a `labelId`, so they must resolve it
   * ORG-SCOPED before they can know which channel to authorize on. `setVisibility`
   * is DB-only, but it is still channel sync config, so it carries the identical
   * gate and ordering — two adjacent toggles on one row must not differ.
   */
  const labelToggles: Array<{
    procedure: string
    extra: object
    writeName: string
    helper: Mock
  }> = [
    {
      procedure: 'toggleLabelEnabled',
      extra: { enabled: false },
      writeName: 'setLabelEnabled',
      helper: lib.setLabelEnabled,
    },
    {
      procedure: 'setVisibility',
      extra: { visible: false },
      writeName: 'setLabelVisibility',
      helper: lib.setLabelVisibility,
    },
  ]

  for (const { procedure, extra, writeName, helper } of labelToggles) {
    describe(procedure, () => {
      it('resolves the label org-scoped, authorizes on its channel, then writes', async () => {
        world.manageable.add(OWN_CHANNEL)

        await invoke(procedure, { labelId: OWN_LABEL, ...extra })

        expect(requireChannelManageAccess).toHaveBeenCalledWith(expect.anything(), OWN_CHANNEL)
        // The invariant: resolve → authorize → write, in that order.
        expect(calls).toEqual(['getLabelById', 'requireChannelManageAccess', writeName])
        expect(gate).toEqual([])
      })

      it('refuses before the write when the label belongs to another channel', async () => {
        world.manageable.add(OWN_CHANNEL)

        await expect(invoke(procedure, { labelId: SHARED_LABEL, ...extra })).rejects.toMatchObject(
          FORBIDDEN
        )

        expect(calls).toEqual(['getLabelById', 'requireChannelManageAccess'])
        expect(helper).not.toHaveBeenCalled()
      })

      it('404s a foreign-org label id without making an authorization decision', async () => {
        world.manageable.add(OWN_CHANNEL)

        await expect(
          invoke(procedure, { labelId: 'lbl_other_org', ...extra })
        ).rejects.toMatchObject(NOT_FOUND)

        // A 403 here would be an existence oracle for another org's labels.
        expect(requireChannelManageAccess).not.toHaveBeenCalled()
        expect(helper).not.toHaveBeenCalled()
      })
    })
  }

  /**
   * `list` SCOPES rather than asserting (§5.3). The positive half is mandatory:
   * per `mail-instance-access.test.ts` §12, a denial-only suite is structurally
   * blind to the over-denial regression #1396 existed to fix.
   */
  describe('list', () => {
    it('shows a personal-channel owner their own labels and not a shared channel’s', async () => {
      world.manageScope = { kind: 'ids', integrationIds: [OWN_CHANNEL] }

      const result = await caller().list()

      expect(result.labels.map((label) => label.id)).toEqual([OWN_LABEL])
      // The scope must reach the QUERY, not be applied after the read.
      expect(lib.listLabels).toHaveBeenCalledWith(
        expect.anything(),
        ORG_ID,
        expect.objectContaining({ scope: { kind: 'ids', integrationIds: [OWN_CHANNEL] } })
      )
      expect(listManageableChannelIds).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORG_ID, userId: USER_ID })
      )
      // No 403 and no coarse gate — a server-warmed page call must not fail.
      expect(gate).toEqual([])
    })

    it('shows every channel’s labels to a channels.manage holder', async () => {
      world.manageScope = { kind: 'all' }

      const result = await caller().list()

      // Control for the case above: proves the filter is not vacuously empty.
      expect(result.labels.map((label) => label.id)).toEqual([OWN_LABEL, SHARED_LABEL])
    })

    it('returns zero labels when the caller manages no channels', async () => {
      world.manageScope = { kind: 'ids', integrationIds: [] }

      const result = await caller().list()

      // Pins the empty-`inArray` footgun: "sees nothing", never "sees everything".
      expect(result.labels).toEqual([])
    })
  })

  /**
   * `syncAll` is the ONE place the coarse key is correct — there is no single
   * channel to key on, matching `channel.syncAllMessages`. Pinned in both
   * directions so it is not "consistency-fixed" onto the per-channel predicate.
   */
  describe('syncAll', () => {
    it('denies a personal-channel owner who holds no channels.manage', async () => {
      world.manageable.add(OWN_CHANNEL)

      await expect(caller().syncAll()).rejects.toMatchObject(FORBIDDEN)

      expect(gate).toEqual([CHANNELS_MANAGE])
      expect(lib.syncAllIntegrationLabels).not.toHaveBeenCalled()
    })

    it('runs for a channels.manage holder', async () => {
      world.capabilities.add(CHANNELS_MANAGE)

      await caller().syncAll()

      expect(gate).toEqual([CHANNELS_MANAGE])
      expect(lib.syncAllIntegrationLabels).toHaveBeenCalledTimes(1)
    })
  })

  /**
   * Thread label ops are MAIL ACTIONS, not channel config (§5.2): `inboxes.view`
   * front door + `assertCanActOnThreads`, and deliberately no inbox-instance
   * assert (plan 40 §1.4 — in a dispatch org the assignee holds no
   * `ResourceAccess` row on the inbox, so an instance gate would deny exactly the
   * people the model exists to serve).
   */
  const threadWrites: Array<{ procedure: string; helper: Mock }> = [
    { procedure: 'addLabelToThread', helper: lib.addLabelToThread },
    { procedure: 'removeLabelFromThread', helper: lib.removeLabelFromThread },
  ]

  for (const { procedure, helper } of threadWrites) {
    describe(procedure, () => {
      const input = { ...CHANNEL_REF, labelId: OWN_LABEL, threadId: THREAD_ID }

      it('denies a caller without inboxes.view', async () => {
        await expect(invoke(procedure, input)).rejects.toMatchObject(FORBIDDEN)

        expect(gate).toEqual([INBOXES_VIEW])
        expect(helper).not.toHaveBeenCalled()
      })

      it('asserts thread action authority before the write, and no channel gate', async () => {
        world.capabilities.add(INBOXES_VIEW)

        await invoke(procedure, input)

        expect(assertCanActOnThreads).toHaveBeenCalledWith(
          expect.anything(),
          ORG_ID,
          expect.anything(),
          [THREAD_ID]
        )
        expect(calls).toEqual(['assertCanActOnThreads', procedure])
        expect(requireChannelManageAccess).not.toHaveBeenCalled()
      })

      it('refuses a thread the caller cannot fully see, before the write', async () => {
        world.capabilities.add(INBOXES_VIEW)
        world.threadActionAllowed = false

        await expect(invoke(procedure, input)).rejects.toMatchObject(FORBIDDEN)

        expect(helper).not.toHaveBeenCalled()
      })
    })
  }

  describe('getThreadLabels', () => {
    it('denies a caller without inboxes.view', async () => {
      await expect(caller().getThreadLabels({ threadId: THREAD_ID })).rejects.toMatchObject(
        FORBIDDEN
      )

      expect(gate).toEqual([INBOXES_VIEW])
      expect(lib.listThreadLabels).not.toHaveBeenCalled()
    })

    it('is a read, so it gates on inboxes.view and nothing finer', async () => {
      world.capabilities.add(INBOXES_VIEW)

      await caller().getThreadLabels({ threadId: THREAD_ID })

      expect(calls).toEqual(['listThreadLabels'])
      expect(assertCanActOnThreads).not.toHaveBeenCalled()
      expect(requireChannelManageAccess).not.toHaveBeenCalled()
    })
  })
})
