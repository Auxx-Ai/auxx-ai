// apps/web/src/server/api/routers/mail-classification.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The mail-classification opt-in's authorization model, through a real tRPC caller.
 *
 * ## Why this file is mandatory
 *
 * The router IS the gate (`plans/mail-filter/05-mail-classification-plan.md`
 * §5, invariant 11). `@auxx/lib` holds zero permission checks, the org-settings
 * write itself is a plain jsonb upsert, and the UI only decides what to render
 * — so every rule about who may point a classifier at whose mailbox lives here
 * and nowhere else.
 *
 * The four cases §5 names, verbatim:
 *
 *  1. the owner of a personal inbox, holding NO permission key, may toggle it
 *  2. another member's personal inbox is **404** — even for an admin holding
 *     everything (a 403 there is an existence oracle for a private mailbox)
 *  3. a shared inbox with `automationRules.manage` but no inbox `admin` is 403
 *  4. with both, it succeeds
 *
 * plus the invariant that makes per-inbox storage worth having: **an admin
 * cannot opt in a personal mailbox**, by any route — including the generic
 * `settings.updateOrganizationSetting` door, which is why `setting.ts` refuses
 * this key outright.
 *
 * Denials assert STATUS CODES (`cause.statusCode`), never merely "it threw":
 * a 403 where a 404 belongs is exactly the leak, and it survives any weaker
 * assertion.
 */

const AUTOMATION_KEY = 'automationRules.manage'
const SETTING_KEY = 'mailClassificationInboxIds'

