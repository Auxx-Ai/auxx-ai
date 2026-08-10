// apps/web/src/server/api/routers/mail-filters.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The mail-filters router's authorization model, driven through real tRPC callers.
 *
 * ## Why this file is mandatory (invariant 11)
 *
 * `settings/rules` is currently gated whole-page by
 * `CapabilityPageGuard(automationRules.manage)`. Phase 1 of the mail-filters plan
 * moves that guard DOWN to the sections, because personal-mailbox owners manage
 * their filters on that page and hold no automation key at all (§6.4/D14). Once
 * it is gone, **this router is the only authorization path left** — so the four
 * cases §10.11 names verbatim are pinned here, as router tests, not as UI checks:
 *
 *  1. holds `automationRules.manage`, writes to no inbox ⇒ sees no shared filters
 *  2. owns a personal inbox, no key ⇒ sees exactly their own
 *  3. no key, shared inbox write ⇒ denied on create
 *  4. admin ⇒ never sees another member's personal filters
 *
 * plus invariant 15 (the keyed actions are rejected SERVER-SIDE, not merely
 * hidden) and invariant 14 (the limit gate's ENFORCED value is asserted, never
 * assumed from the seed).
 *
 * ## Shape notes
 *
 * `@auxx/lib/mail-filters` is mocked wholesale: it is a pure data module by
 * design (zero permission checks — the router is the gate), so what matters here
 * is WHICH inbox ids reach `listMailFilters` and WHETHER `createMailFilter` is
 * reached at all. `~/server/lib/mail-filter-authoring-access` is deliberately NOT
 * mocked — the §5.1 branch is the thing under test.
 *
 * `permissionProcedure` really enforces and RECORDS the key it asserted. That
 * recording is the revert tripwire: every positive test runs with an EMPTY
 * capability set and asserts `gate` is `[]`, so re-gating a procedure on
 * `permissionProcedure(automationRulesManage)` fails twice over — the key appears
 * in `gate`, and the personal-mailbox owner 403s.
 *
 * Denials assert STATUS CODES (`cause.statusCode`), never merely "it threw":
 * a 404 where a 403 belongs (or the reverse) is the whole substance of "do not
 * leak existence".
 */

const AUTOMATION_KEY = 'automationRules.manage'

