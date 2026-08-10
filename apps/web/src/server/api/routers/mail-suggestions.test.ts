// apps/web/src/server/api/routers/mail-suggestions.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The mail-suggestions router's authorization model, driven through real tRPC
 * callers.
 *
 * ## Why this file is mandatory
 *
 * `@auxx/lib/mail-suggestions` and `@auxx/lib/mail-unsubscribe` hold ZERO
 * permission checks by house rule, so **this router is the only authorization
 * path** in the whole feature. The four cases the plan names are pinned here as
 * router tests rather than as UI checks:
 *
 *  1. owns a personal inbox ⇒ sees exactly their own cards
 *  2. an admin ⇒ never sees another member's personal-inbox cards
 *  3. no inbox read ⇒ denied on unsubscribe (§7.1 is inbox read, and ONLY that)
 *  4. no filter-authoring rights ⇒ denied on accept (invariant 10 — the
 *     suggestion is a PREFILL, never an authorization path)
 *
 * plus invariant 7 (dismissal is a STATUS WRITE, never a delete — dismissed rows
 * ARE the suppression list) and the §7.1 divergence itself: unsubscribing needs
 * inbox `read` and must NOT need `automationRules.manage`, because gating mail on
 * an automation grant is gating mail on admin rank.
 *
 * ## The two thresholds are modelled, not stubbed
 *
 * The caller composes a RUNG per inbox on the real, sparse mail ladder
 * (`none < metadata < identity < read < admin` — no `edit`, on purpose), and both
 * capability reads are derived from it the way the real `CapabilitySet` derives
 * them: `canViewInstance` is `>= read`, `canEditInstance` is `>= edit`, which on
 * this ladder only `admin` reaches. That is what makes the v2 §2.1 divergence
 * assertable here: a member at `read` may unsubscribe and may NOT author.
 *
 * ## Shape notes
 *
 * The two lib modules are mocked wholesale — they are pure data modules by
 * design, so what matters is WHICH inbox ids reach `listMailSuggestions` and
 * WHETHER `executeUnsubscribe` / `createMailFilter` are reached at all.
 * `canUnsubscribeOnInbox` / `assertCanUnsubscribe` / `isSharedInbox` are FAITHFUL
 * stand-ins for `unsubscribe-authority.ts` (whose own semantics are pinned in
 * that module's test): what is under test here is that the router calls them,
 * with the right inbox, before anything else runs.
 *
 * `~/server/lib/mail-filter-authoring-access` is deliberately NOT mocked — the
 * accept gate is the §5.1 branch itself.
 *
 * Denials assert STATUS CODES (`cause.statusCode`), never merely "it threw": a
 * 404 where a 403 belongs (or the reverse) is the whole substance of "do not leak
 * the existence of somebody else's private mailbox".
 */

const AUTOMATION_KEY = 'automationRules.manage'

const hoisted = vi.hoisted(() => {
  /**
   * The mail rung ladder, verbatim from
   * `permissions/capabilities/instance-access.ts`. `edit` is ABSENT on purpose:
   * mail's `read` already confers acting (reply, assign), so the only tier above
   * it is managing the mailbox itself.
   */
  const INBOX_RUNGS = ['none', 'metadata', 'identity', 'read', 'admin'] as const
  type InboxRung = (typeof INBOX_RUNGS)[number]

  /** `canViewInstance` — the `>= read` threshold, i.e. mail's acting tier. */
  const satisfiesRead = (rung: InboxRung | undefined): boolean =>
    rung !== undefined && INBOX_RUNGS.indexOf(rung) >= INBOX_RUNGS.indexOf('read')

  /**
   * `canEditInstance` — the `>= edit` threshold. `edit` is not in this ladder, so
   * `admin` is the only rung that satisfies it, exactly as in production.
   */
  const satisfiesEdit = (rung: InboxRung | undefined): boolean => rung === 'admin'

  const ORG_ID = 'org_cuid000000000000000000000'
  const USER_ID = 'usr_member00000000000000000'
  const OTHER_USER_ID = 'usr_other000000000000000000'
  /** A member who owns no mailbox at all — the empty-scope case. */
  const STRANGER_ID = 'usr_stranger00000000000000'

  const SHARED_INBOX = 'inb_shared00000000000000000'
  const OWN_PERSONAL = 'inb_ownpersonal000000000000'
  const OTHER_PERSONAL = 'inb_otherpersonal0000000000'
  /** A personal mailbox still on the SHARED def — the 059→060 migration window. */
  const LEGACY_PERSONAL = 'inb_legacypersonal000000000'

  const SHARED_SUGGESTION = 'msg_shared00000000000000000'
  const OWN_SUGGESTION = 'msg_own00000000000000000000'
  const OTHER_SUGGESTION = 'msg_other000000000000000000'
  const LEGACY_SUGGESTION = 'msg_legacy00000000000000000'
  const GONE_SUGGESTION = 'msg_missing0000000000000000'

  const world = {
    /** Layer-2 capability keys the caller holds. EMPTY is the interesting case. */
    capabilities: new Set<string>(),
    /**
     * The rung the caller composes per inbox. Absent ⇒ no access at all.
     * Both `canViewInstance` (`>= read`) and `canEditInstance` (`>= edit`, i.e.
     * `admin` on this ladder) are derived from it — see the header note.
     */
    inboxRungs: new Map<string, InboxRung>(),
    /** What `executeUnsubscribe` answers. */
    unsubscribeOutcome: {
      status: 'requested',
      method: 'one-click',
      record: { id: 'mun_000000000000000000000000' },
    } as Record<string, unknown>,
    /** What `resolveUnsubscribeTarget` answers — the block path reads it. */
    unsubscribeTarget: {
      messageId: 'msg_000000000000000000000000',
      threadId: 'thr_000000000000000000000000',
      integrationId: 'int_000000000000000000000000',
      subject: 'Weekly digest',
      senderIdentifier: 'news@acme.com',
      contactEntityInstanceId: null,
      offer: { offered: false, reason: 'unverified-sender', alternative: 'block-sender' },
    } as Record<string, unknown>,
    /** Whether the caller holds per-channel manage authority. */
    canManageChannel: true,
  }

  /** Every lib helper the router reached, in order. */
  const calls: string[] = []
  /** Capability keys `permissionProcedure` asserted, in order. */
  const gate: string[] = []

  const ok = <T>(value: T) => ({ isOk: () => true, isErr: () => false, value })
  const errResult = (error: Error) => ({ isOk: () => false, isErr: () => true, error })

  const auxxError = (name: string, statusCode: number) => (message: string) => {
    const error = new Error(message)
    error.name = name
    ;(error as Error & { statusCode: number }).statusCode = statusCode
    return error
  }
  const notFound = auxxError('NotFoundError', 404)
  const forbidden = auxxError('ForbiddenError', 403)

  // ── suggestions ────────────────────────────────────────────────────────────

  /** suggestionId → the inbox it is about. Absent ⇒ no such row in THIS org. */
  const suggestionInboxes: Record<string, string> = {
    [SHARED_SUGGESTION]: SHARED_INBOX,
    [OWN_SUGGESTION]: OWN_PERSONAL,
    [OTHER_SUGGESTION]: OTHER_PERSONAL,
    [LEGACY_SUGGESTION]: LEGACY_PERSONAL,
  }

  const suggestionRow = (id: string) => ({
    id,
    organizationId: ORG_ID,
    inboxId: suggestionInboxes[id],
    userId: suggestionInboxes[id] === SHARED_INBOX ? null : USER_ID,
    kind: 'unsubscribe',
    subjectKey: `list:${id}.example.com`,
    evidence: {
      windowDays: 90,
      messageCount: 34,
      threadCount: 30,
      unreadRate: 1,
      manualArchiveRate: 0,
      everReplied: false,
      sampleThreadIds: [],
      unsubscribeMethod: 'one-click',
      listId: `${id}.example.com`,
      senderDomain: 'example.com',
      senderAuthenticated: true,
      historyDays: 88,
      filteredThreadCount: 0,
    },
    proposedConditions: [
      {
        id: 'grp_1',
        logicalOperator: 'AND',
        conditions: [{ id: 'cnd_1', fieldId: 'body', operator: 'contains', value: 'Unsubscribe' }],
      },
    ],
    proposedActions: [{ type: 'set-status', status: 'ARCHIVED' }],
    status: 'new',
    dismissedAt: null,
    acceptedAt: null,
    acceptedFilterId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  /**
   * A FAITHFUL stand-in for the SQL scope: if the router forgot to pass
   * `inboxIds`, this returns every card in the org and the scoping tests fail —
   * which is exactly the regression worth catching.
   */
  const listMailSuggestions = vi.fn(
    async (_db: unknown, _orgId: string, opts: { inboxIds?: string[]; userId?: string } = {}) => {
      calls.push('listMailSuggestions')
      const rows = Object.keys(suggestionInboxes).map(suggestionRow)
      if (!opts.inboxIds) return ok(rows)
      const allowed = new Set(opts.inboxIds)
      return ok(rows.filter((row) => allowed.has(row.inboxId)))
    }
  )

  const getMailSuggestionById = vi.fn(async (_db: unknown, _orgId: string, id: string) => {
    calls.push('getMailSuggestionById')
    if (!suggestionInboxes[id]) return errResult(notFound('Suggestion not found'))
    return ok(suggestionRow(id))
  })

  const dismissMailSuggestion = vi.fn(async (_db: unknown, _orgId: string, id: string) => {
    calls.push('dismissMailSuggestion')
    return ok({ ...suggestionRow(id), status: 'dismissed', dismissedAt: new Date() })
  })

  const markMailSuggestionAccepted = vi.fn(
    async (_db: unknown, _orgId: string, id: string, filterId: string | null) => {
      calls.push('markMailSuggestionAccepted')
      return ok({ ...suggestionRow(id), status: 'accepted', acceptedFilterId: filterId })
    }
  )

  const mailSuggestions = {
    describeSubjectKey: (subjectKey: string) => subjectKey.replace(/^list:|^domain:/, ''),
    dismissMailSuggestion,
    getMailSuggestionById,
    listMailSuggestions,
    markMailSuggestionAccepted,
  }

  // ── unsubscribe ────────────────────────────────────────────────────────────

  interface AuthorityInbox {
    id: string
    entityDefinitionKey: 'inbox' | 'personal_inbox'
    isPersonal: boolean
    ownerUserId: string | null
  }
  interface AuthorityCaps {
    canViewInstance(key: 'inbox', instanceId: string): boolean
  }

  /**
   * A FAITHFUL stand-in for `unsubscribe-authority.ts` (§7.1):
   *
   *   personal_inbox owned by the caller  →  allowed, NO permission key
   *   shared inbox                        →  inbox READ, and NOTHING else
   *
   * The legacy `isPersonal` marker narrows and never widens, exactly as the real
   * predicate does — personal-ness can be self-declared into a stricter rule, not
   * forged into a laxer one.
   */
  const canUnsubscribeOnInbox = vi.fn(
    (inbox: AuthorityInbox, userId: string, capabilities: AuthorityCaps) => {
      if (inbox.entityDefinitionKey === 'personal_inbox') return inbox.ownerUserId === userId
      if (inbox.isPersonal) return inbox.ownerUserId === userId
      return capabilities.canViewInstance('inbox', inbox.id)
    }
  )

  const assertCanUnsubscribe = vi.fn(
    (inbox: AuthorityInbox, userId: string, capabilities: AuthorityCaps) => {
      calls.push('assertCanUnsubscribe')
      if (!canUnsubscribeOnInbox(inbox, userId, capabilities)) {
        throw forbidden("You don't have permission to unsubscribe this inbox.")
      }
    }
  )

  const isSharedInbox = vi.fn(
    (inbox: AuthorityInbox) => inbox.entityDefinitionKey !== 'personal_inbox' && !inbox.isPersonal
  )

  const executeUnsubscribe = vi.fn(async () => {
    calls.push('executeUnsubscribe')
    return ok(world.unsubscribeOutcome)
  })

  const resolveUnsubscribeTarget = vi.fn(async () => {
    calls.push('resolveUnsubscribeTarget')
    return ok(world.unsubscribeTarget)
  })

  const mailUnsubscribe = {
    assertCanUnsubscribe,
    canUnsubscribeOnInbox,
    executeUnsubscribe,
    isSharedInbox,
    resolveUnsubscribeTarget,
  }

  // ── blocking the sender on the CHANNEL (a third, stricter authority) ────────

  const requireChannelManageAccess = vi.fn(async () => {
    calls.push('requireChannelManageAccess')
    if (!world.canManageChannel) throw new Error('Only admins can manage shared channels')
  })

  const addExcludedSender = vi.fn(async (_ctx: unknown, _channelId: string, entry: string) => {
    calls.push(`addExcludedSender:${entry}`)
    return { ok: true as const, value: { success: true as const, message: 'Excluded' } }
  })

  const channels = { requireChannelManageAccess, addExcludedSender }

  // ── the filter half (reached through `mailFilters.create`) ─────────────────

  const createMailFilter = vi.fn(async (_db: unknown, _orgId: string, input: object) => {
    calls.push('createMailFilter')
    return ok({ id: 'mfl_created0000000000000000', ...input })
  })

  const previewMatchCount = vi.fn(async () => {
    calls.push('previewMatchCount')
    return { count: 12, capped: false, lowerBound: true as const }
  })

  const assertFilterConditionsCompile = vi.fn(() => {
    calls.push('assertFilterConditionsCompile')
  })

  const recorder = <T>(name: string, value: T) =>
    vi.fn(async () => {
      calls.push(name)
      return ok(value)
    })

  const mailFilters = {
    ACTION_REQUIRING_AUTOMATION_KEY: ['run-agent', 'run-workflow'],
    MAX_PERSONAL_MAIL_FILTERS: 50,
    applyRetroactively: vi.fn(async () => calls.push('applyRetroactively')),
    countBillableMailFilters: vi.fn(async () => 0),
    countPersonalMailFilters: vi.fn(async () => 0),
    createMailFilter,
    deleteMailFilter: recorder('deleteMailFilter', undefined),
    findPendingRetroactivePrompt: vi.fn(async () => null),
    getMailFilterById: recorder('getMailFilterById', { id: 'x', inboxId: SHARED_INBOX }),
    getMailFilterRunById: recorder('getMailFilterRunById', { id: 'x', filterId: 'x' }),
    listMailFilterRuns: recorder('listMailFilterRuns', []),
    listMailFilterRunsForThread: recorder('listMailFilterRunsForThread', []),
    listMailFilters: recorder('listMailFilters', []),
    loadBackfillableFilter: recorder('loadBackfillableFilter', { id: 'x' }),
    previewMatchCount,
    reorderMailFilters: recorder('reorderMailFilters', undefined),
    setMailFilterEnabled: recorder('setMailFilterEnabled', { id: 'x' }),
    undoMailFilterRun: recorder('undoMailFilterRun', { undone: true }),
    updateMailFilter: recorder('updateMailFilter', { id: 'x' }),
  }

  // ── the org cache ──────────────────────────────────────────────────────────

  const inbox = (
    id: string,
    entityDefinitionKey: 'inbox' | 'personal_inbox',
    ownerUserId: string | null,
    isPersonal = entityDefinitionKey === 'personal_inbox'
  ) => ({
    id,
    recordId: `${entityDefinitionKey}:${id}`,
    entityDefinitionKey,
    name: id,
    description: null,
    color: 'indigo',
    status: 'ACTIVE',
    defaultLens: isPersonal ? 'none' : 'read',
    isPersonal,
    ownerUserId,
    settings: {},
    organizationId: ORG_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdById: null,
  })

  const inboxes = [
    inbox(SHARED_INBOX, 'inbox', null),
    inbox(OWN_PERSONAL, 'personal_inbox', USER_ID),
    inbox(OTHER_PERSONAL, 'personal_inbox', OTHER_USER_ID),
    inbox(LEGACY_PERSONAL, 'inbox', OTHER_USER_ID, true),
  ]

  const orgCacheGet = vi.fn(async (_orgId: string, key: string) => {
    if (key !== 'inboxes') throw new Error(`unexpected org-cache key ${key}`)
    return inboxes
  })
  const onCacheEvent = vi.fn(async (event: string) => {
    calls.push(`onCacheEvent:${event}`)
  })
  const getCachedUserInstanceGrants = vi.fn(async (userId: string, organizationId: string) => ({
    userId,
    organizationId,
  }))

  /** The plan-limit gate — unlimited here; `mail-filters.test.ts` pins its edges. */
  class FeaturePermissionService {
    async requireLimit(_orgId: string, key: string) {
      calls.push(`requireLimit:${key}`)
    }
  }

  return {
    satisfiesRead,
    satisfiesEdit,
    ORG_ID,
    USER_ID,
    OTHER_USER_ID,
    STRANGER_ID,
    SHARED_INBOX,
    OWN_PERSONAL,
    OTHER_PERSONAL,
    LEGACY_PERSONAL,
    SHARED_SUGGESTION,
    OWN_SUGGESTION,
    OTHER_SUGGESTION,
    LEGACY_SUGGESTION,
    GONE_SUGGESTION,
    world,
    calls,
    gate,
    mailSuggestions,
    mailUnsubscribe,
    channels,
    mailFilters,
    assertFilterConditionsCompile,
    orgCacheGet,
    onCacheEvent,
    getCachedUserInstanceGrants,
    FeaturePermissionService,
  }
})

const {
  ORG_ID,
  USER_ID,
  STRANGER_ID,
  SHARED_INBOX,
  OWN_PERSONAL,
  OTHER_PERSONAL,
  LEGACY_PERSONAL,
  SHARED_SUGGESTION,
  OWN_SUGGESTION,
  OTHER_SUGGESTION,
  LEGACY_SUGGESTION,
  GONE_SUGGESTION,
  world,
  calls,
  gate,
  mailSuggestions: suggestionsLib,
  mailUnsubscribe: unsubscribeLib,
  mailFilters: filtersLib,
} = hoisted

vi.mock('@auxx/lib/mail-suggestions', () => hoisted.mailSuggestions)
vi.mock('@auxx/lib/mail-unsubscribe', () => hoisted.mailUnsubscribe)
vi.mock('@auxx/lib/channels', () => hoisted.channels)
vi.mock('@auxx/lib/mail-filters', () => hoisted.mailFilters)
vi.mock('@auxx/lib/mail-filters/evaluate', () => ({
  assertFilterConditionsCompile: hoisted.assertFilterConditionsCompile,
}))
vi.mock('@auxx/lib/cache', () => ({
  getOrgCache: () => ({ get: hoisted.orgCacheGet }),
  onCacheEvent: hoisted.onCacheEvent,
  getCachedUserInstanceGrants: hoisted.getCachedUserInstanceGrants,
}))
vi.mock('@auxx/lib/settings', () => ({
  getUserSetting: vi.fn(async () => null),
  updateUserSetting: vi.fn(async () => {}),
}))
/**
 * The permissions BARREL is mocked (it hangs under vitest — the standing
 * gotcha), but `@auxx/lib/permissions/capabilities/registry` is NOT: the
 * authoring helper reads the real `PermissionKey.automationRulesManage`, so the
 * key's spelling is pinned against the registry rather than restated here.
 */
vi.mock('@auxx/lib/permissions', () => ({
  FeatureKey: { mailFiltersLimit: 'mailFiltersLimit' },
  FeaturePermissionService: hoisted.FeaturePermissionService,
}))

vi.mock('~/server/api/trpc', async () => {
  const { initTRPC } = await import('@trpc/server')
  const t = initTRPC.context<Record<string, unknown>>().create()
  return {
    createTRPCRouter: t.router,
    protectedProcedure: t.procedure,
    /** `capabilityProcedure` asserts NO key — it only resolves `ctx.capabilities`. */
    capabilityProcedure: t.procedure,
    permissionProcedure: (key: string) =>
      t.procedure.use(({ next }) => {
        hoisted.gate.push(key)
        return next()
      }),
  }
})

const { mailSuggestionsRouter } = await import('./mail-suggestions')

const caller = (userId: string = USER_ID) =>
  mailSuggestionsRouter.createCaller({
    db: {},
    headers: new Headers(),
    session: {
      userId,
      organizationId: ORG_ID,
      user: { id: userId },
    },
    capabilities: {
      can: (key: string) => world.capabilities.has(key),
      /** `>= read` — the unsubscribe/dismiss threshold (§7.1, v2 §2.1). */
      canViewInstance: (key: string, instanceId: string) =>
        key === 'inbox' && hoisted.satisfiesRead(world.inboxRungs.get(instanceId)),
      /** `>= edit`, i.e. `admin` on the mail ladder — the filter-authoring half. */
      canEditInstance: (key: string, instanceId: string) =>
        key === 'inbox' && hoisted.satisfiesEdit(world.inboxRungs.get(instanceId)),
    },
  } as never)

/** Compose one rung on one inbox. Defaults to the unsubscribe threshold. */
const grantInbox = (inboxId: string, rung: 'none' | 'metadata' | 'identity' | 'read' | 'admin') => {
  world.inboxRungs.set(inboxId, rung)
}

/** The shape `auxxErrorMiddleware` maps to a 403 / 404. */
const FORBIDDEN = { cause: { statusCode: 403 } }
const NOT_FOUND = { cause: { statusCode: 404 } }

/** An org admin composing `Inboxes: Full` — `admin` on EVERY inbox, plus the key. */
const asAutomationAdmin = () => {
  world.capabilities.add(AUTOMATION_KEY)
  grantInbox(SHARED_INBOX, 'admin')
  grantInbox(OWN_PERSONAL, 'admin')
  grantInbox(OTHER_PERSONAL, 'admin')
  grantInbox(LEGACY_PERSONAL, 'admin')
}

beforeEach(() => {
  world.capabilities.clear()
  world.inboxRungs.clear()
  world.unsubscribeOutcome = {
    status: 'requested',
    method: 'one-click',
    record: { id: 'mun_000000000000000000000000' },
  }
  world.canManageChannel = true
  vi.clearAllMocks()
  calls.length = 0
  gate.length = 0
})

describe('mailSuggestions router — §7.2 visibility', () => {
  /** Case 1 — ownership alone, no permission key at all. */
  it('shows a personal-mailbox owner exactly their own cards, with no key', async () => {
    const result = await caller().list()

    expect(result.map((row) => row.id)).toEqual([OWN_SUGGESTION])
    // The scope must reach the QUERY, not be applied after the read.
    expect(suggestionsLib.listMailSuggestions).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      expect.objectContaining({ inboxIds: [OWN_PERSONAL], userId: USER_ID })
    )
    expect(gate).toEqual([])
  })

  /** Case 2 — `isMailAdmin` confers NO override on a private mailbox. */
  it('never shows an admin another member’s personal-inbox cards', async () => {
    asAutomationAdmin()

    const ids = (await caller().list()).map((row) => row.id)

    expect(ids).toContain(SHARED_SUGGESTION)
    expect(ids).toContain(OWN_SUGGESTION)
    expect(ids).not.toContain(OTHER_SUGGESTION)
    // The legacy-window row: shared DEF, personal MARKER, owned by someone else.
    // The marker narrows and never widens, so an `Inboxes: Full` admin still
    // cannot see it.
    expect(ids).not.toContain(LEGACY_SUGGESTION)
    expect(suggestionsLib.listMailSuggestions).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      expect.objectContaining({
        inboxIds: expect.not.arrayContaining([OTHER_PERSONAL, LEGACY_PERSONAL]),
      })
    )
  })

  it('queries nothing at all for a member who can act on no mailbox', async () => {
    world.capabilities.add(AUTOMATION_KEY)

    expect(await caller(STRANGER_ID).list()).toEqual([])
    expect(await caller(STRANGER_ID).count()).toEqual({ count: 0 })
    // The empty allow-list must never fall through to an unscoped read — the
    // classic empty-`inArray` footgun turns "sees nothing" into "sees everything".
    expect(suggestionsLib.listMailSuggestions).not.toHaveBeenCalled()
  })

  it('counts exactly what the list renders', async () => {
    asAutomationAdmin()

    const listed = await caller().list()
    const counted = await caller().count()

    expect(counted.count).toBe(listed.length)
  })

  it('marks a shared-inbox card as shared and an owned one as not', async () => {
    asAutomationAdmin()

    const rows = await caller().list()
    const shared = rows.find((row) => row.id === SHARED_SUGGESTION)
    const own = rows.find((row) => row.id === OWN_SUGGESTION)

    expect(shared?.isSharedInbox).toBe(true)
    expect(own?.isSharedInbox).toBe(false)
    // The card advertises only what the router would allow.
    expect(shared?.canAuthorFilter).toBe(true)
    expect(shared?.canUnsubscribe).toBe(true)
  })

  it('hides the filter half from a caller without the automation key', async () => {
    grantInbox(SHARED_INBOX, 'admin')

    const shared = (await caller().list()).find((row) => row.id === SHARED_SUGGESTION)

    // Inbox authority is enough to unsubscribe (§7.1) and NOT enough to author a
    // filter — the card must say so rather than offering a button we would 403.
    expect(shared?.canUnsubscribe).toBe(true)
    expect(shared?.canAuthorFilter).toBe(false)
  })

  it('shows the cards to a plain READER of a shared mailbox', async () => {
    // v2 §2.1: the scope is the unsubscribe predicate, so widening that gate to
    // `read` widens visibility with it — correctly, because a member at `read`
    // can now answer every prompt the card offers.
    world.capabilities.add(AUTOMATION_KEY)
    grantInbox(SHARED_INBOX, 'read')

    const shared = (await caller().list()).find((row) => row.id === SHARED_SUGGESTION)

    expect(shared?.canUnsubscribe).toBe(true)
    // …and still cannot author the standing filter, which stayed at `admin`.
    expect(shared?.canAuthorFilter).toBe(false)
  })

  it.each([
    'none',
    'metadata',
    'identity',
  ] as const)('shows a member composing %s nothing at all', async (rung) => {
    grantInbox(SHARED_INBOX, rung)

    expect(await caller(STRANGER_ID).list()).toEqual([])
    expect(suggestionsLib.listMailSuggestions).not.toHaveBeenCalled()
  })
})

describe('mailSuggestions router — §7.1 unsubscribe authority', () => {
  /** Case 3 — inbox authority, and nothing else, is the whole gate. */
  it('denies unsubscribe on a shared inbox to a caller with no inbox access', async () => {
    // Deliberately holds the AUTOMATION key and no inbox rung: an automation
    // grant must not buy mail authority in either direction.
    world.capabilities.add(AUTOMATION_KEY)

    await expect(caller().unsubscribe({ suggestionId: SHARED_SUGGESTION })).rejects.toMatchObject(
      FORBIDDEN
    )
    expect(unsubscribeLib.executeUnsubscribe).not.toHaveBeenCalled()
  })

  it('allows unsubscribe on a shared inbox with inbox access and NO automation key', async () => {
    grantInbox(SHARED_INBOX, 'admin')

    const result = await caller().unsubscribe({ suggestionId: SHARED_SUGGESTION })

    expect(result).toMatchObject({ status: 'requested' })
    expect(unsubscribeLib.executeUnsubscribe).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        inboxId: SHARED_INBOX,
        userId: USER_ID,
        // Never derived in lib — it is what writes the audit row (invariant 11).
        isSharedInbox: true,
      })
    )
    expect(gate).toEqual([])
  })

  it('allows a personal-mailbox owner to unsubscribe with no permission key at all', async () => {
    const result = await caller().unsubscribe({ suggestionId: OWN_SUGGESTION })

    expect(result).toMatchObject({ status: 'requested' })
    expect(unsubscribeLib.executeUnsubscribe).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ inboxId: OWN_PERSONAL, isSharedInbox: false })
    )
  })

  it('hides another member’s personal-inbox card behind a 404, never a 403', async () => {
    asAutomationAdmin()

    // A 403 would confirm the row exists, which is exactly what §7.2 forbids for
    // a private mailbox.
    await expect(caller().unsubscribe({ suggestionId: OTHER_SUGGESTION })).rejects.toMatchObject(
      NOT_FOUND
    )
    await expect(caller().dismiss({ suggestionId: LEGACY_SUGGESTION })).rejects.toMatchObject(
      NOT_FOUND
    )
    expect(unsubscribeLib.executeUnsubscribe).not.toHaveBeenCalled()
    expect(suggestionsLib.dismissMailSuggestion).not.toHaveBeenCalled()
  })

  it('404s an unknown suggestion id before any authorization decision is made', async () => {
    asAutomationAdmin()

    await expect(caller().unsubscribe({ suggestionId: GONE_SUGGESTION })).rejects.toMatchObject(
      NOT_FOUND
    )
    expect(calls).toEqual(['getMailSuggestionById'])
  })

  it('returns a refusal as an OUTCOME rather than an error', async () => {
    grantInbox(SHARED_INBOX, 'admin')
    world.unsubscribeOutcome = {
      status: 'refused',
      refusal: { offered: false, reason: 'unverified-sender', alternative: 'block-sender' },
    }

    // "We won't unsubscribe from this, block the sender instead" is a legitimate
    // answer the card renders — never a toast the UI swallows.
    await expect(caller().unsubscribe({ suggestionId: SHARED_SUGGESTION })).resolves.toMatchObject({
      status: 'refused',
    })
  })
})