const hoisted = vi.hoisted(() => {
  const ORG_ID = 'org_cuid000000000000000000000'
  const USER_ID = 'usr_member00000000000000000'
  const OTHER_USER_ID = 'usr_other000000000000000000'

  /** A shared mailbox on the `inbox` def. */
  const SHARED_INBOX = 'inb_shared00000000000000000'
  /** The caller's own mailbox on the `personal_inbox` def. */
  const OWN_PERSONAL = 'inb_ownpersonal000000000000'
  /** Somebody else's mailbox on the `personal_inbox` def. */
  const OTHER_PERSONAL = 'inb_otherpersonal0000000000'
  /** A personal mailbox still on the SHARED def — the 059→060 migration window. */
  const LEGACY_PERSONAL = 'inb_legacypersonal000000000'
  /** No such inbox in this org at all. */
  const GHOST_INBOX = 'inb_ghost000000000000000000'

  const world = {
    /** Layer-2 capability keys the caller holds. EMPTY is the interesting case. */
    capabilities: new Set<string>(),
    /** Inbox ids the caller composes `edit`+ (i.e. `admin`) on. */
    writableInboxIds: new Set<string>(),
    /** Tags as `TagService.getAllTags({ scope: 'thread' })` would answer. */
    threadTags: [] as { id: string; aiClassify: boolean }[],
    /** `QuotaService.getQuotaStatus()` — null models an org with no quota row. */
    quotaStatus: null as { isExceeded: boolean } | null,
    /** What `countReclassifiableThreads` answers (07 §2.5). */
    reclassifyCount: { count: 412, capped: false, cap: 5000, eligibleTagCount: 4 } as {
      count: number
      capped: boolean
      cap: number
      eligibleTagCount: number
    },
    /** Set to make the shared count query refuse (not opted in / no tags). */
    reclassifyCountError: null as string | null,
    /** The org's default LLM, or null for "none configured". */
    defaultModel: { provider: 'openai', model: 'gpt-test' } as {
      provider: string
      model: string
    } | null,
    /** `ProviderRegistry.getModelCapabilities(...)`.costPer1kTokens, or null. */
    modelPrice: { input: 0.001, output: 0.004 } as { input: number; output: number } | null,
    /** SYSTEM draws credits; CUSTOM is the org's own key and is never metered. */
    providerType: 'SYSTEM' as 'SYSTEM' | 'CUSTOM',
    /** The eligible labels, whose title+description length the estimate counts. */
    eligibleLabels: [
      { tagId: 't1', title: 'Sales', description: 'x'.repeat(120) },
      { tagId: 't2', title: 'Support', description: 'x'.repeat(120) },
    ] as { tagId: string; title: string; description: string | null }[],
    /** Rows the `SYNCING` existence check finds (07 R-Q8). */
    syncingRows: [] as unknown[],
    /** What `getMailReclassifySampleStatus` answers. */
    sampleStatus: null as unknown,
  }

  /** Every side effect the router reached, in order. */
  const calls: string[] = []
  /** Capability keys `permissionProcedure` asserted, in order. */
  const gate: string[] = []

  /** The `OrganizationSetting` row, as a value. */
  const orgSettings = new Map<string, unknown>()

  const getOrganizationSetting = vi.fn(async (params: { organizationId: string; key: string }) => {
    calls.push('getOrganizationSetting')
    return orgSettings.get(`${params.organizationId}:${params.key}`) ?? []
  })
  const updateOrganizationSetting = vi.fn(
    async (params: { organizationId: string; key: string; value: unknown }) => {
      calls.push('updateOrganizationSetting')
      orgSettings.set(`${params.organizationId}:${params.key}`, params.value)
    }
  )

  const onCacheEvent = vi.fn(async (event: string) => {
    calls.push(`onCacheEvent:${event}`)
  })

  const getCredentials = vi.fn(async () => {
    calls.push('getCredentials')
    return { providerType: world.providerType, credentialSource: world.providerType }
  })

  const getEligibleClassificationTags = vi.fn(async () => {
    calls.push('getEligibleClassificationTags')
    return world.eligibleLabels
  })

  const recordAuditFromCtx = vi.fn(async () => {
    calls.push('recordAuditFromCtx')
  })

  /**
   * A stand-in for `TagService`, faithful in the one respect this router
   * depends on: `getAllTags` takes the `thread` scope filter (Q3 — `article`
   * tags are never offered to a mail classifier) and the eligibility flag is
   * `aiClassify`.
   */
  /**
   * A stand-in for `QuotaService`. The card reads LIVE credit state rather than
   * a stored failure record, so the only thing this needs to model is
   * `isExceeded` — including the `null` an org with no quota row returns.
   */
  class QuotaService {
    constructor(
      public db: unknown,
      public organizationId: string
    ) {}
    async getQuotaStatus() {
      calls.push('getQuotaStatus')
      return world.quotaStatus
    }
  }

  class TagService {
    constructor(
      public organizationId: string,
      public userId: string,
      public db: unknown
    ) {}
    async getAllTags(options?: { scope?: string }) {
      calls.push(`getAllTags:${options?.scope ?? 'all'}`)
      return world.threadTags
    }
  }

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

  /**
   * `@auxx/lib/mail-classification`, faithful in the one respect this router
   * depends on: everything returns a `neverthrow` Result, and the count is the
   * SAME function the sample run pages over (07 invariant 10) — so the arguments
   * the router passes it are the assertion worth making.
   */
  /**
   * A `neverthrow` Result, duck-typed. The router only ever asks `isErr()` and
   * reads `.value` / `.error`, and building the real thing here would drag the
   * library into a file whose whole point is the router's own behaviour.
   */
  const okResult = <T>(value: T) => ({ isErr: () => false as const, value })
  const errResult = (message: string) => {
    const error = new Error(message)
    ;(error as Error & { statusCode: number }).statusCode = 400
    return { isErr: () => true as const, error }
  }

  const countReclassifiableThreads = vi.fn(async (_db: unknown, input: Record<string, unknown>) => {
    calls.push(`countReclassifiableThreads:${JSON.stringify(input)}`)
    if (world.reclassifyCountError) return errResult(world.reclassifyCountError)
    return okResult({ ...world.reclassifyCount, mode: input.mode })
  })

  const enqueueMailReclassifySample = vi.fn(async (input: Record<string, unknown>) => {
    calls.push(`enqueueMailReclassifySample:${JSON.stringify(input)}`)
    return okResult({ jobId: 'job_sample', deduplicated: false })
  })

  const getMailReclassifySampleStatus = vi.fn(async () => {
    calls.push('getMailReclassifySampleStatus')
    return world.sampleStatus
  })

  const cancelMailReclassifySample = vi.fn(async () => {
    calls.push('cancelMailReclassifySample')
    return true
  })

  /** The org's default LLM — resolved live, exactly like the classifier does. */
  class SystemModelService {
    constructor(
      public db: unknown,
      public organizationId: string
    ) {}
    async getDefault() {
      calls.push('getDefaultModel')
      return world.defaultModel
    }
  }

  const ProviderRegistry = {
    getModelCapabilities: (model: string) => {
      calls.push(`getModelCapabilities:${model}`)
      return world.modelPrice ? { costPer1kTokens: world.modelPrice } : null
    },
  }

  const orgCacheGet = vi.fn(async (_orgId: string, key: string) => {
    if (key !== 'inboxes') throw new Error(`unexpected org-cache key ${key}`)
    return inboxes
  })

  return {
    ORG_ID,
    USER_ID,
    OTHER_USER_ID,
    SHARED_INBOX,
    OWN_PERSONAL,
    OTHER_PERSONAL,
    LEGACY_PERSONAL,
    GHOST_INBOX,
    world,
    calls,
    gate,
    orgSettings,
    orgCacheGet,
    onCacheEvent,
    getOrganizationSetting,
    updateOrganizationSetting,
    recordAuditFromCtx,
    getCredentials,
    getEligibleClassificationTags,
    TagService,
    QuotaService,
    countReclassifiableThreads,
    enqueueMailReclassifySample,
    getMailReclassifySampleStatus,
    cancelMailReclassifySample,
    SystemModelService,
    ProviderRegistry,
  }
})