const hoisted = vi.hoisted(() => {
  const ORG_ID = 'org_cuid000000000000000000000'
  const USER_ID = 'usr_member00000000000000000'
  const OTHER_USER_ID = 'usr_other000000000000000000'
  /** A member who owns no mailbox at all — the empty-authorable-set case. */
  const STRANGER_ID = 'usr_stranger00000000000000'

  /** A shared mailbox on the `inbox` def. */
  const SHARED_INBOX = 'inb_shared00000000000000000'
  /** The caller's own mailbox on the `personal_inbox` def. */
  const OWN_PERSONAL = 'inb_ownpersonal000000000000'
  /** Somebody else's mailbox on the `personal_inbox` def. */
  const OTHER_PERSONAL = 'inb_otherpersonal0000000000'
  /** A personal mailbox still on the SHARED def — the 059→060 migration window. */
  const LEGACY_PERSONAL = 'inb_legacypersonal000000000'

  const SHARED_FILTER = 'mfl_shared00000000000000000'
  const OWN_FILTER = 'mfl_own00000000000000000000'
  const OTHER_FILTER = 'mfl_other00000000000000000'
  /**
   * A filter on the 059→060 migration-window mailbox: SHARED def, personal
   * marker, somebody else's. It is the row that separates "personal by
   * definition" from "personal in fact", and a refusal keyed on the def alone
   * would name it.
   */
  const LEGACY_FILTER = 'mfl_legacy00000000000000000'
  /**
   * A filter id with NO row — `MailFilterRun.filterId` carries no FK on purpose,
   * so a run whose filter was deleted is a real, expected state.
   */
  const GONE_FILTER = 'mfl_deleted0000000000000000'

  /** A thread whose header shows the "Filtered by …" chips. */
  const THREAD_ID = 'thr_filtered0000000000000000'
  /** A thread only somebody else's personal filter ever touched. */
  const FOREIGN_THREAD = 'thr_foreign00000000000000000'
  /** A thread carrying the two awkward undo states. */
  const UNDO_THREAD = 'thr_undo00000000000000000000'

  const RUN_OWN = 'mfr_own00000000000000000000'
  const RUN_OTHER = 'mfr_other000000000000000000'
  const RUN_FOREIGN = 'mfr_foreign0000000000000000'
  const RUN_ORPHAN = 'mfr_orphan00000000000000000'
  /** Claimed, then the process died before the completing UPDATE wrote `undo`. */
  const RUN_NO_UNDO = 'mfr_noundo00000000000000000'
  const RUN_UNDONE = 'mfr_undone00000000000000000'

  const world = {
    /** Layer-2 capability keys the caller holds. EMPTY is the interesting case. */
    capabilities: new Set<string>(),
    /** Inbox ids the caller composes `edit`+ on (the shared branch's second half). */
    writableInboxIds: new Set<string>(),
    /** `mailFiltersLimit` as the plan actually stores it. `'+'` = unlimited. */
    planLimit: '+' as number | '+',
    /** What `countBillableMailFilters` answers. */
    billableCount: 0,
    /** What `countPersonalMailFilters` answers. */
    personalCount: 0,
    /** Filters `loadBackfillableFilter` refuses because they are switched off. */
    disabledFilterIds: new Set<string>(),
    /** Inboxes `findPendingRetroactivePrompt` would ask about, before dismissals. */
    promptInboxIds: new Set<string>(),
  }

  /** Every lib helper the router reached, in order. */
  const calls: string[] = []
  /** Capability keys `permissionProcedure` asserted, in order. */
  const gate: string[] = []

  const ok = <T>(value: T) => ({ isOk: () => true, isErr: () => false, value })
  const errResult = (error: Error) => ({ isOk: () => false, isErr: () => true, error })

  const notFound = (message: string): Error => {
    const error = new Error(message)
    error.name = 'NotFoundError'
    ;(error as Error & { statusCode: number }).statusCode = 404
    return error
  }
  const forbidden = (message: string): Error => {
    const error = new Error(message)
    error.name = 'ForbiddenError'
    ;(error as Error & { statusCode: number }).statusCode = 403
    return error
  }
  const badRequest = (message: string): Error => {
    const error = new Error(message)
    error.name = 'BadRequestError'
    ;(error as Error & { statusCode: number }).statusCode = 400
    return error
  }
  const unprocessable = (message: string): Error => {
    const error = new Error(message)
    error.name = 'UnprocessableEntityError'
    ;(error as Error & { statusCode: number }).statusCode = 422
    return error
  }

  /** filterId → the inbox it lives on. Absent ⇒ no such filter in THIS org. */
  const filterInboxes: Record<string, string> = {
    [SHARED_FILTER]: SHARED_INBOX,
    [OWN_FILTER]: OWN_PERSONAL,
    [OTHER_FILTER]: OTHER_PERSONAL,
    [LEGACY_FILTER]: LEGACY_PERSONAL,
  }

  const filterRow = (id: string) => ({
    id,
    organizationId: ORG_ID,
    inboxId: filterInboxes[id],
    name: id,
    order: 0,
    stopProcessing: false,
    enabled: true,
    conditions: [],
    actions: [{ type: 'set-status', status: 'ARCHIVED' }],
    createdByUserId: USER_ID,
    templateKey: null,
    lastFiredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  /**
   * A FAITHFUL stand-in for the SQL scope: if the router forgot to pass
   * `inboxIds`, this returns every filter in the org and the scoping tests fail —
   * which is exactly the regression worth catching.
   */
  const listMailFilters = vi.fn(
    async (_db: unknown, _orgId: string, opts: { inboxIds?: string[] } = {}) => {
      calls.push('listMailFilters')
      const rows = Object.keys(filterInboxes).map(filterRow)
      if (!opts.inboxIds) return ok(rows)
      const allowed = new Set(opts.inboxIds)
      return ok(rows.filter((row) => allowed.has(row.inboxId)))
    }
  )

  const getMailFilterById = vi.fn(async (_db: unknown, _orgId: string, filterId: string) => {
    calls.push('getMailFilterById')
    if (!filterInboxes[filterId]) return errResult(notFound('Filter not found'))
    return ok(filterRow(filterId))
  })

  const createMailFilter = vi.fn(async (_db: unknown, _orgId: string, input: object) => {
    calls.push('createMailFilter')
    return ok({ ...filterRow(SHARED_FILTER), ...input })
  })

  const recorder = <T>(name: string, value: T) =>
    vi.fn(async () => {
      calls.push(name)
      return ok(value)
    })

  const countBillableMailFilters = vi.fn(async () => {
    calls.push('countBillableMailFilters')
    return world.billableCount
  })
  const countPersonalMailFilters = vi.fn(async () => {
    calls.push('countPersonalMailFilters')
    return world.personalCount
  })

  // ── run history (`threadRuns` / `undoRun`) ─────────────────────────────────

  interface RunRow {
    id: string
    organizationId: string
    filterId: string
    threadId: string
    messageId: string
    source: string
    outcomes: { type: string; status: string }[]
    status: string
    undo: Record<string, unknown> | null
    undoneAt: Date | null
    firedAt: Date
  }

  const runRow = (
    id: string,
    filterId: string,
    threadId: string,
    extra: Partial<RunRow> = {}
  ): RunRow => ({
    id,
    organizationId: ORG_ID,
    filterId,
    threadId,
    messageId: `msg_${id}`,
    source: 'live',
    outcomes: [{ type: 'set-status', status: 'applied' }],
    status: 'applied',
    undo: { status: 'OPEN', assigneeId: null, inboxId: null, tagIds: [], read: null },
    undoneAt: null,
    firedAt: new Date(),
    ...extra,
  })

  const runRows: Record<string, RunRow> = {
    [RUN_OWN]: runRow(RUN_OWN, OWN_FILTER, THREAD_ID),
    // Same thread, but fired by a filter on somebody else's personal mailbox —
    // the run row carries that filter's NAME, which is the §5.1 leak.
    [RUN_OTHER]: runRow(RUN_OTHER, OTHER_FILTER, THREAD_ID),
    // The filter row is gone; the run row is not (no FK, by design).
    [RUN_ORPHAN]: runRow(RUN_ORPHAN, GONE_FILTER, THREAD_ID),
    [RUN_FOREIGN]: runRow(RUN_FOREIGN, OTHER_FILTER, FOREIGN_THREAD),
    [RUN_NO_UNDO]: runRow(RUN_NO_UNDO, OWN_FILTER, UNDO_THREAD, { undo: null, status: 'failed' }),
    [RUN_UNDONE]: runRow(RUN_UNDONE, OWN_FILTER, UNDO_THREAD, { undoneAt: new Date() }),
  }

  const listMailFilterRunsForThread = vi.fn(
    async (_db: unknown, _orgId: string, threadId: string) => {
      calls.push('listMailFilterRunsForThread')
      return ok(Object.values(runRows).filter((row) => row.threadId === threadId))
    }
  )

  const getMailFilterRunById = vi.fn(async (_db: unknown, _orgId: string, runId: string) => {
    calls.push('getMailFilterRunById')
    const row = runRows[runId]
    if (!row) return errResult(notFound('Filter run not found'))
    return ok(row)
  })

  /**
   * A FAITHFUL stand-in for `@auxx/lib/mail-filters/undo.ts`'s three exits, so
   * the router test can pin which of them reaches the client unaltered:
   * already-undone is an `ok` NO-OP, a NULL blob is a 422, everything else
   * reverses. The lib semantics themselves are pinned in that module's own
   * `undo.test.ts`; what is under test here is that the router re-throws
   * `result.error` rather than flattening it.
   */
  const undoMailFilterRun = vi.fn(async (_db: unknown, _orgId: string, runId: string) => {
    calls.push('undoMailFilterRun')
    const row = runRows[runId]
    if (!row) return errResult(notFound('Filter run not found'))
    if (row.undoneAt) return ok({ undone: false, restored: [] as string[], skipped: [] })
    if (!row.undo) {
      return errResult(
        unprocessable(
          'This filter run cannot be undone — it never recorded what the conversation looked like beforehand.'
        )
      )
    }
    return ok({ undone: true, restored: ['status'], skipped: [] })
  })

  // ── reach (`previewMatchCount` / `applyRetroactively` / the prompt) ────────

  const previewMatchCount = vi.fn(async () => {
    calls.push('previewMatchCount')
    return { count: 7, capped: false, lowerBound: true as const }
  })

  const applyRetroactively = vi.fn(async () => {
    calls.push('applyRetroactively')
  })

  const loadBackfillableFilter = vi.fn(async (_db: unknown, _orgId: string, filterId: string) => {
    calls.push('loadBackfillableFilter')
    if (!filterInboxes[filterId]) return errResult(notFound('Filter not found'))
    if (world.disabledFilterIds.has(filterId)) {
      return errResult(
        badRequest('Enable this filter before applying it to existing conversations.')
      )
    }
    return ok(filterRow(filterId))
  })

  const findPendingRetroactivePrompt = vi.fn(
    async (_db: unknown, _orgId: string, candidateInboxIds: string[]) => {
      calls.push('findPendingRetroactivePrompt')
      const inboxId = candidateInboxIds.find((id) => world.promptInboxIds.has(id))
      if (!inboxId) return null
      return { inboxId, filterCount: 1, threadCount: 12, threadCountCapped: false }
    }
  )

  /**
   * A FAITHFUL stand-in for `@auxx/lib/mail-filters/evaluate`'s save-time gate.
   *
   * It models the one drop the shipped dialog can actually produce: `FieldType.TEXT`
   * offers `starts with`, `buildBodyQuery` handles `contains` / `not contains` only.
   * The real function's semantics are pinned in `evaluate.test.ts`; what is under
   * test HERE is that the router runs it on both write paths, before it meters
   * anything, and lets the 400 through.
   */
  const assertFilterConditionsCompile = vi.fn((conditions: { conditions?: unknown[] }[]) => {
    calls.push('assertFilterConditionsCompile')
    const flat = conditions.flatMap((group) => group.conditions ?? [])
    const bad = flat.find(
      (c) =>
        (c as { fieldId?: string }).fieldId === 'body' &&
        (c as { operator?: string }).operator === 'starts with'
    )
    if (bad) {
      throw badRequest(
        'This filter can’t be saved because “Body” does not support the “starts with” operator. Pick a different field or operator.'
      )
    }
  })

  const mailFilters = {
    ACTION_REQUIRING_AUTOMATION_KEY: ['run-agent', 'run-workflow'],
    MAX_PERSONAL_MAIL_FILTERS: 50,
    applyRetroactively,
    countBillableMailFilters,
    countPersonalMailFilters,
    createMailFilter,
    deleteMailFilter: recorder('deleteMailFilter', undefined),
    findPendingRetroactivePrompt,
    getMailFilterById,
    getMailFilterRunById,
    listMailFilterRuns: recorder('listMailFilterRuns', []),
    listMailFilterRunsForThread,
    listMailFilters,
    loadBackfillableFilter,
    previewMatchCount,
    reorderMailFilters: recorder('reorderMailFilters', undefined),
    setMailFilterEnabled: recorder('setMailFilterEnabled', filterRow(OWN_FILTER)),
    undoMailFilterRun,
    updateMailFilter: recorder('updateMailFilter', filterRow(OWN_FILTER)),
  }

  /**
   * The per-user settings store behind the prompt dismissal (D18).
   *
   * Keyed by `organizationId:userId:key` on purpose — `access: 'user'` in the
   * settings catalog is the whole guarantee, so a router that dropped `userId`
   * from either call would make one member's dismissal global.
   */
  const userSettings = new Map<string, unknown>()
  const getUserSetting = vi.fn(
    async (params: { userId: string; organizationId: string; key: string }) => {
      calls.push('getUserSetting')
      return userSettings.get(`${params.organizationId}:${params.userId}:${params.key}`) ?? null
    }
  )
  const updateUserSetting = vi.fn(
    async (params: { userId: string; organizationId: string; key: string; value: unknown }) => {
      calls.push('updateUserSetting')
      userSettings.set(`${params.organizationId}:${params.userId}:${params.key}`, params.value)
    }
  )

  /** The preview's viewer — resolved for the REQUESTING user, never SYSTEM. */
  const getCachedUserInstanceGrants = vi.fn(async (userId: string, organizationId: string) => {
    calls.push('getCachedUserInstanceGrants')
    return { userId, organizationId }
  })

  /**
   * The `inboxes` org-cache list. `entityDefinitionKey` is the def discriminator
   * the §5.1 branch keys on; `isPersonal` is the DERIVED marker, present so the
   * legacy-window row can disagree with its def exactly as it does in production.
   */
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

  /** The plan-limit gate, faithful to `FeaturePermissionService.requireLimit`. */
  class FeaturePermissionService {
    async requireLimit(_orgId: string, key: string, countFn: () => Promise<number>) {
      calls.push(`requireLimit:${key}`)
      if (world.planLimit === '+') return
      const current = await countFn()
      if (current >= world.planLimit) {
        throw forbidden(`You have reached your mail filters limit (${world.planLimit}).`)
      }
    }
  }

  return {
    ORG_ID,
    USER_ID,
    OTHER_USER_ID,
    STRANGER_ID,
    SHARED_INBOX,
    OWN_PERSONAL,
    OTHER_PERSONAL,
    LEGACY_PERSONAL,
    SHARED_FILTER,
    OWN_FILTER,
    OTHER_FILTER,
    LEGACY_FILTER,
    GONE_FILTER,
    THREAD_ID,
    FOREIGN_THREAD,
    UNDO_THREAD,
    RUN_OWN,
    RUN_OTHER,
    RUN_FOREIGN,
    RUN_ORPHAN,
    RUN_NO_UNDO,
    RUN_UNDONE,
    world,
    calls,
    gate,
    forbidden,
    assertFilterConditionsCompile,
    mailFilters,
    orgCacheGet,
    onCacheEvent,
    getCachedUserInstanceGrants,
    getUserSetting,
    updateUserSetting,
    userSettings,
    FeaturePermissionService,
  }
})

const {
  ORG_ID,
  USER_ID,
  OTHER_USER_ID,
  STRANGER_ID,
  SHARED_INBOX,
  OWN_PERSONAL,
  OTHER_PERSONAL,
  LEGACY_PERSONAL,
  SHARED_FILTER,
  OWN_FILTER,
  OTHER_FILTER,
  LEGACY_FILTER,
  GONE_FILTER,
  THREAD_ID,
  FOREIGN_THREAD,
  RUN_OWN,
  RUN_OTHER,
  RUN_ORPHAN,
  RUN_NO_UNDO,
  RUN_UNDONE,
  world,
  calls,
  gate,
  mailFilters: lib,
} = hoisted

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
  getUserSetting: hoisted.getUserSetting,
  updateUserSetting: hoisted.updateUserSetting,
}))
/**
 * The permissions BARREL is mocked (it hangs under vitest — the standing
 * gotcha), but `@auxx/lib/permissions/capabilities/registry` is NOT: the
 * authorization helper reads the real `PermissionKey.automationRulesManage`, so
 * the key's spelling is pinned against the registry rather than restated here.
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
        if (!hoisted.world.capabilities.has(key)) {
          const error = new Error(`You don't have permission: ${key}`)
          error.name = 'ForbiddenError'
          ;(error as Error & { statusCode: number }).statusCode = 403
          throw error
        }
        return next()
      }),
  }
})

const { mailFiltersRouter } = await import('./mail-filters')

/**
 * `userId` is a parameter because ownership is half the rule: the same
 * capability premise has to be exercised both by a member who owns a personal
 * mailbox and by one who owns none.
 */
