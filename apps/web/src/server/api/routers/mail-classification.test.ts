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

  const recordAuditFromCtx = vi.fn(async () => {
    calls.push('recordAuditFromCtx')
  })

  /**
   * A stand-in for `TagService`, faithful in the one respect this router
   * depends on: `getAllTags` takes the `thread` scope filter (Q3 — `article`
   * tags are never offered to a mail classifier) and the eligibility flag is
   * `aiClassify`.
   */
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
    TagService,
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

const caller = (userId: string = USER_ID) =>
  mailClassificationRouter.createCaller({
    db: {},
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