const {
  ORG_ID,
  USER_ID,
  SHARED_INBOX,
  OWN_PERSONAL,
  OTHER_PERSONAL,
  LEGACY_PERSONAL,
  GHOST_INBOX,
  world,
  calls,
  gate,
} = hoisted

vi.mock('@auxx/lib/cache', () => ({
  getOrgCache: () => ({ get: hoisted.orgCacheGet }),
  onCacheEvent: hoisted.onCacheEvent,
}))
vi.mock('@auxx/lib/settings', () => ({
  getOrganizationSetting: hoisted.getOrganizationSetting,
  updateOrganizationSetting: hoisted.updateOrganizationSetting,
}))
vi.mock('@auxx/lib/tags', () => ({ TagService: hoisted.TagService }))
vi.mock('@auxx/lib/ai', () => ({
  QuotaService: hoisted.QuotaService,
  SystemModelService: hoisted.SystemModelService,
  ProviderRegistry: hoisted.ProviderRegistry,
  getCredentials: hoisted.getCredentials,
}))
// The estimate counts the REAL label list rather than assuming a size, so this
// has to answer or the per-thread cost is understated as the vocabulary grows.
vi.mock('@auxx/lib/mail-classification/labels', () => ({
  getEligibleClassificationTags: hoisted.getEligibleClassificationTags,
}))
// ⚠️ `ModelType` is NOT mocked: the `@auxx/lib/ai` barrel re-exports it as a
// TYPE, so the router deep-imports the real enum and this pins that the value it
// asks for is a real member rather than a string this file made up.
vi.mock('@auxx/lib/mail-classification', () => ({
  countReclassifiableThreads: hoisted.countReclassifiableThreads,
  enqueueMailReclassifySample: hoisted.enqueueMailReclassifySample,
  getMailReclassifySampleStatus: hoisted.getMailReclassifySampleStatus,
  cancelMailReclassifySample: hoisted.cancelMailReclassifySample,
}))
vi.mock('~/server/api/audit-context', () => ({
  recordAuditFromCtx: hoisted.recordAuditFromCtx,
}))

/**
 * The permissions BARREL is mocked (it hangs under vitest — the standing
 * gotcha), but `@auxx/lib/permissions/capabilities/registry` is NOT: the
 * authorization helper reads the real `PermissionKey.automationRulesManage`, so
 * the key's spelling is pinned against the registry rather than restated here.
 */
vi.mock('@auxx/lib/permissions', () => ({}))

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

const { mailClassificationRouter } = await import('./mail-classification')

/**
 * `db.execute` backs ONE query in this router: the 07 R-Q8 "is a channel routed
 * to this inbox mid-backfill" existence check. Rows present ⇒ syncing.
 */
const execute = vi.fn(async () => ({ rows: world.syncingRows }))

const caller = (userId: string = USER_ID) =>
  mailClassificationRouter.createCaller({
    db: { execute },
    session: { userId, organizationId: ORG_ID, user: { id: userId } },
    capabilities: {
      can: (key: string) => world.capabilities.has(key),
      canEditInstance: (key: string, instanceId: string) =>
        key === 'inbox' && world.writableInboxIds.has(instanceId),
    },
  } as never)

/** The shape `auxxErrorMiddleware` maps to a 403 / 404. */
const FORBIDDEN = { cause: { statusCode: 403 } }
const NOT_FOUND = { cause: { statusCode: 404 } }

/** An org admin composing `Inboxes: Full` — write on EVERY inbox, plus the key. */
const asAutomationAdmin = () => {
  world.capabilities.add(AUTOMATION_KEY)
  world.writableInboxIds.add(SHARED_INBOX)
  world.writableInboxIds.add(OWN_PERSONAL)
  world.writableInboxIds.add(OTHER_PERSONAL)
  world.writableInboxIds.add(LEGACY_PERSONAL)
}

const storedInboxIds = () => hoisted.orgSettings.get(`${ORG_ID}:${SETTING_KEY}`)