const caller = (userId: string = USER_ID) =>
  mailFiltersRouter.createCaller({
    db: {},
    session: {
      userId,
      organizationId: ORG_ID,
      user: { id: userId },
    },
    capabilities: {
      can: (key: string) => world.capabilities.has(key),
      canEditInstance: (key: string, instanceId: string) =>
        key === 'inbox' && world.writableInboxIds.has(instanceId),
    },
  } as never)

/** The shape `auxxErrorMiddleware` maps to a 403 / 404. */
const FORBIDDEN = { cause: { statusCode: 403 } }
const NOT_FOUND = { cause: { statusCode: 404 } }
const BAD_REQUEST = { cause: { statusCode: 400 } }
const UNPROCESSABLE = { cause: { statusCode: 422 } }

/** An org admin composing `Inboxes: Full` — write on EVERY inbox, plus the key. */
const asAutomationAdmin = () => {
  world.capabilities.add(AUTOMATION_KEY)
  world.writableInboxIds.add(SHARED_INBOX)
  world.writableInboxIds.add(OWN_PERSONAL)
  world.writableInboxIds.add(OTHER_PERSONAL)
  world.writableInboxIds.add(LEGACY_PERSONAL)
}

const ARCHIVE = [{ type: 'set-status' as const, status: 'ARCHIVED' as const }]

/**
 * `Body starts with "Unsubscribe"` — offered by the dialog (`FieldType.TEXT`
 * advertises `starts with`), compiled by nothing. It drops, the predicate
 * collapses to the org scope, and the filter matches the whole inbox.
 */
const UNCOMPILABLE_CONDITIONS = [
  {
    id: 'grp_1',
    logicalOperator: 'AND',
    conditions: [{ id: 'cnd_1', fieldId: 'body', operator: 'starts with', value: 'Unsubscribe' }],
  },
]

const COMPILABLE_CONDITIONS = [
  {
    id: 'grp_1',
    logicalOperator: 'AND',
    conditions: [{ id: 'cnd_1', fieldId: 'body', operator: 'contains', value: 'Unsubscribe' }],
  },
]

beforeEach(() => {
  world.capabilities.clear()
  world.writableInboxIds.clear()
  world.planLimit = '+'
  world.billableCount = 0
  world.personalCount = 0
  world.disabledFilterIds.clear()
  world.promptInboxIds.clear()
  hoisted.userSettings.clear()
  vi.clearAllMocks()
  calls.length = 0
  gate.length = 0
})