/**
 * V4 — the rung, not merely "some authority".
 *
 * §7.1 designed unsubscribe as the LOOSER of the two shared-inbox gates, but
 * asking `canEditInstance` on a ladder with no `edit` rung resolves to `admin`,
 * which is the strict half of the filter-authoring gate. The divergence had
 * collapsed invisibly because both landed on the same rung. User decision
 * 2026-08-10: unsubscribe is `read`; authoring is unchanged.
 */
describe('mailSuggestions router — v2 §2.1, unsubscribe is gated on inbox READ', () => {
  it('allows a member with inbox read who is NOT an inbox admin', async () => {
    grantInbox(SHARED_INBOX, 'read')

    await expect(caller().unsubscribe({ suggestionId: SHARED_SUGGESTION })).resolves.toMatchObject({
      status: 'requested',
    })
    expect(unsubscribeLib.executeUnsubscribe).toHaveBeenCalled()
  })

  it.each([
    'none',
    'metadata',
    'identity',
  ] as const)('denies a member composing %s', async (rung) => {
    grantInbox(SHARED_INBOX, rung)

    await expect(caller().unsubscribe({ suggestionId: SHARED_SUGGESTION })).rejects.toMatchObject(
      FORBIDDEN
    )
    expect(unsubscribeLib.executeUnsubscribe).not.toHaveBeenCalled()
  })

  it('does not move the AUTHORING gate — read still cannot accept', async () => {
    // The whole point of restoring the divergence: a one-shot command sits with
    // reply and assign at `read`, an unattended standing mutation does not.
    world.capabilities.add(AUTOMATION_KEY)
    grantInbox(SHARED_INBOX, 'read')

    await expect(caller().accept({ suggestionId: SHARED_SUGGESTION })).rejects.toMatchObject(
      FORBIDDEN
    )
    expect(filtersLib.createMailFilter).not.toHaveBeenCalled()
  })

  it("a reader of every shared mailbox still cannot touch another member's personal one", async () => {
    // The personal branch never consults a capability at all, so loosening the
    // shared rung must not reach across it. 404, never 403 — a private mailbox
    // must not be distinguishable from an id that was never real.
    grantInbox(SHARED_INBOX, 'read')
    grantInbox(OTHER_PERSONAL, 'read')
    grantInbox(LEGACY_PERSONAL, 'read')

    await expect(caller().unsubscribe({ suggestionId: OTHER_SUGGESTION })).rejects.toMatchObject(
      NOT_FOUND
    )
    await expect(caller().unsubscribe({ suggestionId: LEGACY_SUGGESTION })).rejects.toMatchObject(
      NOT_FOUND
    )
    expect(unsubscribeLib.executeUnsubscribe).not.toHaveBeenCalled()
  })

  it('carries the same rung to dismiss — the decline half of one decision', async () => {
    grantInbox(SHARED_INBOX, 'read')

    await expect(caller().dismiss({ suggestionId: SHARED_SUGGESTION })).resolves.toMatchObject({
      status: 'dismissed',
    })
  })
})