beforeEach(() => {
  world.capabilities.clear()
  world.writableInboxIds.clear()
  world.threadTags = [
    { id: 'tag_billing', aiClassify: true },
    { id: 'tag_vip', aiClassify: false },
  ]
  world.quotaStatus = { isExceeded: false }
  world.reclassifyCount = { count: 412, capped: false, cap: 5000, eligibleTagCount: 4 }
  world.reclassifyCountError = null
  world.defaultModel = { provider: 'openai', model: 'gpt-test' }
  world.modelPrice = { input: 0.001, output: 0.004 }
  world.providerType = 'SYSTEM'
  world.eligibleLabels = [
    { tagId: 't1', title: 'Sales', description: 'x'.repeat(120) },
    { tagId: 't2', title: 'Support', description: 'x'.repeat(120) },
  ]
  world.syncingRows = []
  world.sampleStatus = null
  hoisted.orgSettings.clear()
  vi.clearAllMocks()
  calls.length = 0
  gate.length = 0
})

describe('mailClassification router — §5 authorship', () => {
  /** Case 1 — ownership alone, no permission key at all. */
  it('lets the owner of a personal inbox toggle it with zero permission keys', async () => {
    expect(await caller().setInboxEnabled({ inboxId: OWN_PERSONAL, enabled: true })).toEqual({
      enabled: true,
    })

    expect(storedInboxIds()).toEqual([OWN_PERSONAL])
    expect(await caller().getInboxSettings({ inboxId: OWN_PERSONAL })).toMatchObject({
      enabled: true,
    })
    // No procedure-level key gate — the archetypal user holds no automation grant.
    expect(gate).toEqual([])
  })

  it('lets the same owner turn it back off', async () => {
    await caller().setInboxEnabled({ inboxId: OWN_PERSONAL, enabled: true })
    await caller().setInboxEnabled({ inboxId: OWN_PERSONAL, enabled: false })

    expect(storedInboxIds()).toEqual([])
    expect(await caller().getInboxSettings({ inboxId: OWN_PERSONAL })).toMatchObject({
      enabled: false,
    })
  })

  /**
   * Case 2 — the one that must be 404, not 403.
   *
   * "A personal mailbox must never be opted in by an admin" (§5), and the
   * refusal must not even confirm the mailbox exists.
   */
  it("answers 404 — never 403 — for another member's personal inbox, to a full admin", async () => {
    asAutomationAdmin()

    await expect(
      caller().setInboxEnabled({ inboxId: OTHER_PERSONAL, enabled: true })
    ).rejects.toMatchObject(NOT_FOUND)
    await expect(caller().getInboxSettings({ inboxId: OTHER_PERSONAL })).rejects.toMatchObject(
      NOT_FOUND
    )

    expect(hoisted.updateOrganizationSetting).not.toHaveBeenCalled()
    // Refused before anything was read — authorize first.
    expect(calls).toEqual([])
  })

  /**
   * Same refusal for the 059→060 migration-window mailbox: SHARED def, personal
   * marker, somebody else's. A refusal keyed on the def alone would name it.
   */
  it('answers 404 for a personal mailbox still sitting on the shared definition', async () => {
    asAutomationAdmin()

    await expect(
      caller().setInboxEnabled({ inboxId: LEGACY_PERSONAL, enabled: true })
    ).rejects.toMatchObject(NOT_FOUND)
  })

  /** An id with no row is indistinguishable from a private one. */
  it('answers 404 for an inbox id that does not exist', async () => {
    asAutomationAdmin()

    await expect(
      caller().setInboxEnabled({ inboxId: GHOST_INBOX, enabled: true })
    ).rejects.toMatchObject(NOT_FOUND)
  })

  /** Case 3 — the key without inbox `admin`. Visible inventory, so 403. */
  it('answers 403 on a shared inbox to a key holder with no inbox admin', async () => {
    world.capabilities.add(AUTOMATION_KEY)

    await expect(
      caller().setInboxEnabled({ inboxId: SHARED_INBOX, enabled: true })
    ).rejects.toMatchObject(FORBIDDEN)
    await expect(caller().getInboxSettings({ inboxId: SHARED_INBOX })).rejects.toMatchObject(
      FORBIDDEN
    )

    expect(hoisted.updateOrganizationSetting).not.toHaveBeenCalled()
  })

  /** …and the mirror: inbox `admin` without the key is equally refused. */
  it('answers 403 on a shared inbox to an inbox admin with no automation key', async () => {
    world.writableInboxIds.add(SHARED_INBOX)

    await expect(
      caller().setInboxEnabled({ inboxId: SHARED_INBOX, enabled: true })
    ).rejects.toMatchObject(FORBIDDEN)
  })

  /** Case 4 — both halves. */
  it('allows a shared inbox to a caller holding the key AND inbox admin', async () => {
    world.capabilities.add(AUTOMATION_KEY)
    world.writableInboxIds.add(SHARED_INBOX)

    expect(await caller().setInboxEnabled({ inboxId: SHARED_INBOX, enabled: true })).toEqual({
      enabled: true,
    })
    expect(storedInboxIds()).toEqual([SHARED_INBOX])
  })
})