describe('mailFilters router — §5.1 authorship', () => {
  /** §10.11 case 1 — the key alone reaches nothing. */
  it('shows no shared filters to an automation admin who writes to no inbox', async () => {
    world.capabilities.add(AUTOMATION_KEY)

    const result = await caller().list()

    expect(result.map((row) => row.id)).not.toContain(SHARED_FILTER)
    expect(lib.listMailFilters).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      expect.objectContaining({ inboxIds: expect.not.arrayContaining([SHARED_INBOX]) })
    )
    expect((await caller().authorableInboxes()).map((i) => i.id)).not.toContain(SHARED_INBOX)
    expect(gate).toEqual([])
  })

  it('queries nothing at all for a key holder who owns no mailbox either', async () => {
    world.capabilities.add(AUTOMATION_KEY)

    expect(await caller(STRANGER_ID).list()).toEqual([])
    expect(await caller(STRANGER_ID).authorableInboxes()).toEqual([])
    // The empty allow-list must never fall through to an unscoped read — the
    // classic empty-`inArray` footgun turns "sees nothing" into "sees everything".
    expect(lib.listMailFilters).not.toHaveBeenCalled()
    expect(gate).toEqual([])
  })

  /** §10.11 case 2 — ownership alone, no permission key at all. */
  it('shows a personal-mailbox owner exactly their own filters, with no key', async () => {
    const result = await caller().list()

    expect(result.map((row) => row.id)).toEqual([OWN_FILTER])
    // The scope must reach the QUERY, not be applied after the read.
    expect(lib.listMailFilters).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      expect.objectContaining({ inboxIds: [OWN_PERSONAL] })
    )
    expect(await caller().authorableInboxes()).toEqual([
      { id: OWN_PERSONAL, name: OWN_PERSONAL, isPersonal: true },
    ])
    expect(gate).toEqual([])
  })

  /** §10.11 case 3 — the key is required even with inbox write. */
  it('denies create on a shared inbox to a caller with inbox write but no key', async () => {
    world.writableInboxIds.add(SHARED_INBOX)

    await expect(
      caller().create({ inboxId: SHARED_INBOX, name: 'Newsletters', actions: ARCHIVE })
    ).rejects.toMatchObject(FORBIDDEN)

    expect(lib.createMailFilter).not.toHaveBeenCalled()
    // Refused before any counter or plan read — authorize first, then meter.
    expect(calls).toEqual([])
  })

  it('denies create on a shared inbox to a key holder with no inbox write', async () => {
    world.capabilities.add(AUTOMATION_KEY)

    await expect(
      caller().create({ inboxId: SHARED_INBOX, name: 'Newsletters', actions: ARCHIVE })
    ).rejects.toMatchObject(FORBIDDEN)

    expect(lib.createMailFilter).not.toHaveBeenCalled()
  })

  it('allows create on a shared inbox when BOTH halves hold', async () => {
    world.capabilities.add(AUTOMATION_KEY)
    world.writableInboxIds.add(SHARED_INBOX)

    await caller().create({ inboxId: SHARED_INBOX, name: 'Newsletters', actions: ARCHIVE })

    expect(lib.createMailFilter).toHaveBeenCalledTimes(1)
    expect(calls).toContain('onCacheEvent:mail-filter.changed')
  })

  /** §10.11 case 4 — `isMailAdmin` confers NO override; there is no OWNER bypass. */
  it("never shows an admin another member's personal filters", async () => {
    world.capabilities.add(AUTOMATION_KEY)
    // An org admin composing `Inboxes: Full` resolves write on EVERY inbox…
    world.writableInboxIds.add(SHARED_INBOX)
    world.writableInboxIds.add(OWN_PERSONAL)
    world.writableInboxIds.add(OTHER_PERSONAL)
    world.writableInboxIds.add(LEGACY_PERSONAL)

    const result = await caller().list()

    // …and still sees neither the other member's personal-def mailbox nor their
    // legacy-window one, which is still sitting on the SHARED def.
    expect(result.map((row) => row.id).sort()).toEqual([OWN_FILTER, SHARED_FILTER].sort())
    expect(lib.listMailFilters).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      expect.objectContaining({ inboxIds: expect.not.arrayContaining([OTHER_PERSONAL]) })
    )
    expect((await caller().authorableInboxes()).map((i) => i.id)).not.toContain(LEGACY_PERSONAL)
  })

  /**
   * The positive control for the legacy-window narrowing above: it must fail
   * closed against everyone EXCEPT the owner, not against everyone. A
   * denial-only assertion would pass just as happily if the row were dropped
   * from every caller's set, including the person whose mailbox it is.
   */
  it('still lets the owner author on a personal mailbox stuck on the shared def', async () => {
    const result = await caller(OTHER_USER_ID).authorableInboxes()

    expect(result.map((i) => i.id).sort()).toEqual([LEGACY_PERSONAL, OTHER_PERSONAL].sort())
    // Def-keyed, so the legacy row bills against the ORG plan — the same test
    // `countBillableMailFilters` applies. Authorization narrows; metering does not.
    expect(result.find((i) => i.id === LEGACY_PERSONAL)).toMatchObject({ isPersonal: false })
    expect(gate).toEqual([])
  })

  /** V6 — the refusal is 404, not 403. The full matrix is its own describe below. */
  it("refuses to mutate another member's personal filter", async () => {
    world.capabilities.add(AUTOMATION_KEY)
    world.writableInboxIds.add(OTHER_PERSONAL)

    await expect(
      caller().setEnabled({ filterId: OTHER_FILTER, enabled: false })
    ).rejects.toMatchObject(NOT_FOUND)
    expect(lib.setMailFilterEnabled).not.toHaveBeenCalled()
  })

  /**
   * Existence must not leak on the READ paths: a filter on an inbox the caller
   * cannot author on is indistinguishable from one that does not exist.
   */
  it.each(['get', 'runs'] as const)('404s %s on an unauthorable filter, never 403s', async (op) => {
    const invoke = caller() as unknown as Record<string, (arg: unknown) => Promise<unknown>>

    await expect(invoke[op]!({ filterId: OTHER_FILTER })).rejects.toMatchObject(NOT_FOUND)
    expect(lib.listMailFilterRuns).not.toHaveBeenCalled()
  })

  it('serves get/runs for the caller’s own personal filter', async () => {
    expect(await caller().get({ filterId: OWN_FILTER })).toMatchObject({ id: OWN_FILTER })
    await caller().runs({ filterId: OWN_FILTER })
    expect(lib.listMailFilterRuns).toHaveBeenCalledTimes(1)
  })

  /**
   * Rights change after a filter is written and an inbox can be moved between
   * defs, so EVERY mutating procedure re-asserts (§5.1) rather than trusting the
   * authorization that allowed the create.
   */
  describe('every mutation re-asserts', () => {
    const mutations: Array<{ name: string; input: object; helper: () => unknown }> = [
      {
        name: 'update',
        input: { filterId: SHARED_FILTER, name: 'x' },
        helper: () => lib.updateMailFilter,
      },
      {
        name: 'setEnabled',
        input: { filterId: SHARED_FILTER, enabled: false },
        helper: () => lib.setMailFilterEnabled,
      },
      { name: 'delete', input: { filterId: SHARED_FILTER }, helper: () => lib.deleteMailFilter },
      {
        name: 'reorder',
        input: { inboxId: SHARED_INBOX, orderedFilterIds: [SHARED_FILTER] },
        helper: () => lib.reorderMailFilters,
      },
    ]

    for (const { name, input, helper } of mutations) {
      it(`${name} refuses an inbox the caller may no longer author on`, async () => {
        // The caller holds the key but has lost inbox write since the create.
        world.capabilities.add(AUTOMATION_KEY)

        const invoke = caller() as unknown as Record<string, (arg: unknown) => Promise<unknown>>
        await expect(invoke[name]!(input)).rejects.toMatchObject(FORBIDDEN)
        expect(helper()).not.toHaveBeenCalled()
        expect(gate).toEqual([])
      })

      it(`${name} succeeds and busts the cache when authority holds`, async () => {
        world.capabilities.add(AUTOMATION_KEY)
        world.writableInboxIds.add(SHARED_INBOX)

        const invoke = caller() as unknown as Record<string, (arg: unknown) => Promise<unknown>>
        await invoke[name]!(input)

        expect(helper()).toHaveBeenCalledTimes(1)
        expect(calls).toContain('onCacheEvent:mail-filter.changed')
      })
    }
  })
})