describe('mailSuggestions router — §6.2 block sender is a THIRD authority', () => {
  it('blocks the from-ADDRESS, never the group domain', async () => {
    // The refusal branch is dominated by consumer mail — on real data it includes
    // `domain:gmail.com` (477 messages), hotmail, outlook, yahoo. Blocking a
    // domain key there would stop every consumer sender on the channel,
    // customers included. Only the exact address may be blocked from a card.
    grantInbox(SHARED_INBOX, 'admin')

    const result = await caller().blockSender({ suggestionId: SHARED_SUGGESTION })

    expect(result).toMatchObject({ blockedAddress: 'news@acme.com' })
    expect(hoisted.channels.addExcludedSender).toHaveBeenCalledWith(
      expect.anything(),
      'int_000000000000000000000000',
      'news@acme.com'
    )
    // Never the domain half of the subject key.
    expect(calls).not.toContain('addExcludedSender:acme.com')
  })

  it('requires PER-CHANNEL manage authority, not just inbox write', async () => {
    // Blocking writes ChannelSettings.excludeSenders, which reaches every inbox
    // that channel feeds — strictly more than the one this card is about.
    grantInbox(SHARED_INBOX, 'admin')
    world.canManageChannel = false

    await expect(caller().blockSender({ suggestionId: SHARED_SUGGESTION })).rejects.toThrow(
      /manage shared channels/
    )
    expect(hoisted.channels.addExcludedSender).not.toHaveBeenCalled()
  })

  it('denies a caller without inbox access before it ever reaches the channel', async () => {
    world.capabilities.add(AUTOMATION_KEY)

    await expect(caller().blockSender({ suggestionId: SHARED_SUGGESTION })).rejects.toMatchObject(
      FORBIDDEN
    )
    expect(hoisted.channels.requireChannelManageAccess).not.toHaveBeenCalled()
    expect(hoisted.channels.addExcludedSender).not.toHaveBeenCalled()
  })

  it.each([
    'none',
    'metadata',
    'identity',
  ] as const)('refuses a %s reader before the channel layer, even after v2 §2.1 loosened the inbox gate', async (rung) => {
    // The ordering is the property: inbox authority is asserted FIRST, so
    // widening it must never let someone reach the channel gate who could not
    // reach it before.
    grantInbox(SHARED_INBOX, rung)

    await expect(caller().blockSender({ suggestionId: SHARED_SUGGESTION })).rejects.toMatchObject(
      FORBIDDEN
    )
    expect(hoisted.channels.requireChannelManageAccess).not.toHaveBeenCalled()
  })

  it('still requires the channel gate from a plain inbox READER', async () => {
    grantInbox(SHARED_INBOX, 'read')
    world.canManageChannel = false

    await expect(caller().blockSender({ suggestionId: SHARED_SUGGESTION })).rejects.toThrow(
      /manage shared channels/
    )
    expect(hoisted.channels.addExcludedSender).not.toHaveBeenCalled()
  })

  it('dismisses the card afterwards — blocking IS the answer', async () => {
    // A status write, never a delete: otherwise the next weekly sweep re-proposes
    // a sender the user has already blocked (invariant 7).
    grantInbox(SHARED_INBOX, 'admin')

    await caller().blockSender({ suggestionId: SHARED_SUGGESTION })

    expect(suggestionsLib.dismissMailSuggestion).toHaveBeenCalled()
  })
})