describe('mailClassification router — the stored list', () => {
  it('writes ONE inbox id per call and leaves the others alone', async () => {
    world.capabilities.add(AUTOMATION_KEY)
    world.writableInboxIds.add(SHARED_INBOX)

    await caller().setInboxEnabled({ inboxId: SHARED_INBOX, enabled: true })
    await caller().setInboxEnabled({ inboxId: OWN_PERSONAL, enabled: true })
    await caller().setInboxEnabled({ inboxId: SHARED_INBOX, enabled: false })

    expect(storedInboxIds()).toEqual([OWN_PERSONAL])
  })

  it('never writes the same inbox twice', async () => {
    await caller().setInboxEnabled({ inboxId: OWN_PERSONAL, enabled: true })
    await caller().setInboxEnabled({ inboxId: OWN_PERSONAL, enabled: true })

    expect(storedInboxIds()).toEqual([OWN_PERSONAL])
    expect(hoisted.updateOrganizationSetting).toHaveBeenCalledTimes(1)
  })

  it('busts the org-settings cache after a real write, so the guard sees it', async () => {
    await caller().setInboxEnabled({ inboxId: OWN_PERSONAL, enabled: true })

    expect(hoisted.onCacheEvent).toHaveBeenCalledWith('org.settings.changed', {
      orgId: ORG_ID,
      broadcastUserKeys: true,
    })
    expect(hoisted.recordAuditFromCtx).toHaveBeenCalled()
  })

  it('does not bust the cache or audit when nothing changed', async () => {
    await caller().setInboxEnabled({ inboxId: OWN_PERSONAL, enabled: false })

    expect(hoisted.updateOrganizationSetting).not.toHaveBeenCalled()
    expect(hoisted.onCacheEvent).not.toHaveBeenCalled()
    expect(hoisted.recordAuditFromCtx).not.toHaveBeenCalled()
  })

  it('survives a garbage stored value rather than throwing', async () => {
    hoisted.orgSettings.set(`${ORG_ID}:${SETTING_KEY}`, { nope: true })

    expect(await caller().getInboxSettings({ inboxId: OWN_PERSONAL })).toMatchObject({
      enabled: false,
    })
  })
})

describe('mailClassification router — eligible tags', () => {
  it('counts only AI-eligible thread tags', async () => {
    world.threadTags = [
      { id: 'a', aiClassify: true },
      { id: 'b', aiClassify: true },
      { id: 'c', aiClassify: false },
    ]

    expect(await caller().getInboxSettings({ inboxId: OWN_PERSONAL })).toMatchObject({
      eligibleTagCount: 2,
    })
    // Q3 — `article`-scoped tags are never offered to a mail classifier.
    expect(calls).toContain('getAllTags:thread')
  })

  it('reports zero when no tag is eligible — the UI disables the switch on this', async () => {
    world.threadTags = [{ id: 'a', aiClassify: false }]

    expect(await caller().getInboxSettings({ inboxId: OWN_PERSONAL })).toMatchObject({
      eligibleTagCount: 0,
    })
  })
})

/**
 * The classifier runs in the background, so an exhausted balance stops it
 * silently — no dialog, no toast, nothing failing in front of anyone. This card
 * is the only place that silence gets broken.
 */