/**
 * V6 (`plans/mail-filter/04-v2-plan.md` §1.3) — the SHAPE of the refusal on the
 * four filter-addressed write paths.
 *
 * §5.1 promises a personal filter you do not own is indistinguishable from one
 * that does not exist. The read paths kept that promise; these four answered
 * 403, which is an existence oracle for a guessed CUID. They now answer 404 —
 * **with the same message** `getMailFilterById` uses, because a distinct string
 * is a distinguishing signal even when the status matches.
 *
 * A shared-inbox filter deliberately stays 403: the caller can see that inbox,
 * so "you need permission to manage automation rules" is the actionable answer
 * rather than a lie. Flattening the two into one code is the failure mode this
 * block exists to catch, in BOTH directions — hence the positive controls.
 */
describe('mailFilters router — 404 vs 403 on the filter write paths', () => {
  /** Byte-identical to what `getMailFilterById` answers for an id with no row. */
  const GONE = { cause: { statusCode: 404, message: 'Filter not found' } }

  const writes: Array<{
    name: 'update' | 'setEnabled' | 'delete' | 'applyRetroactively'
    input: (filterId: string) => object
    helper: () => unknown
  }> = [
    {
      name: 'update',
      input: (filterId) => ({ filterId, name: 'Renamed' }),
      helper: () => lib.updateMailFilter,
    },
    {
      name: 'setEnabled',
      input: (filterId) => ({ filterId, enabled: false }),
      helper: () => lib.setMailFilterEnabled,
    },
    { name: 'delete', input: (filterId) => ({ filterId }), helper: () => lib.deleteMailFilter },
    {
      name: 'applyRetroactively',
      input: (filterId) => ({ filterId }),
      helper: () => lib.applyRetroactively,
    },
  ]

  const invoke = (op: string, input: object) =>
    (caller() as unknown as Record<string, (arg: unknown) => Promise<unknown>>)[op]!(input)

  for (const { name, input, helper } of writes) {
    it(`${name} 404s another member's personal filter, even for an admin`, async () => {
      // `Inboxes: Full` composes write on EVERY inbox and the key is held — the
      // strongest caller in the org still gets not-found (§5.1: no override).
      asAutomationAdmin()

      await expect(invoke(name, input(OTHER_FILTER))).rejects.toMatchObject(GONE)
      expect(helper()).not.toHaveBeenCalled()
      expect(gate).toEqual([])
    })

    it(`${name} 404s a personal mailbox still on the SHARED def`, async () => {
      // The 059→060 window. Keyed on the def alone this row reads as shared and
      // would 403 — naming somebody's private mailbox.
      asAutomationAdmin()

      await expect(invoke(name, input(LEGACY_FILTER))).rejects.toMatchObject(GONE)
      expect(helper()).not.toHaveBeenCalled()
    })

    it(`${name} 404s an id with no row at all`, async () => {
      asAutomationAdmin()

      await expect(invoke(name, input(GONE_FILTER))).rejects.toMatchObject(GONE)
      expect(helper()).not.toHaveBeenCalled()
    })

    it(`${name} 403s a shared-inbox filter the caller may not author on`, async () => {
      // Holds the key, writes to no inbox. The inbox is org inventory the caller
      // can see, so hiding it behind a 404 would be a lie, not a protection.
      world.capabilities.add(AUTOMATION_KEY)

      await expect(invoke(name, input(SHARED_FILTER))).rejects.toMatchObject(FORBIDDEN)
      expect(helper()).not.toHaveBeenCalled()
    })

    it(`${name} succeeds for the owner of the personal filter, with no key`, async () => {
      await invoke(name, input(OWN_FILTER))

      expect(helper()).toHaveBeenCalledTimes(1)
      expect(gate).toEqual([])
    })
  }
})

/** Invariant 15 — server-side rejection, not a hidden catalog entry. */
describe('mailFilters router — keyed escape-hatch actions', () => {
  const keyed = [
    { type: 'run-agent' as const, agentId: 'agt_1', agentTriggerId: 'trg_1' },
    { type: 'run-workflow' as const, workflowAppId: 'wfa_1' },
  ]

  for (const action of keyed) {
    it(`rejects '${action.type}' on create for an unkeyed author, whatever the UI sent`, async () => {
      await expect(
        caller().create({
          inboxId: OWN_PERSONAL,
          name: 'Escalate',
          actions: [...ARCHIVE, action],
        })
      ).rejects.toMatchObject(FORBIDDEN)

      expect(lib.createMailFilter).not.toHaveBeenCalled()
      // Rejected before any limit is consulted — an unkeyed action is not a
      // quota question.
      expect(calls).toEqual([])
    })

    it(`rejects '${action.type}' on update for an unkeyed author`, async () => {
      await expect(
        caller().update({ filterId: OWN_FILTER, actions: [action] })
      ).rejects.toMatchObject(FORBIDDEN)

      expect(lib.updateMailFilter).not.toHaveBeenCalled()
    })
  }

  /**
   * The six unkeyed actions only move mail the author already controls — which
   * is a claim about the DESTINATION as much as about the action type, so the
   * `move-inbox` here targets an inbox this caller may author on. It passing is
   * not evidence that any `move-inbox` passes; the destination gate is pinned
   * separately below.
   */
  it('accepts the mail actions on a personal filter from an unkeyed author', async () => {
    await caller().create({
      inboxId: OWN_PERSONAL,
      name: 'Newsletters',
      actions: [
        { type: 'set-status', status: 'ARCHIVED' },
        { type: 'add-tag', tagIds: ['tag_1'] },
        { type: 'assign', assigneeId: 'usr_1' },
        { type: 'set-read', read: true },
        { type: 'move-inbox', inboxId: OWN_PERSONAL },
        { type: 'suppress-automations' },
      ],
    })

    expect(lib.createMailFilter).toHaveBeenCalledTimes(1)
    expect(gate).toEqual([])
  })

  it('accepts the keyed actions from an author who holds the key', async () => {
    world.capabilities.add(AUTOMATION_KEY)
    world.writableInboxIds.add(SHARED_INBOX)

    await caller().create({
      inboxId: SHARED_INBOX,
      name: 'Escalate',
      actions: keyed,
    })

    expect(lib.createMailFilter).toHaveBeenCalledTimes(1)
  })
})