describe('mailSuggestions router — invariant 10, accept is a prefill', () => {
  /** Case 4 — accepting runs the SAME gate as authoring a filter by hand. */
  it('denies accept to a caller with inbox write but no automation key', async () => {
    grantInbox(SHARED_INBOX, 'admin')

    await expect(caller().accept({ suggestionId: SHARED_SUGGESTION })).rejects.toMatchObject(
      FORBIDDEN
    )
    expect(filtersLib.createMailFilter).not.toHaveBeenCalled()
    expect(suggestionsLib.markMailSuggestionAccepted).not.toHaveBeenCalled()
  })

  it('denies accept to a key holder with no inbox write', async () => {
    world.capabilities.add(AUTOMATION_KEY)

    await expect(caller().accept({ suggestionId: SHARED_SUGGESTION })).rejects.toMatchObject(
      FORBIDDEN
    )
    expect(filtersLib.createMailFilter).not.toHaveBeenCalled()
  })

  it('creates the filter through the ordinary create path, then marks the card accepted', async () => {
    asAutomationAdmin()

    const result = await caller().accept({ suggestionId: SHARED_SUGGESTION })

    // The compile check is not optional: a condition the query builder cannot
    // dispatch is dropped SILENTLY, and an all-dropped filter matches the whole
    // inbox. Reusing `mailFilters.create` is what keeps it in the path.
    expect(calls).toContain('assertFilterConditionsCompile')
    expect(filtersLib.createMailFilter).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      expect.objectContaining({
        inboxId: SHARED_INBOX,
        actions: [{ type: 'set-status', status: 'ARCHIVED' }],
      }),
      USER_ID
    )
    expect(suggestionsLib.markMailSuggestionAccepted).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      SHARED_SUGGESTION,
      'mfl_created0000000000000000'
    )
    // The follow-up "also apply to N existing conversations?" is a confirm, not
    // a second dialog — so the count rides on the response.
    expect(result).toMatchObject({ filterId: 'mfl_created0000000000000000', matchCount: 12 })
  })

  it('lets a personal-mailbox owner accept with no permission key at all', async () => {
    await caller().accept({ suggestionId: OWN_SUGGESTION })

    expect(filtersLib.createMailFilter).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      expect.objectContaining({ inboxId: OWN_PERSONAL }),
      USER_ID
    )
    expect(gate).toEqual([])
  })
})

describe('mailSuggestions router — invariant 7, dismissal is a row', () => {
  it('writes a dismissed status and never deletes', async () => {
    const result = await caller().dismiss({ suggestionId: OWN_SUGGESTION })

    // Dismissed rows ARE the suppression list. A delete here resurrects the same
    // card on the next weekly sweep, forever.
    expect(result.status).toBe('dismissed')
    expect(suggestionsLib.dismissMailSuggestion).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      OWN_SUGGESTION
    )
  })

  it('denies dismissing a shared-inbox card without inbox write', async () => {
    world.capabilities.add(AUTOMATION_KEY)

    await expect(caller().dismiss({ suggestionId: SHARED_SUGGESTION })).rejects.toMatchObject(
      FORBIDDEN
    )
    expect(suggestionsLib.dismissMailSuggestion).not.toHaveBeenCalled()
  })
})