describe('mailClassification router — credit exhaustion', () => {
  it('reports an exhausted balance so the card can say classification is paused', async () => {
    world.quotaStatus = { isExceeded: true }

    expect(await caller().getInboxSettings({ inboxId: OWN_PERSONAL })).toMatchObject({
      creditsExhausted: true,
    })
  })

  it('reports false while credits remain', async () => {
    world.quotaStatus = { isExceeded: false }

    expect(await caller().getInboxSettings({ inboxId: OWN_PERSONAL })).toMatchObject({
      creditsExhausted: false,
    })
  })

  it('an org with no quota row is not "exhausted" — that gate fails open', async () => {
    // `QuotaService.getQuotaStatus` returns null when the org has no row, and
    // `enforceQuotaGate` lets those calls THROUGH. Reporting exhaustion here
    // would accuse the org of a block that is not happening.
    world.quotaStatus = null

    expect(await caller().getInboxSettings({ inboxId: OWN_PERSONAL })).toMatchObject({
      creditsExhausted: false,
    })
  })

  /**
   * Arming an inbox with nothing to apply is inert (C8's double guard), not an
   * error: refusing would make the order of operations load-bearing. The UI
   * says so; the server does not litigate it.
   */
  it('still allows opting in with zero eligible tags', async () => {
    world.threadTags = []

    await expect(
      caller().setInboxEnabled({ inboxId: OWN_PERSONAL, enabled: true })
    ).resolves.toEqual({ enabled: true })
  })
})

/**
 * Retroactive re-classification (`plans/mail-filter/07-mail-reclassification-plan.md`).
 *
 * A bulk run bills the org and reads colleagues' mail, so 07 §2.4 (axis 3) gives
 * it **the same gate as the opt-in** and no looser one — never admin rank. That
 * is the first thing asserted here, across every procedure, because a read that
 * counted a private mailbox's backlog would be the same disclosure as answering
 * "not opted in" for it.
 */
const SCOPE = { range: { kind: 'days', days: 30 }, mode: 'fill-gaps' } as const

describe('mailClassification router — the retroactive gate (07 §2.4)', () => {
  it("answers 404 for another member's personal inbox on every retroactive procedure", async () => {
    asAutomationAdmin()

    await expect(caller().getBacklog({ inboxId: OTHER_PERSONAL })).rejects.toMatchObject(NOT_FOUND)
    await expect(
      caller().getReclassifyPreview({ inboxId: OTHER_PERSONAL, ...SCOPE })
    ).rejects.toMatchObject(NOT_FOUND)
    await expect(
      caller().startReclassifySample({ inboxId: OTHER_PERSONAL, ...SCOPE })
    ).rejects.toMatchObject(NOT_FOUND)
    await expect(
      caller().getReclassifySampleStatus({ inboxId: OTHER_PERSONAL })
    ).rejects.toMatchObject(NOT_FOUND)
    await expect(
      caller().cancelReclassifySample({ inboxId: OTHER_PERSONAL })
    ).rejects.toMatchObject(NOT_FOUND)

    // Refused before anything was counted, queued or priced.
    expect(calls).toEqual([])
  })

  it('answers 403 on a shared inbox to a key holder with no inbox admin', async () => {
    world.capabilities.add(AUTOMATION_KEY)

    await expect(
      caller().startReclassifySample({ inboxId: SHARED_INBOX, ...SCOPE })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(hoisted.enqueueMailReclassifySample).not.toHaveBeenCalled()
  })

  /** The archetypal user again: their own mailbox, holding nothing at all. */
  it('lets a personal-inbox owner with zero permission keys start a sample', async () => {
    await expect(
      caller().startReclassifySample({ inboxId: OWN_PERSONAL, ...SCOPE })
    ).resolves.toEqual({ jobId: 'job_sample', deduplicated: false })
    expect(gate).toEqual([])
  })
})

describe('mailClassification router — the backlog row (07 §3.1)', () => {
  /**
   * ⚠️ ALL TIME + fill-gaps, whatever the dialog is set to. The row answers "is
   * there history worth classifying at all" — a row keyed on the dialog's 30-day
   * default would vanish the moment someone narrowed the range.
   */
  it('counts all time in fill-gaps mode, bounded by the backlog cap', async () => {
    world.reclassifyCount = { count: 1000, capped: true, cap: 1000, eligibleTagCount: 4 }

    expect(await caller().getBacklog({ inboxId: OWN_PERSONAL })).toEqual({
      count: 1000,
      capped: true,
      cap: 1000,
    })
    expect(hoisted.countReclassifiableThreads).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        range: { kind: 'all-time' },
        mode: 'fill-gaps',
        cap: 1000,
      })
    )
  })

  /**
   * A precondition failure is "nothing to offer", not an error to throw at
   * someone who only opened a settings page. The dialog, where a human is
   * mid-action, throws instead — asserted below.
   */
  it('answers zero rather than throwing when the inbox cannot run', async () => {
    world.reclassifyCountError = 'Turn on AI classification for this inbox first.'

    expect(await caller().getBacklog({ inboxId: OWN_PERSONAL })).toMatchObject({ count: 0 })
  })
})