/**
 * §4.3 / §5.1 — a `move-inbox` DESTINATION is authorized at save time, not only
 * scoped in the dialog's picker.
 *
 * The fire-time existence check in `@auxx/lib/mail-filters/actions` asks whether
 * the inbox exists, which is a different question. Without this gate, any member
 * with a personal mailbox and no permission key can POST `mailFilters.create`
 * with `{ inboxId: <own>, actions: [{ type: 'move-inbox', inboxId: <a
 * colleague's private mailbox> }] }` and hold a standing write into it —
 * invariant 15's failure mode ("hidden in the catalog is not enough"), applied
 * to the destination rather than the action type. §5.1 makes this a SHARING
 * action, so the destination needs authoring authority, not mere existence.
 */
describe('mailFilters router — move-inbox destinations', () => {
  it("refuses a create routing mail into another member's personal mailbox", async () => {
    await expect(
      caller().create({
        inboxId: OWN_PERSONAL,
        name: 'Exfiltrate',
        actions: [{ type: 'move-inbox', inboxId: OTHER_PERSONAL }],
      })
    ).rejects.toMatchObject(FORBIDDEN)

    expect(lib.createMailFilter).not.toHaveBeenCalled()
    // Refused before any counter or plan read, exactly like the other authorization
    // branches — a forbidden destination is not a quota question.
    expect(calls).toEqual([])
  })

  it('refuses an update that adds the same destination', async () => {
    await expect(
      caller().update({
        filterId: OWN_FILTER,
        actions: [{ type: 'move-inbox', inboxId: OTHER_PERSONAL }],
      })
    ).rejects.toMatchObject(FORBIDDEN)

    expect(lib.updateMailFilter).not.toHaveBeenCalled()
  })

  /**
   * An org admin composing `Inboxes: Full` is refused too — there is no OWNER
   * bypass on a personal mailbox, and the destination goes through the SAME
   * `assertCanAuthorMailFilters` the filter's own inbox does, so it inherits that.
   */
  it("refuses an admin routing mail into a member's personal mailbox", async () => {
    asAutomationAdmin()

    await expect(
      caller().create({
        inboxId: SHARED_INBOX,
        name: 'Reroute',
        actions: [{ type: 'move-inbox', inboxId: OTHER_PERSONAL }],
      })
    ).rejects.toMatchObject(FORBIDDEN)

    expect(lib.createMailFilter).not.toHaveBeenCalled()
  })

  /** The positive control: a destination the caller may author on still passes. */
  it('allows a destination inside the caller’s authorable set', async () => {
    world.capabilities.add(AUTOMATION_KEY)
    world.writableInboxIds.add(SHARED_INBOX)

    await caller().create({
      inboxId: SHARED_INBOX,
      name: 'To my mailbox',
      actions: [{ type: 'move-inbox', inboxId: OWN_PERSONAL }],
    })
    await caller().update({
      filterId: OWN_FILTER,
      actions: [{ type: 'move-inbox', inboxId: OWN_PERSONAL }],
    })

    expect(lib.createMailFilter).toHaveBeenCalledTimes(1)
    expect(lib.updateMailFilter).toHaveBeenCalledTimes(1)
    expect(gate).toEqual([])
  })
})

/**
 * The save-time half of the fail-closed rule for conditions the evaluator cannot
 * compile.
 *
 * `condition-query-builder` DROPS what it cannot dispatch, so a filter whose only
 * condition drops compiles to `organizationId = $1 AND mergedIntoThreadId IS
 * NULL` — every thread in the inbox. `Body starts with "Unsubscribe" → Set status
 * Spam` is reachable straight from the shipped dialog and would mark the whole
 * mailbox as spam, with "also apply to existing" backfilling it. The router is
 * where that is refused; `buildFilterPredicate`'s `AND false` bounds the rows
 * written before this existed.
 */
describe('mailFilters router — conditions that do not compile', () => {
  it('rejects a create with a 400, before any counter is read', async () => {
    await expect(
      caller().create({
        inboxId: OWN_PERSONAL,
        name: 'Unsubscribes',
        conditions: UNCOMPILABLE_CONDITIONS,
        actions: [{ type: 'set-status', status: 'SPAM' }],
      })
    ).rejects.toMatchObject(BAD_REQUEST)

    expect(lib.createMailFilter).not.toHaveBeenCalled()
    expect(calls).toEqual(['assertFilterConditionsCompile'])
  })

  it('names the offending field and operator, so the author can fix it', async () => {
    await expect(
      caller().create({
        inboxId: OWN_PERSONAL,
        name: 'Unsubscribes',
        conditions: UNCOMPILABLE_CONDITIONS,
        actions: ARCHIVE,
      })
    ).rejects.toThrow(/Body.*starts with/)
  })

  it('rejects an update that introduces one', async () => {
    await expect(
      caller().update({ filterId: OWN_FILTER, conditions: UNCOMPILABLE_CONDITIONS })
    ).rejects.toMatchObject(BAD_REQUEST)

    expect(lib.updateMailFilter).not.toHaveBeenCalled()
  })

  it('accepts conditions that compile, on both write paths', async () => {
    await caller().create({
      inboxId: OWN_PERSONAL,
      name: 'Unsubscribes',
      conditions: COMPILABLE_CONDITIONS,
      actions: ARCHIVE,
    })
    await caller().update({ filterId: OWN_FILTER, conditions: COMPILABLE_CONDITIONS })

    expect(lib.createMailFilter).toHaveBeenCalledTimes(1)
    expect(lib.updateMailFilter).toHaveBeenCalledTimes(1)
    expect(hoisted.assertFilterConditionsCompile).toHaveBeenCalledTimes(2)
    expect(gate).toEqual([])
  })

  /**
   * An update that touches only the name must not be forced to resend conditions
   * — the gate runs on the value being WRITTEN, and absent means "leave the stored
   * conditions alone".
   *
   * This also pins the patch schema itself: `filterInputSchema.partial()` keeps
   * each field's `.default(...)`, so a rename used to arrive carrying
   * `conditions: []`, `stopProcessing: false` and `enabled: true` — which
   * `updateMailFilter` faithfully wrote, silently converting the filter into
   * "every new message" and switching a disabled one back on.
   */
  it('does not run on an update that omits conditions, and writes no phantom fields', async () => {
    await caller().update({ filterId: OWN_FILTER, name: 'Renamed' })

    expect(hoisted.assertFilterConditionsCompile).not.toHaveBeenCalled()
    expect(lib.updateMailFilter).toHaveBeenCalledWith(expect.anything(), ORG_ID, OWN_FILTER, {
      name: 'Renamed',
    })
  })
})

/** §5.2 / invariant 14 — two ceilings, chosen by the target inbox's definition. */
describe('mailFilters router — the limit gate', () => {
  it('blocks a personal create at the flat per-user cap, never against the plan', async () => {
    world.personalCount = 50

    await expect(
      caller().create({ inboxId: OWN_PERSONAL, name: 'One more', actions: ARCHIVE })
    ).rejects.toMatchObject(FORBIDDEN)

    expect(lib.createMailFilter).not.toHaveBeenCalled()
    expect(lib.countPersonalMailFilters).toHaveBeenCalledWith(expect.anything(), ORG_ID, USER_ID)
    // Personal filters are counted per USER and never pooled into the org
    // allowance — one member must not be able to exhaust the org's cap.
    expect(lib.countBillableMailFilters).not.toHaveBeenCalled()
    expect(calls).not.toContain('requireLimit:mailFiltersLimit')
  })

  it('allows a personal create one slot below the cap', async () => {
    world.personalCount = 49

    await caller().create({ inboxId: OWN_PERSONAL, name: 'One more', actions: ARCHIVE })

    expect(lib.createMailFilter).toHaveBeenCalledTimes(1)
  })

  /**
   * Invariant 14 asks for the ENFORCED value, not the seeded one: an absent
   * `mailFiltersLimit` reads as UNCAPPED, so a gate shipped without the plan
   * backfill fails open and silently.
   */
  it('blocks a shared create at the plan limit, using the billable counter', async () => {
    world.capabilities.add(AUTOMATION_KEY)
    world.writableInboxIds.add(SHARED_INBOX)
    world.planLimit = 5
    world.billableCount = 5

    await expect(
      caller().create({ inboxId: SHARED_INBOX, name: 'Sixth', actions: ARCHIVE })
    ).rejects.toMatchObject(FORBIDDEN)

    expect(lib.createMailFilter).not.toHaveBeenCalled()
    expect(calls).toContain('requireLimit:mailFiltersLimit')
    expect(lib.countBillableMailFilters).toHaveBeenCalledTimes(1)
    // Shared-inbox filters are org inventory; the per-user cap is irrelevant.
    expect(lib.countPersonalMailFilters).not.toHaveBeenCalled()
  })

  it('allows a shared create one slot below the plan limit', async () => {
    world.capabilities.add(AUTOMATION_KEY)
    world.writableInboxIds.add(SHARED_INBOX)
    world.planLimit = 5
    world.billableCount = 4

    await caller().create({ inboxId: SHARED_INBOX, name: 'Fifth', actions: ARCHIVE })

    expect(lib.createMailFilter).toHaveBeenCalledTimes(1)
  })
})

/**
 * §6.3 / D9 — the thread header's "Filtered by *Newsletters*" chips.
 *
 * A SECOND read path onto `MailFilterRun`, and the one that matters most for
 * invariant 11: a run row carries the filter's NAME, so an unscoped version
 * would name a colleague's personal-mailbox filter to any admin who can open the
 * thread — exactly what §5.1 keeps private, leaked through a surface that is not
 * the filters list.
 */
describe('mailFilters router — threadRuns', () => {
  it("never shows an admin a run fired by another member's personal filter", async () => {
    asAutomationAdmin()

    const result = await caller().threadRuns({ threadId: THREAD_ID })

    // Same thread, three runs; only the one whose filter the caller may author on.
    expect(result.map((run) => run.id)).toEqual([RUN_OWN])
    expect(result.map((run) => run.id)).not.toContain(RUN_OTHER)
    // The scope is the caller's authorable set, applied to the FILTER lookup —
    // never the thread's inbox, and never post-read over the whole org.
    expect(lib.listMailFilters).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      expect.objectContaining({ inboxIds: expect.not.arrayContaining([OTHER_PERSONAL]) })
    )
    expect(gate).toEqual([])
  })

  it('names the surviving run, so the chip has something to render', async () => {
    asAutomationAdmin()

    const [run] = await caller().threadRuns({ threadId: THREAD_ID })

    expect(run).toMatchObject({ id: RUN_OWN, filterId: OWN_FILTER, filterName: OWN_FILTER })
  })

  /**
   * `MailFilterRun.filterId` carries no FK on purpose, so orphan rows exist by
   * design. They are dropped rather than rendered nameless: the filter's inbox is
   * a run's only recorded authority, so a run without one cannot be authorized —
   * and `undoRun` 404s it for the same reason (pinned below).
   */
  it('drops a run whose filter has since been deleted', async () => {
    asAutomationAdmin()

    const result = await caller().threadRuns({ threadId: THREAD_ID })

    expect(result.map((run) => run.id)).not.toContain(RUN_ORPHAN)
    expect(result.every((run) => run.filterName.length > 0)).toBe(true)
  })

  /**
   * ⚠️ ACTUAL BEHAVIOUR: an unauthorized caller gets `[]`, it does not throw.
   *
   * That is the right call for this path specifically — the chips are rendered
   * inline on every thread header, so "no chips" is the honest answer and a throw
   * would paint an error banner on a page the caller is entitled to see. It also
   * cannot be used as an existence oracle, because the empty answer is
   * indistinguishable from "no filter ever fired here".
   */
  it('returns [] — never throws — for a caller who owns no authorable inbox', async () => {
    world.capabilities.add(AUTOMATION_KEY)

    await expect(caller(STRANGER_ID).threadRuns({ threadId: THREAD_ID })).resolves.toEqual([])
    // Short-circuited before the read: the empty allow-list must not fall through
    // to an unscoped query.
    expect(lib.listMailFilterRunsForThread).not.toHaveBeenCalled()
    expect(lib.listMailFilters).not.toHaveBeenCalled()
  })

  it('returns [] for a thread only somebody else’s filter ever touched', async () => {
    // A caller WITH an authorable inbox, so this exercises the scoping drop
    // rather than the empty-set short circuit above.
    const result = await caller().threadRuns({ threadId: FOREIGN_THREAD })

    expect(result).toEqual([])
    expect(lib.listMailFilterRunsForThread).toHaveBeenCalledTimes(1)
    expect(gate).toEqual([])
  })
})

/** §6.3 — Undo, authorized on the filter's inbox through the same helper. */
describe('mailFilters router — undoRun', () => {
  it("404s a run fired by another member's personal filter, never 403s", async () => {
    asAutomationAdmin()

    await expect(caller().undoRun({ runId: RUN_OTHER })).rejects.toMatchObject(NOT_FOUND)
    expect(lib.undoMailFilterRun).not.toHaveBeenCalled()
    expect(gate).toEqual([])
  })

  /**
   * A deleted filter leaves its runs behind (no FK). The filter's inbox is the
   * only recorded authority for a run, and guessing one from the thread's CURRENT
   * inbox would let a `move-inbox` firing decide who may reverse it — so this is
   * a 404, not a best-effort reversal.
   */
  it('404s a run whose filter was deleted', async () => {
    asAutomationAdmin()

    await expect(caller().undoRun({ runId: RUN_ORPHAN })).rejects.toMatchObject(NOT_FOUND)
    expect(lib.undoMailFilterRun).not.toHaveBeenCalled()
  })

  it('404s an unknown run id', async () => {
    asAutomationAdmin()

    await expect(caller().undoRun({ runId: 'mfr_nope0000000000000000000' })).rejects.toMatchObject(
      NOT_FOUND
    )
    expect(lib.undoMailFilterRun).not.toHaveBeenCalled()
  })

  /**
   * The claim row is inserted BEFORE execution and `undo` is written by the
   * post-execution UPDATE (§3), so a run that died mid-execution legitimately has
   * a `status` and a NULL blob — the one case where the thread most likely DID
   * change and we cannot say how.
   *
   * That must reach the client as a 422, not as a silent `{ undone: true }`:
   * reporting success would tell the user their mail was restored when it was
   * not. The router re-throws `result.error` bare, so this also pins that the
   * status survives the trip (a causeless re-wrap would flatten it to 500).
   */
  it('surfaces the 422 for a run with a NULL undo blob, not a silent success', async () => {
    await expect(caller().undoRun({ runId: RUN_NO_UNDO })).rejects.toMatchObject(UNPROCESSABLE)
    expect(lib.undoMailFilterRun).toHaveBeenCalledTimes(1)
  })

  /** A second Undo click is a double-click, not a fault. */
  it('is a no-op once undoneAt is set', async () => {
    await expect(caller().undoRun({ runId: RUN_UNDONE })).resolves.toMatchObject({ undone: false })
  })

  it('reverses a run on the caller’s own personal filter', async () => {
    await expect(caller().undoRun({ runId: RUN_OWN })).resolves.toMatchObject({ undone: true })
    expect(lib.undoMailFilterRun).toHaveBeenCalledTimes(1)
    expect(gate).toEqual([])
  })
})