describe('mailClassification router — the scope preview (07 §3.2)', () => {
  /**
   * ⚠️ 07 invariant 10 — the preview count and the run share ONE predicate. The
   * number in the confirm is the number the user agreed to spend on, so the two
   * call sites must hand the count function identical scope arguments.
   */
  it('asks the count function for exactly what the run will ask it', async () => {
    await caller().getReclassifyPreview({ inboxId: OWN_PERSONAL, ...SCOPE })
    const previewArgs = calls.filter((call) => call.startsWith('countReclassifiableThreads:'))
    calls.length = 0
    await caller().startReclassifySample({ inboxId: OWN_PERSONAL, ...SCOPE })
    const runArgs = calls.filter((call) => call.startsWith('countReclassifiableThreads:'))

    expect(previewArgs).toEqual(runArgs)
  })

  it('surfaces a precondition failure instead of swallowing it', async () => {
    world.reclassifyCountError = 'No categories are marked for AI classification yet.'

    await expect(
      caller().getReclassifyPreview({ inboxId: OWN_PERSONAL, ...SCOPE })
    ).rejects.toMatchObject({ message: 'No categories are marked for AI classification yet.' })
  })

  /**
   * Credits are estimated against the org's OWN default model, not a constant:
   * 800 input + 30 output tokens at $0.001/$0.004 per 1k is $0.00092 a
   * conversation, and a credit is $0.0001 of list-price COGS.
   */
  it('estimates credits from the org default model, for the run and for the sample', async () => {
    const preview = await caller().getReclassifyPreview({ inboxId: OWN_PERSONAL, ...SCOPE })

    expect(preview).toMatchObject({
      count: 412,
      capped: false,
      eligibleTagCount: 4,
      sampleSize: 100,
      estimatedCredits: 5060,
      sampleCredits: 1228,
      billed: true,
    })
  })

  /**
   * ⚠️ THE ONE THAT WAS WRONG. Credits are only drawn when the credentials are
   * SYSTEM: `LLMOrchestrator`'s quota gate skips the deduction entirely for a
   * CUSTOM key. Quoting an org several thousand credits for a run that will
   * charge it nothing discourages a free action, which is the worst direction for
   * a cost confirm to be wrong in.
   */
  it('quotes ZERO for an org on its own API key, because nothing is metered', async () => {
    world.providerType = 'CUSTOM'

    const preview = await caller().getReclassifyPreview({ inboxId: OWN_PERSONAL, ...SCOPE })

    expect(preview).toMatchObject({
      count: 412,
      estimatedCredits: 0,
      sampleCredits: 0,
      billed: false,
    })
  })

  /**
   * The prompt embeds every eligible tag's title AND description (05 C3), so the
   * per-call cost grows with the vocabulary. A fixed token guess drifts low
   * exactly as an org adds categories, which is the direction that matters.
   */
  it('costs more per conversation as the label set grows', async () => {
    const small = await caller().getReclassifyPreview({ inboxId: OWN_PERSONAL, ...SCOPE })

    world.eligibleLabels = [
      ...world.eligibleLabels,
      { tagId: 't3', title: 'Billing', description: 'y'.repeat(400) },
      { tagId: 't4', title: 'Order Status', description: 'y'.repeat(400) },
    ]
    const large = await caller().getReclassifyPreview({ inboxId: OWN_PERSONAL, ...SCOPE })

    expect(large.estimatedCredits).toBeGreaterThan(small.estimatedCredits ?? 0)
  })

  /** Rounded UP: a small run must never quote 0 while still costing something. */
  it('never rounds a real cost down to zero', async () => {
    world.reclassifyCount = { ...world.reclassifyCount, count: 1 }

    const preview = await caller().getReclassifyPreview({ inboxId: OWN_PERSONAL, ...SCOPE })

    expect(preview.estimatedCredits).toBeGreaterThan(0)
  })

  /**
   * ⚠️ Null, never a fabricated number. `UNPRICED_FALLBACK_CREDITS` exists to
   * BILL a call that slipped through unpriced; quoting it in a preview would
   * over-state the cost by orders of magnitude.
   */
  it('reports null credits when there is no default model, and still counts', async () => {
    world.defaultModel = null

    expect(await caller().getReclassifyPreview({ inboxId: OWN_PERSONAL, ...SCOPE })).toMatchObject({
      count: 412,
      estimatedCredits: null,
      sampleCredits: null,
    })
  })

  it('reports null credits when the registry has no price for that model', async () => {
    world.modelPrice = null

    expect(await caller().getReclassifyPreview({ inboxId: OWN_PERSONAL, ...SCOPE })).toMatchObject({
      estimatedCredits: null,
    })
  })

  it('caps the sample at what the scope actually holds', async () => {
    world.reclassifyCount = { count: 12, capped: false, cap: 5000, eligibleTagCount: 4 }

    expect(await caller().getReclassifyPreview({ inboxId: OWN_PERSONAL, ...SCOPE })).toMatchObject({
      sampleSize: 12,
    })
  })
})