/** §6.5 / §7 — the preview count and the retroactive apply. */
describe('mailFilters router — previewMatchCount', () => {
  it('leaks no count for an inbox the caller may not author on', async () => {
    // Inbox write WITHOUT the key — the shared branch needs both.
    world.writableInboxIds.add(SHARED_INBOX)

    await expect(
      caller().previewMatchCount({ inboxId: SHARED_INBOX, conditions: [] })
    ).rejects.toMatchObject(FORBIDDEN)

    expect(lib.previewMatchCount).not.toHaveBeenCalled()
    // Authorize BEFORE resolving the viewer — nothing is read on the way to the
    // refusal, so the denial costs no query and discloses no timing.
    expect(calls).toEqual([])
  })

  it("leaks no count for another member's personal mailbox, even to an admin", async () => {
    asAutomationAdmin()

    await expect(
      caller().previewMatchCount({ inboxId: OTHER_PERSONAL, conditions: [] })
    ).rejects.toMatchObject(FORBIDDEN)

    expect(lib.previewMatchCount).not.toHaveBeenCalled()
  })

  it('counts under the REQUESTING user’s viewer on an authorable inbox', async () => {
    const result = await caller().previewMatchCount({ inboxId: OWN_PERSONAL, conditions: [] })

    expect(result).toMatchObject({ count: 7, lowerBound: true })
    // The preview must not count threads the author cannot see, so the viewer is
    // the caller's grants — never SYSTEM.
    expect(hoisted.getCachedUserInstanceGrants).toHaveBeenCalledWith(USER_ID, ORG_ID)
    expect(gate).toEqual([])
  })
})

describe('mailFilters router — applyRetroactively', () => {
  it('re-asserts on the filter’s own inbox and enqueues nothing when it fails', async () => {
    // Holds the key but has lost inbox write since the filter was created.
    world.capabilities.add(AUTOMATION_KEY)

    await expect(caller().applyRetroactively({ filterId: SHARED_FILTER })).rejects.toMatchObject(
      FORBIDDEN
    )

    expect(lib.applyRetroactively).not.toHaveBeenCalled()
    // Authorization runs before the backfillable check — the largest mutation
    // this feature performs never even reads the filter's eligibility first.
    expect(lib.loadBackfillableFilter).not.toHaveBeenCalled()
  })

  /** V6 — 404, so the largest mutation the feature has is not an existence oracle. */
  it("refuses another member's personal filter", async () => {
    asAutomationAdmin()

    await expect(caller().applyRetroactively({ filterId: OTHER_FILTER })).rejects.toMatchObject(
      NOT_FOUND
    )
    expect(lib.applyRetroactively).not.toHaveBeenCalled()
  })

  /** A disabled filter is OFF — a backfill never runs for a rule switched off. */
  it('rejects a disabled filter with a 400 and enqueues nothing', async () => {
    world.disabledFilterIds.add(OWN_FILTER)

    await expect(caller().applyRetroactively({ filterId: OWN_FILTER })).rejects.toMatchObject(
      BAD_REQUEST
    )

    expect(lib.loadBackfillableFilter).toHaveBeenCalledTimes(1)
    expect(lib.applyRetroactively).not.toHaveBeenCalled()
  })

  it('enqueues the paged backfill for an authorable, enabled filter', async () => {
    const result = await caller().applyRetroactively({ filterId: OWN_FILTER })

    expect(result).toEqual({ enqueued: true, inboxId: OWN_PERSONAL })
    expect(lib.applyRetroactively).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      filterId: OWN_FILTER,
      requestedByUserId: USER_ID,
    })
    expect(gate).toEqual([])
  })
})

/**
 * D18 — the post-connect prompt. `access: 'user'` in the settings catalog, so one
 * member waving it away must never hide it from the colleague who would have said
 * yes.
 */
describe('mailFilters router — the retroactive prompt is per-user', () => {
  beforeEach(() => {
    world.capabilities.add(AUTOMATION_KEY)
    world.writableInboxIds.add(SHARED_INBOX)
    world.promptInboxIds.add(SHARED_INBOX)
  })

  it("does not hide one member's prompt when another dismisses it", async () => {
    expect(await caller(USER_ID).pendingRetroactivePrompt()).toMatchObject({
      inboxId: SHARED_INBOX,
      inboxName: SHARED_INBOX,
      filterCount: 1,
    })

    await caller(USER_ID).dismissRetroactivePrompt({ inboxId: SHARED_INBOX })

    expect(await caller(USER_ID).pendingRetroactivePrompt()).toBeNull()
    // The colleague's prompt is untouched — this is the whole point of `access: 'user'`.
    expect(await caller(OTHER_USER_ID).pendingRetroactivePrompt()).toMatchObject({
      inboxId: SHARED_INBOX,
    })
  })

  it('writes and reads the dismissal against the CALLER’s user id', async () => {
    await caller(USER_ID).dismissRetroactivePrompt({ inboxId: SHARED_INBOX })

    expect(hoisted.updateUserSetting).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        organizationId: ORG_ID,
        key: 'mailFilters.retroactivePromptDismissed',
        value: [SHARED_INBOX],
      })
    )
    expect(hoisted.getUserSetting).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, key: 'mailFilters.retroactivePromptDismissed' })
    )
  })

  it('is idempotent — a second dismissal writes nothing', async () => {
    await caller(USER_ID).dismissRetroactivePrompt({ inboxId: SHARED_INBOX })
    expect(hoisted.updateUserSetting).toHaveBeenCalledTimes(1)

    await caller(USER_ID).dismissRetroactivePrompt({ inboxId: SHARED_INBOX })
    expect(hoisted.updateUserSetting).toHaveBeenCalledTimes(1)
  })

  it('refuses a dismissal for an inbox the caller may not author on', async () => {
    await expect(
      caller(USER_ID).dismissRetroactivePrompt({ inboxId: OTHER_PERSONAL })
    ).rejects.toMatchObject(FORBIDDEN)

    expect(hoisted.updateUserSetting).not.toHaveBeenCalled()
    expect(gate).toEqual([])
  })

  it('never offers a prompt for an inbox outside the caller’s authorable set', async () => {
    await caller(USER_ID).pendingRetroactivePrompt()

    expect(lib.findPendingRetroactivePrompt).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      expect.not.arrayContaining([OTHER_PERSONAL, LEGACY_PERSONAL])
    )
  })

  it('answers null without touching settings for a caller who owns no inbox', async () => {
    // No key and no inbox write — an empty authorable set, not merely an empty
    // candidate list.
    world.capabilities.clear()
    world.writableInboxIds.clear()

    expect(await caller(STRANGER_ID).pendingRetroactivePrompt()).toBeNull()

    expect(hoisted.getUserSetting).not.toHaveBeenCalled()
    expect(lib.findPendingRetroactivePrompt).not.toHaveBeenCalled()
  })
})