/**
 * 07 R-Q8 — a run started mid-backfill races the sync and misses everything
 * still arriving. The user pays for a partial answer with no way to tell.
 */
describe('mailClassification router — sync in progress (07 R-Q8)', () => {
  it('reports a syncing channel in the preview so the dialog can say so', async () => {
    world.syncingRows = [{ '?column?': 1 }]

    expect(await caller().getReclassifyPreview({ inboxId: OWN_PERSONAL, ...SCOPE })).toMatchObject({
      syncInProgress: true,
    })
  })

  it('refuses to start while a channel is syncing, and queues nothing', async () => {
    world.syncingRows = [{ '?column?': 1 }]

    await expect(
      caller().startReclassifySample({ inboxId: OWN_PERSONAL, ...SCOPE })
    ).rejects.toMatchObject({ cause: { statusCode: 409 } })
    expect(hoisted.enqueueMailReclassifySample).not.toHaveBeenCalled()
  })
})

describe('mailClassification router — starting a sample (07 §2.11)', () => {
  it('passes the chosen scope through to the queue, with the requester recorded', async () => {
    await caller().startReclassifySample({
      inboxId: OWN_PERSONAL,
      range: { kind: 'threads', threads: 500 },
      mode: 're-classify',
    })

    expect(hoisted.enqueueMailReclassifySample).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      inboxId: OWN_PERSONAL,
      range: { kind: 'threads', threads: 500 },
      mode: 're-classify',
      requestedByUserId: USER_ID,
    })
  })

  it('refuses an empty scope rather than paying a worker to find nothing', async () => {
    world.reclassifyCount = { count: 0, capped: false, cap: 5000, eligibleTagCount: 4 }

    await expect(
      caller().startReclassifySample({ inboxId: OWN_PERSONAL, ...SCOPE })
    ).rejects.toMatchObject({ cause: { statusCode: 400 } })
    expect(hoisted.enqueueMailReclassifySample).not.toHaveBeenCalled()
  })

  it('refuses when the inbox is not opted in — a re-run is not a way in', async () => {
    // 07 invariant 6. The worker re-asserts this too, but a refusal there is a
    // log line nobody is watching.
    world.reclassifyCountError = 'Turn on AI classification for this inbox first.'

    await expect(
      caller().startReclassifySample({ inboxId: OWN_PERSONAL, ...SCOPE })
    ).rejects.toThrow('Turn on AI classification for this inbox first.')
    expect(hoisted.enqueueMailReclassifySample).not.toHaveBeenCalled()
  })

  /** "Somebody pointed a model at this mailbox's history" must not be untraceable. */
  it('audits the run with the scope it was given', async () => {
    await caller().startReclassifySample({ inboxId: OWN_PERSONAL, ...SCOPE })

    expect(hoisted.recordAuditFromCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'mail.classification.sample_started',
        targetId: OWN_PERSONAL,
        metadata: expect.objectContaining({
          mode: 'fill-gaps',
          threadsInScope: 412,
          sampleSize: 100,
        }),
      })
    )
  })

  it('never audits a refused run', async () => {
    world.reclassifyCount = { count: 0, capped: false, cap: 5000, eligibleTagCount: 4 }

    await expect(
      caller().startReclassifySample({ inboxId: OWN_PERSONAL, ...SCOPE })
    ).rejects.toBeTruthy()
    expect(hoisted.recordAuditFromCtx).not.toHaveBeenCalled()
  })
})

describe('mailClassification router — polling and cancelling', () => {
  it('passes a finished sample report straight through to the dialog', async () => {
    world.sampleStatus = {
      jobId: 'job_sample',
      state: 'completed',
      processed: 100,
      total: 100,
      report: { applied: false, classified: 74, abstained: 26 },
    }

    expect(await caller().getReclassifySampleStatus({ inboxId: OWN_PERSONAL })).toMatchObject({
      state: 'completed',
      report: { classified: 74 },
    })
  })

  it('answers null when no sample has been run recently', async () => {
    expect(await caller().getReclassifySampleStatus({ inboxId: OWN_PERSONAL })).toBeNull()
  })

  it('reports whether the job was actually removed', async () => {
    expect(await caller().cancelReclassifySample({ inboxId: OWN_PERSONAL })).toEqual({
      removed: true,
    })
  })
})
