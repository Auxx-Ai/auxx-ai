// packages/lib/src/approval-requests/__tests__/record-access-requests.test.ts
//
// The RECORD access-request lane (plan v3/04 §11's verification bar).
//
// Structured after `access-requests.test.ts`, its mail sibling, and behavioural
// for the same reason: the rung arithmetic runs through a REAL `CapabilitySet`,
// so the seat ceiling, `foldRecordAccess` and `recordDefRung` are the shipped
// implementations rather than a `{ recordAccessAt: () => 'read' }` fake that
// would pass with the derivation replaced by a constant.
//
// TWO things are mocked that are NOT the lane under test, and both deliberately:
//
//  - `record-visibility-scope` — `resolveRecordVisibilityScope` resolves the
//    grantee union out of the org cache and `recordAccessRankSql` builds Drizzle
//    SQL over a `schema` Proxy whose COLUMNS are `{}` under the default vitest
//    setup (#1409). Neither is assertable here and both have their own suites;
//    what this file must pin is that `recordRungFor` feeds the RANK the query
//    returned into the real `recordAccessAt`, which it does.
//  - `record-sharing-guard` — the authority assert and the plan gate. Their
//    CONTENT is `resource-access`'s to test; what belongs here is that the
//    decision handler calls them, in the right order, and writes nothing when
//    either throws.

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── mocks ─────────────────────────────────────────────────────────────────────

const orgCacheData: Record<string, unknown> = {}
const cachedResources: Array<Record<string, unknown>> = []

vi.mock('../../cache', () => ({
  getOrgCache: () => ({
    get: async (_orgId: string, key: string) => orgCacheData[key],
  }),
  getCachedResources: async () => cachedResources,
  getCachedUserInstanceGrants: async (userId: string) => ({
    userId,
    role: 'USER',
    isAdmin: false,
    isMailAdmin: false,
    inboxLens: {},
    personalInboxIds: {},
    grants: {},
  }),
  getCachedMembersByUserIds: async (_orgId: string, userIds: string[]) =>
    userIds.map((userId) => ({
      userId,
      user: { id: userId, name: `Name ${userId}`, image: null },
    })),
  getCachedUserGroupIds: async () => [],
}))

const capabilitiesByUser: Record<string, unknown> = {}
vi.mock('../../permissions/capabilities/get-capabilities', () => ({
  getCapabilities: async (userId: string) => capabilitiesByUser[userId],
}))

/**
 * Which member the scope resolver was last asked about.
 *
 * The fake db cannot read a Drizzle predicate, so "whose grant rank is this
 * query for?" has to be observed here — that is what lets one `grantRank`
 * projection answer differently for the requester and for the approver in the
 * same decision.
 */
let lastScopeUserId: string | null = null
const scopeArmByUser: Record<string, string> = {}
vi.mock('../../permissions/capabilities/record-visibility-scope', () => ({
  resolveRecordVisibilityScope: async (input: { userId: string }) => {
    lastScopeUserId = input.userId
    const arm = scopeArmByUser[input.userId] ?? 'all'
    return arm === 'none' ? { arm: 'none' } : { arm, grantees: {}, where: undefined }
  },
  recordAccessRankSql: () => 'grantRankSql',
}))

const assertCanManageRecordSharing = vi.fn(async () => undefined)
const assertRecordSharingFeature = vi.fn(async () => undefined)
vi.mock('../../resource-access/record-sharing-guard', () => ({
  assertCanManageRecordSharing: (...a: unknown[]) =>
    (assertCanManageRecordSharing as unknown as (...x: unknown[]) => Promise<void>)(...a),
  assertRecordSharingFeature: (...a: unknown[]) =>
    (assertRecordSharingFeature as unknown as (...x: unknown[]) => Promise<void>)(...a),
}))

// The thread lane is pulled in by the `applyAccessDecision` dispatch. Mocked so
// a record-lane test never pays for the mail visibility graph — and so "the
// record row did NOT reach the mail guard" is an assertable fact.
const assertCanManageMailSharing = vi.fn(async () => undefined)
vi.mock('../../resource-access/mail-sharing-guard', () => ({
  assertCanManageMailSharing: (...a: unknown[]) =>
    (assertCanManageMailSharing as unknown as (...x: unknown[]) => Promise<void>)(...a),
  inboxAccessRecordId: async (_orgId: string, inboxId: string) => `inbox:${inboxId}`,
  isMailSharingDef: (def: string) =>
    def === 'inbox' || def === 'personal_inbox' || def === 'thread' || def === 'contact',
}))

const flushEmits = vi.fn(async () => {})
const grantInstanceAccess = vi.fn(async () => ({ flushEmits }))
vi.mock('../../resource-access/resource-access-service', () => ({
  grantInstanceAccess: (...a: unknown[]) =>
    (grantInstanceAccess as unknown as (...x: unknown[]) => Promise<{ flushEmits: () => void }>)(
      ...a
    ),
}))

const sendNotification = vi.fn(async () => ({}))
const deleteNotificationsByTarget = vi.fn(async () => 0)
/** Records WHICH db handle each notification was written through (see the thread suite). */
const notificationDbs: unknown[] = []
vi.mock('../../notifications/notification-service', () => ({
  NotificationService: class {
    constructor(db: unknown) {
      notificationDbs.push(db)
    }
    sendNotification = sendNotification
    deleteNotificationsByTarget = deleteNotificationsByTarget
  },
}))

vi.mock('../../events/publisher', () => ({ publisher: { publishLater: vi.fn(async () => {}) } }))
vi.mock('../../jobs/queues', () => ({
  Queues: { workflowDelayQueue: 'workflowDelayQueue' },
  getQueue: () => ({ getJob: async () => null }),
}))
vi.mock('../../realtime', () => ({
  getRealtimeService: () => ({}),
  publishApprovalResolved: vi.fn(async () => {}),
}))

// ── fake db ───────────────────────────────────────────────────────────────────

interface FakeDbOpts {
  instances?: Array<Record<string, unknown>>
  /** Aggregated grant rank per member, as `recordAccessRankSql` would return it. */
  grantRankByUser?: Record<string, number | null>
  pendingRequest?: Record<string, unknown> | null
  deniedRows?: Array<Record<string, unknown>>
  insertReturning?: Array<Array<Record<string, unknown>>>
  updateReturning?: Array<Array<Record<string, unknown>>>
}

function makeFakeDb(opts: FakeDbOpts = {}) {
  const calls = { inserts: [] as unknown[], updates: [] as unknown[], selects: [] as string[] }
  let insertIdx = 0
  let updateIdx = 0

  const selectHandler = (projection: Record<string, unknown>) => {
    const keys = Object.keys(projection)
    let rows: unknown[] = []
    if (keys.includes('displayName')) {
      calls.selects.push('instance')
      rows = opts.instances ?? []
    } else if (keys.includes('grantRank')) {
      calls.selects.push('grantRank')
      rows = [{ grantRank: opts.grantRankByUser?.[lastScopeUserId ?? ''] ?? null }]
    } else if (keys.includes('metadata') && keys.includes('createdAt')) {
      calls.selects.push('denied')
      rows = opts.deniedRows ?? []
    }
    const chain: Record<string, unknown> = {}
    for (const key of ['from', 'leftJoin', 'innerJoin', 'orderBy']) chain[key] = () => chain
    chain.where = () => chain
    chain.limit = () => chain
    ;(chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve(rows)
    return chain
  }

  const db = {
    select: selectHandler,
    insert: () => {
      const chain: Record<string, unknown> = {}
      chain.values = (v: unknown) => {
        calls.inserts.push(v)
        return chain
      }
      chain.onConflictDoNothing = () => chain
      chain.onConflictDoUpdate = () => chain
      chain.returning = async () => opts.insertReturning?.[insertIdx++] ?? [{ id: 'req-new' }]
      ;(chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve(undefined)
      return chain
    },
    update: () => {
      const chain: Record<string, unknown> = {}
      chain.set = (v: unknown) => {
        calls.updates.push(v)
        return chain
      }
      chain.where = () => chain
      chain.returning = async () => opts.updateReturning?.[updateIdx++] ?? [{ id: 'req-1' }]
      ;(chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve(undefined)
      return chain
    },
    query: {
      ApprovalRequest: { findFirst: async () => opts.pendingRequest ?? null },
      EntityGroupMember: { findMany: async () => [] },
    },
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  }
  return { db, calls }
}

// ── fixtures ──────────────────────────────────────────────────────────────────

const ORG = 'org1'
/** The CANONICAL `EntityDefinition.id` — the keyspace `ResourceAccess` is keyed on. */
const DEF = 'def-ticket'
/** The same def as a caller would name it. Resolution to {@link DEF} is the point. */
const DEF_SLUG = 'ticket'
const RECORD = 'rec-1'

const INSTANCE_ROW = {
  id: RECORD,
  entityDefinitionId: DEF,
  displayName: 'ACME onboarding',
}

/**
 * A real `CapabilitySet`, positional arguments and all.
 *
 * `role` is `USER` on purpose: `effectiveRecordLevel` short-circuits `OWNER` to
 * `admin`, which would silently make every fixture a ceiling case.
 */
async function caps(keys: string[], seatType = 'full') {
  const { CapabilitySet } = await import('../../permissions/capabilities/capability-set')
  const { PermissionKey } = await import('../../permissions/capabilities/registry')
  const asKey = (k: string) => (PermissionKey as Record<string, string>)[k] ?? k
  return new CapabilitySet(
    new Set(keys.map(asKey) as never),
    {},
    'USER' as never,
    seatType as never
  )
}

/** Record area: None. */
const noAccessKeys: string[] = []
/** Record area: Read — the `none → read` … sorry, the `read → edit` requester. */
const readKeys = ['recordsView']
/** Record area: Edit — `canEditEntity` is true, so they can already share the row. */
const editKeys = ['recordsView', 'recordsEdit']

beforeEach(async () => {
  vi.clearAllMocks()
  lastScopeUserId = null
  for (const key of Object.keys(orgCacheData)) delete orgCacheData[key]
  for (const key of Object.keys(capabilitiesByUser)) delete capabilitiesByUser[key]
  for (const key of Object.keys(scopeArmByUser)) delete scopeArmByUser[key]
  cachedResources.length = 0
  notificationDbs.length = 0

  cachedResources.push({
    id: DEF_SLUG,
    entityDefinitionId: DEF,
    entityType: DEF_SLUG,
    apiSlug: 'tickets',
    label: 'Ticket',
    plural: 'Tickets',
  })

  orgCacheData.memberRoleMap = {
    owner1: { role: 'OWNER', seatType: 'full', userType: 'USER', permissionProfileId: null },
    admin1: { role: 'ADMIN', seatType: 'full', userType: 'USER', permissionProfileId: null },
    agent1: { role: 'ADMIN', seatType: 'full', userType: 'AGENT', permissionProfileId: null },
    requester1: { role: 'USER', seatType: 'full', userType: 'USER', permissionProfileId: null },
  }

  capabilitiesByUser.requester1 = await caps(readKeys)
  capabilitiesByUser.admin1 = await caps(editKeys)
  capabilitiesByUser.owner1 = await caps(editKeys)
})

// ═══════════════════════════════════════════════════════════════════════════════
// §3.2 — the derived rung. Invariant #6 lives here.
// ═══════════════════════════════════════════════════════════════════════════════

describe('nextRecordRung (plan v3/04 §3.2, D1)', () => {
  it('derives none → read and read → edit, and nothing above', async () => {
    const { nextRecordRung } = await import('../record-access-request-queries')
    expect(nextRecordRung('none')).toBe('read')
    expect(nextRecordRung('read')).toBe('edit')
    expect(nextRecordRung('edit')).toBeNull()
    expect(nextRecordRung('admin')).toBeNull()
  })

  it('NEVER produces `none` — it is a restriction marker, not a grant (Invariant #6)', async () => {
    const { nextRecordRung } = await import('../record-access-request-queries')
    const { ALL_RUNGS } = await import('../../permissions/capabilities/rung')
    for (const rung of ALL_RUNGS) {
      expect(nextRecordRung(rung)).not.toBe('none')
    }
  })

  it('NEVER produces `admin` — sharing authority is delegated, never asked for', async () => {
    const { nextRecordRung } = await import('../record-access-request-queries')
    const { ALL_RUNGS } = await import('../../permissions/capabilities/rung')
    for (const rung of ALL_RUNGS) {
      expect(nextRecordRung(rung)).not.toBe('admin')
    }
  })

  it('refuses the sub-`read` mail tiers, which `RECORD_DEF_RUNGS` does not declare', async () => {
    const { nextRecordRung } = await import('../record-access-request-queries')
    expect(nextRecordRung('metadata')).toBeNull()
    expect(nextRecordRung('identity')).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §3.3 — which defs this lane owns
// ═══════════════════════════════════════════════════════════════════════════════

describe('isRecordRequestDef (plan v3/04 §3.3, Invariant #4)', () => {
  it('a contact def is refused by the record request lane', async () => {
    // 🔴 Invariant #7 / 01a §10.1: a record-level contact grant canonicalizes
    // into the MAIL keyspace and fans a full lens across that contact's ENTIRE
    // conversation history. This is the single most expensive thing this plan
    // could get wrong, so it is pinned by name rather than left to the
    // predicate's transitive correctness.
    const { isRecordRequestDef } = await import('../record-access-request-queries')
    expect(isRecordRequestDef('contact')).toBe(false)
  })

  it('refuses a contact at CREATION, writing no row', async () => {
    const { createRecordAccessRequest } = await import('../record-access-request-mutations')
    const { db, calls } = makeFakeDb({ instances: [INSTANCE_ROW] })
    const result = await createRecordAccessRequest(db as never, ORG, 'requester1', {
      entityDefinitionId: 'contact',
      entityInstanceId: 'contact-1',
    })
    expect(result.isErr()).toBe(true)
    expect(calls.inserts).toHaveLength(0)
    // Refused BEFORE the instance load — there is nothing to look up.
    expect(calls.selects).not.toContain('instance')
  })

  it('refuses every mail-sharing def and every declared instance domain', async () => {
    const { isRecordRequestDef } = await import('../record-access-request-queries')
    for (const def of ['thread', 'inbox', 'personal_inbox', 'contact']) {
      expect(isRecordRequestDef(def)).toBe(false)
    }
    // `!isInstanceAccessKey` alone would admit `thread` and `sequence`; the
    // registry alone would miss `contact`. Both exclusions are required.
    for (const def of ['dataset', 'kb', 'dashboard', 'workflow', 'agent', 'sequence']) {
      expect(isRecordRequestDef(def)).toBe(false)
    }
    expect(isRecordRequestDef(DEF)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §6 — the redaction-safe label
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildRecordSubjectLabel (plan v3/04 §6)', () => {
  it('gives a `none` requester the DEF NOUN and never the display name', async () => {
    const { buildRecordSubjectLabel } = await import('../record-access-request-queries')
    const ctx = {
      entityDefinitionId: DEF,
      entityInstanceId: RECORD,
      defLabel: 'Ticket',
      displayName: 'ACME onboarding',
    }
    const label = buildRecordSubjectLabel(ctx, 'none')
    expect(label).toBe('Ticket')
    expect(label).not.toContain('ACME')
  })

  it('names the record once the requester holds `read`', async () => {
    const { buildRecordSubjectLabel } = await import('../record-access-request-queries')
    const ctx = {
      entityDefinitionId: DEF,
      entityInstanceId: RECORD,
      defLabel: 'Ticket',
      displayName: 'ACME onboarding',
    }
    expect(buildRecordSubjectLabel(ctx, 'read')).toBe('Ticket · ACME onboarding')
    expect(buildRecordSubjectLabel(ctx, 'edit')).toBe('Ticket · ACME onboarding')
  })

  it('never renders a bare separator for a record with no display name', async () => {
    const { buildRecordSubjectLabel } = await import('../record-access-request-queries')
    const ctx = {
      entityDefinitionId: DEF,
      entityInstanceId: RECORD,
      defLabel: 'Ticket',
      displayName: null,
    }
    const label = buildRecordSubjectLabel(ctx, 'read')
    expect(label).toBe('Ticket')
    expect(label).not.toMatch(/·\s*$/)
  })

  it('the SNAPSHOT a `none` requester files carries the noun alone', async () => {
    const { createRecordAccessRequest } = await import('../record-access-request-mutations')
    capabilitiesByUser.requester1 = await caps(noAccessKeys)
    const { db, calls } = makeFakeDb({
      instances: [INSTANCE_ROW],
      pendingRequest: null,
      insertReturning: [[{ id: 'req-new' }]],
    })
    await createRecordAccessRequest(db as never, ORG, 'requester1', {
      entityDefinitionId: DEF_SLUG,
      entityInstanceId: RECORD,
    })
    const row = calls.inserts[0] as Record<string, unknown>
    expect(row.subjectLabel).toBe('Ticket')
    expect(row.subjectLabel).not.toContain('ACME')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Creation
// ═══════════════════════════════════════════════════════════════════════════════

describe('createRecordAccessRequest', () => {
  it('files a pending row with the DERIVED rung, the CANONICAL def id and a 14-day expiry', async () => {
    const { createRecordAccessRequest } = await import('../record-access-request-mutations')
    const { ACCESS_REQUEST_EXPIRY_DAYS } = await import('../client')
    const { db, calls } = makeFakeDb({
      instances: [INSTANCE_ROW],
      pendingRequest: null,
      insertReturning: [[{ id: 'req-new' }]],
    })

    const result = await createRecordAccessRequest(db as never, ORG, 'requester1', {
      // Named by SLUG on the wire; the persisted key must be the canonical id.
      entityDefinitionId: DEF_SLUG,
      entityInstanceId: RECORD,
    })
    expect(result.isOk()).toBe(true)

    const row = calls.inserts[0] as Record<string, unknown>
    expect(row.kind).toBe('access')
    expect(row.targetKind).toBe('instance')
    expect(row.entityDefinitionId).toBe(DEF)
    expect(row.entityInstanceId).toBe(RECORD)
    // requester1 holds def-level Read ⇒ the ask is `edit`.
    expect(row.requestedLens).toBe('edit')
    // §2.2 — rung is authoritative for the instance lane; the def-axis column
    // stays NULL rather than buying a third `Rung ↔ ResourcePermission` crossing.
    expect(row.requestedLevel).toBeNull()
    expect(Array.isArray(row.assigneeUsers)).toBe(true)
    expect(row.assigneeGroups).toEqual([])
    const days = ((row.expiresAt as Date).getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(ACCESS_REQUEST_EXPIRY_DAYS - 0.1)
    expect(days).toBeLessThan(ACCESS_REQUEST_EXPIRY_DAYS + 0.1)
  })

  it('asks for `read` when the requester holds nothing at all', async () => {
    const { createRecordAccessRequest } = await import('../record-access-request-mutations')
    capabilitiesByUser.requester1 = await caps(noAccessKeys)
    const { db, calls } = makeFakeDb({
      instances: [INSTANCE_ROW],
      pendingRequest: null,
      insertReturning: [[{ id: 'req-new' }]],
    })
    await createRecordAccessRequest(db as never, ORG, 'requester1', {
      entityDefinitionId: DEF_SLUG,
      entityInstanceId: RECORD,
    })
    expect((calls.inserts[0] as Record<string, unknown>).requestedLens).toBe('read')
  })

  it('IGNORES a caller-supplied rung — `admin` is unrequestable even by a raw call', async () => {
    const { createRecordAccessRequest } = await import('../record-access-request-mutations')
    const { db, calls } = makeFakeDb({
      instances: [INSTANCE_ROW],
      pendingRequest: null,
      insertReturning: [[{ id: 'req-new' }]],
    })
    // There is no `rung` on the input type, so this is what a hand-rolled HTTP
    // call or a future refactor smuggling one in would look like. The derivation
    // must win: an approver misreading a row is otherwise the only thing between
    // a caller-named rung and a written `admin` grant.
    await createRecordAccessRequest(db as never, ORG, 'requester1', {
      entityDefinitionId: DEF_SLUG,
      entityInstanceId: RECORD,
      rung: 'admin',
      requestedLens: 'admin',
    } as never)
    const row = calls.inserts[0] as Record<string, unknown>
    expect(row.requestedLens).toBe('edit')
    expect(row.requestedLens).not.toBe('admin')
  })

  it('snapshots org ADMINS + OWNERS as approvers, and no agent principal (D3)', async () => {
    const { createRecordAccessRequest } = await import('../record-access-request-mutations')
    const { db, calls } = makeFakeDb({
      instances: [INSTANCE_ROW],
      pendingRequest: null,
      insertReturning: [[{ id: 'req-new' }]],
    })
    await createRecordAccessRequest(db as never, ORG, 'requester1', {
      entityDefinitionId: DEF_SLUG,
      entityInstanceId: RECORD,
    })
    const row = calls.inserts[0] as { assigneeUsers: string[] }
    expect(row.assigneeUsers.sort()).toEqual(['admin1', 'owner1'])
    // A synthetic user cannot decide anything, however it is roled.
    expect(row.assigneeUsers).not.toContain('agent1')
    // D3 deleted rule 1 entirely: no `ResourceAccess` read happens at all.
    expect(calls.selects).not.toContain('managers')
  })

  it('refuses a WORKER seat, names the SEAT, and writes nothing', async () => {
    const { createRecordAccessRequest } = await import('../record-access-request-mutations')
    // `Area.records` is absent from `WORKER_AREAS` and the ceiling clamps LAST,
    // so `recordAccessAt` answers `'none'` above any row branch — unliftable.
    capabilitiesByUser.requester1 = await caps(editKeys, 'worker')
    const { db, calls } = makeFakeDb({ instances: [INSTANCE_ROW], pendingRequest: null })
    const result = await createRecordAccessRequest(db as never, ORG, 'requester1', {
      entityDefinitionId: DEF_SLUG,
      entityInstanceId: RECORD,
    })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/seat/i)
    expect(result._unsafeUnwrapErr().message).not.toMatch(/profile/i)
    expect(calls.inserts).toHaveLength(0)
  })

  it('refuses a member who is already at the ceiling — which IS the self-grant test (§4)', async () => {
    const { createRecordAccessRequest } = await import('../record-access-request-mutations')
    // A def-`Edit` member may already share the row (§10.1), and lands here by
    // construction rather than through a separate `canShare` check — which is
    // what stops the button rendering for them (§10.3).
    capabilitiesByUser.requester1 = await caps(editKeys)
    const { db, calls } = makeFakeDb({ instances: [INSTANCE_ROW], pendingRequest: null })
    const result = await createRecordAccessRequest(db as never, ORG, 'requester1', {
      entityDefinitionId: DEF_SLUG,
      entityInstanceId: RECORD,
    })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/already have edit access/i)
    expect(calls.inserts).toHaveLength(0)
  })

  it('refuses a PLAN-GATED org at creation, writing nothing (§3.5 half one)', async () => {
    const { createRecordAccessRequest } = await import('../record-access-request-mutations')
    const { ForbiddenError } = await import('../../errors')
    assertRecordSharingFeature.mockRejectedValueOnce(
      new ForbiddenError('Granular permissions is not available on your plan.') as never
    )
    const { db, calls } = makeFakeDb({ instances: [INSTANCE_ROW], pendingRequest: null })
    const result = await createRecordAccessRequest(db as never, ORG, 'requester1', {
      entityDefinitionId: DEF_SLUG,
      entityInstanceId: RECORD,
    })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/plan/i)
    expect(calls.inserts).toHaveLength(0)
  })

  it('refuses a cross-org / deleted record without probing further', async () => {
    const { createRecordAccessRequest } = await import('../record-access-request-mutations')
    const { db, calls } = makeFakeDb({ instances: [] })
    const result = await createRecordAccessRequest(db as never, ORG, 'requester1', {
      entityDefinitionId: DEF_SLUG,
      entityInstanceId: 'foreign-record',
    })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/no longer available/i)
    expect(calls.inserts).toHaveLength(0)
  })

  it('refuses a THREAD id routed into the record lane', async () => {
    const { createRecordAccessRequest } = await import('../record-access-request-mutations')
    const { db, calls } = makeFakeDb({ instances: [INSTANCE_ROW] })
    const result = await createRecordAccessRequest(db as never, ORG, 'requester1', {
      entityDefinitionId: 'thread',
      entityInstanceId: 'thread-1',
    })
    expect(result.isErr()).toBe(true)
    expect(calls.inserts).toHaveLength(0)
  })

  it('DEDUPES a second ask: updates the pending row in place and re-notifies', async () => {
    const { createRecordAccessRequest } = await import('../record-access-request-mutations')
    const { db, calls } = makeFakeDb({
      instances: [INSTANCE_ROW],
      pendingRequest: { id: 'req-1', metadata: { remindCount: 1 }, message: 'please' },
    })
    const result = await createRecordAccessRequest(db as never, ORG, 'requester1', {
      entityDefinitionId: DEF_SLUG,
      entityInstanceId: RECORD,
    })
    expect(result._unsafeUnwrap()).toMatchObject({ requestId: 'req-1', reRequested: true })
    expect(calls.inserts).toHaveLength(0)
    const patch = calls.updates[0] as { metadata: { remindCount: number }; requestedLens: string }
    expect(patch.metadata.remindCount).toBe(2)
    // The dedup identity excludes the rung precisely so a later, HIGHER ask
    // upgrades the same row instead of opening a second one.
    expect(patch.requestedLens).toBe('edit')
  })

  it('two RACING identical creates yield ONE pending row and no error', async () => {
    const { createRecordAccessRequest } = await import('../record-access-request-mutations')
    let pending: Record<string, unknown> | null = null
    const base = makeFakeDb({
      instances: [INSTANCE_ROW],
      // The loser's `ON CONFLICT DO NOTHING` returns no row.
      insertReturning: [[{ id: 'req-winner' }], []],
    })
    base.db.query.ApprovalRequest.findFirst = async () => pending

    const first = await createRecordAccessRequest(base.db as never, ORG, 'requester1', {
      entityDefinitionId: DEF_SLUG,
      entityInstanceId: RECORD,
    })
    expect(first._unsafeUnwrap()).toMatchObject({ requestId: 'req-winner', reRequested: false })
    pending = { id: 'req-winner', metadata: {}, message: null }

    const second = await createRecordAccessRequest(base.db as never, ORG, 'requester1', {
      entityDefinitionId: DEF_SLUG,
      entityInstanceId: RECORD,
    })
    expect(second.isOk()).toBe(true)
    expect(second._unsafeUnwrap()).toMatchObject({ requestId: 'req-winner', reRequested: true })
    expect(base.calls.inserts).toHaveLength(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// The deny cooldown — and WHICH timestamp it is measured from
// ═══════════════════════════════════════════════════════════════════════════════

describe('deny cooldown (shared with the thread lane)', () => {
  it('blocks a re-ask inside the 7-day window', async () => {
    const { createRecordAccessRequest } = await import('../record-access-request-mutations')
    const { db, calls } = makeFakeDb({
      instances: [INSTANCE_ROW],
      pendingRequest: null,
      deniedRows: [{ createdAt: new Date(), metadata: { deniedAt: new Date().toISOString() } }],
    })
    const result = await createRecordAccessRequest(db as never, ORG, 'requester1', {
      entityDefinitionId: DEF_SLUG,
      entityInstanceId: RECORD,
    })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/recently declined/i)
    expect(calls.inserts).toHaveLength(0)
  })

  it('measures the window from `metadata.deniedAt`, NOT from `createdAt`', async () => {
    const { createRecordAccessRequest } = await import('../record-access-request-mutations')
    const { ACCESS_DENY_COOLDOWN_DAYS } = await import('../client')
    // A row CREATED 30 days ago but DENIED yesterday is still inside the window:
    // `deniedAt` can trail `createdAt` by the request's whole 14-day life. A
    // cooldown read filtered on `createdAt` would silently drop this.
    const long = new Date(Date.now() - 30 * 86_400_000)
    const blocked = makeFakeDb({
      instances: [INSTANCE_ROW],
      pendingRequest: null,
      deniedRows: [{ createdAt: long, metadata: { deniedAt: new Date().toISOString() } }],
    })
    const blockedResult = await createRecordAccessRequest(blocked.db as never, ORG, 'requester1', {
      entityDefinitionId: DEF_SLUG,
      entityInstanceId: RECORD,
    })
    expect(blockedResult.isErr()).toBe(true)
    expect(blocked.calls.inserts).toHaveLength(0)

    // And the mirror image: created yesterday, denied long ago ⇒ ALLOWED.
    const old = new Date(Date.now() - (ACCESS_DENY_COOLDOWN_DAYS + 1) * 86_400_000)
    const allowed = makeFakeDb({
      instances: [INSTANCE_ROW],
      pendingRequest: null,
      deniedRows: [{ createdAt: new Date(), metadata: { deniedAt: old.toISOString() } }],
      insertReturning: [[{ id: 'req-new' }]],
    })
    const allowedResult = await createRecordAccessRequest(allowed.db as never, ORG, 'requester1', {
      entityDefinitionId: DEF_SLUG,
      entityInstanceId: RECORD,
    })
    expect(allowedResult.isOk()).toBe(true)
    expect(allowed.calls.inserts).toHaveLength(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §3.4 — the decision handler and the target-kind dispatch
// ═══════════════════════════════════════════════════════════════════════════════

const RECORD_ROW = {
  id: 'req-1',
  organizationId: ORG,
  kind: 'access' as const,
  status: 'approved',
  subjectLabel: 'Ticket',
  targetKind: 'instance',
  entityDefinitionId: DEF,
  entityInstanceId: RECORD,
  requesterId: 'requester1',
  requestedLens: 'edit',
  metadata: {},
}

describe('applyAccessDecision dispatch (plan v3/04 §3.4)', () => {
  it('routes a RECORD row to the record handler and never through the mail guard', async () => {
    const { applyAccessDecision } = await import('../access-request-mutations')
    const { db } = makeFakeDb({ instances: [INSTANCE_ROW] })
    await applyAccessDecision({
      tx: db,
      request: RECORD_ROW as never,
      approverUserId: 'admin1',
      action: 'approve',
    })
    expect(assertCanManageRecordSharing).toHaveBeenCalledTimes(1)
    expect(assertCanManageMailSharing).not.toHaveBeenCalled()
    expect(grantInstanceAccess).toHaveBeenCalledTimes(1)
  })

  it('routes a THREAD row to the mail guard and never through the record guard', async () => {
    const { applyAccessDecision } = await import('../access-request-mutations')
    const { db } = makeFakeDb({ instances: [INSTANCE_ROW] })
    await expect(
      applyAccessDecision({
        tx: db,
        request: { ...RECORD_ROW, entityDefinitionId: 'thread', entityInstanceId: 't1' } as never,
        approverUserId: 'admin1',
        action: 'approve',
      })
      // The thread arm loads a `Thread` row this fake db does not serve, so it
      // refuses — which is the point: it went to the MAIL lane, not this one.
    ).rejects.toThrow()
    expect(assertCanManageRecordSharing).not.toHaveBeenCalled()
  })

  it('refuses a def neither lane owns rather than writing through the wrong one', async () => {
    const { applyAccessDecision } = await import('../access-request-mutations')
    const { db } = makeFakeDb({ instances: [INSTANCE_ROW] })
    for (const def of ['contact', 'dataset', 'sequence']) {
      await expect(
        applyAccessDecision({
          tx: db,
          request: { ...RECORD_ROW, entityDefinitionId: def } as never,
          approverUserId: 'admin1',
          action: 'approve',
        })
      ).rejects.toThrow(/not supported/i)
    }
    expect(grantInstanceAccess).not.toHaveBeenCalled()
  })

  it('refuses a non-instance target kind', async () => {
    const { applyAccessDecision } = await import('../access-request-mutations')
    const { db } = makeFakeDb({ instances: [INSTANCE_ROW] })
    await expect(
      applyAccessDecision({
        tx: db,
        request: { ...RECORD_ROW, targetKind: 'area', entityDefinitionId: null } as never,
        approverUserId: 'admin1',
        action: 'approve',
      })
    ).rejects.toThrow(/not supported/i)
  })
})

describe('applyRecordAccessDecision (plan v3/04 §3.4)', () => {
  it('APPROVE grants the REQUESTED rung through the shared funnel, deferring emits', async () => {
    const { applyRecordAccessDecision } = await import('../record-access-request-mutations')
    const { db, calls } = makeFakeDb({ instances: [INSTANCE_ROW] })

    const out = await applyRecordAccessDecision({
      tx: db,
      request: RECORD_ROW as never,
      approverUserId: 'admin1',
      action: 'approve',
    })

    const [ctx, input] = grantInstanceAccess.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ]
    expect(ctx).toMatchObject({ organizationId: ORG, userId: 'admin1' })
    expect(input).toMatchObject({
      recordId: `${DEF}:${RECORD}`,
      granteeType: 'user',
      granteeId: 'requester1',
      rung: 'edit',
      origin: 'approval',
      // Module guide §8 — the grant row is transactional, its cache emits are not.
      deferEmits: true,
    })

    const patch = calls.updates.at(-1) as Record<string, unknown>
    expect(patch).toMatchObject({ grantedLens: 'edit' })
    expect(patch).not.toHaveProperty('grantedLevel')

    // The emits must not have fired inside the transaction…
    expect(flushEmits).not.toHaveBeenCalled()
    const outerDb = { marker: 'outer' }
    notificationDbs.length = 0
    await out.afterCommit?.(outerDb as never)
    expect(flushEmits).toHaveBeenCalledTimes(1)
    // …and post-commit work must run on the handle it was GIVEN, never a closure
    // over the released `tx`.
    expect(notificationDbs).toEqual([outerDb])
  })

  it('revalidates the ACTING APPROVER: a 403 writes NOTHING and leaves the row pending', async () => {
    const { applyRecordAccessDecision } = await import('../record-access-request-mutations')
    const { ForbiddenError } = await import('../../errors')
    assertCanManageRecordSharing.mockRejectedValueOnce(
      new ForbiddenError("You don't have permission to manage sharing for this record.") as never
    )
    const { db, calls } = makeFakeDb({ instances: [INSTANCE_ROW] })

    await expect(
      applyRecordAccessDecision({
        tx: db,
        request: RECORD_ROW as never,
        approverUserId: 'admin1',
        action: 'approve',
      })
    ).rejects.toThrow(/permission/i)

    // No ResourceAccess row…
    expect(grantInstanceAccess).not.toHaveBeenCalled()
    // …and no status write either, so the claim rolls back to `pending`.
    expect(calls.updates).toHaveLength(0)
  })

  it('revalidates on DENY too — a stale approver cannot block a request either', async () => {
    const { applyRecordAccessDecision } = await import('../record-access-request-mutations')
    const { ForbiddenError } = await import('../../errors')
    assertCanManageRecordSharing.mockRejectedValueOnce(new ForbiddenError('nope') as never)
    const { db, calls } = makeFakeDb({ instances: [INSTANCE_ROW] })
    await expect(
      applyRecordAccessDecision({
        tx: db,
        request: RECORD_ROW as never,
        approverUserId: 'admin1',
        action: 'deny',
      })
    ).rejects.toThrow()
    expect(calls.updates).toHaveLength(0)
  })

  it('asserts with the ACTING approver’s identity, not the requester’s', async () => {
    const { applyRecordAccessDecision } = await import('../record-access-request-mutations')
    const { db } = makeFakeDb({ instances: [INSTANCE_ROW] })
    await applyRecordAccessDecision({
      tx: db,
      request: RECORD_ROW as never,
      approverUserId: 'owner1',
      action: 'approve',
    })
    expect(assertCanManageRecordSharing).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG, userId: 'owner1' }),
      expect.anything(),
      `${DEF}:${RECORD}`
    )
  })

  it('a PLAN-GATED org cannot be granted through an approval either (§3.5 half two)', async () => {
    const { applyRecordAccessDecision } = await import('../record-access-request-mutations')
    const { ForbiddenError } = await import('../../errors')
    // The row exists — written before the org downgraded, or by a fixture. With
    // the gate only in the `resourceAccess` router this is the escalation: a
    // non-Enterprise org could not share the record through the dialog but COULD
    // through an approved request.
    assertRecordSharingFeature.mockRejectedValueOnce(
      new ForbiddenError('Granular permissions is not available on your plan.') as never
    )
    const { db, calls } = makeFakeDb({ instances: [INSTANCE_ROW] })
    await expect(
      applyRecordAccessDecision({
        tx: db,
        request: RECORD_ROW as never,
        approverUserId: 'admin1',
        action: 'approve',
      })
    ).rejects.toThrow(/plan/i)
    expect(grantInstanceAccess).not.toHaveBeenCalled()
    expect(calls.updates).toHaveLength(0)
  })

  it('SUPERSEDES when the requester reached the asked-for rung another way', async () => {
    const { applyRecordAccessDecision } = await import('../record-access-request-mutations')
    // The requester picked up def-level Edit between filing and the decision.
    //
    // ⚠ Asserted on their CURRENT state. Folding the PROPOSED grant in would be
    // a tautology: `foldRecordAccess` is `max(defRung, grantRank)`, so folding
    // the grant about to be written always satisfies the request — for every
    // requester, on every record.
    capabilitiesByUser.requester1 = await caps(editKeys)
    const { db, calls } = makeFakeDb({ instances: [INSTANCE_ROW] })

    const out = await applyRecordAccessDecision({
      tx: db,
      request: RECORD_ROW as never,
      approverUserId: 'admin1',
      action: 'approve',
    })

    expect(grantInstanceAccess).not.toHaveBeenCalled()
    expect(calls.updates[0]).toMatchObject({ status: 'superseded' })
    sendNotification.mockClear()
    await out.afterCommit?.(db as never)
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ACCESS_REQUEST_DECIDED',
        userId: 'requester1',
        metadata: expect.objectContaining({ decision: 'superseded' }),
      })
    )
  })

  it('does NOT supersede a genuine raise — `read` holder asking for `edit` is granted', async () => {
    const { applyRecordAccessDecision } = await import('../record-access-request-mutations')
    const { db } = makeFakeDb({ instances: [INSTANCE_ROW] })
    await applyRecordAccessDecision({
      tx: db,
      request: RECORD_ROW as never,
      approverUserId: 'admin1',
      action: 'approve',
    })
    expect(grantInstanceAccess).toHaveBeenCalledTimes(1)
  })

  it('supersedes a `read` ask the requester already satisfies at `edit`', async () => {
    const { applyRecordAccessDecision } = await import('../record-access-request-mutations')
    const { db, calls } = makeFakeDb({ instances: [INSTANCE_ROW] })
    await applyRecordAccessDecision({
      tx: db,
      request: { ...RECORD_ROW, requestedLens: 'read' } as never,
      approverUserId: 'admin1',
      action: 'approve',
    })
    expect(grantInstanceAccess).not.toHaveBeenCalled()
    expect(calls.updates[0]).toMatchObject({ status: 'superseded' })
  })

  it('refuses to grant `none` or `admin`, whatever the stored row says (Invariant #6)', async () => {
    const { applyRecordAccessDecision } = await import('../record-access-request-mutations')
    // `nextRecordRung` cannot emit either, but a hand-written row, a bad
    // migration or a future lane could — and a grant is not the place to find
    // out. `none` is a RESTRICTION marker; `admin` is delegated sharing
    // authority.
    capabilitiesByUser.requester1 = await caps(noAccessKeys)
    for (const requestedLens of ['none', 'admin', null]) {
      const { db, calls } = makeFakeDb({ instances: [INSTANCE_ROW] })
      await expect(
        applyRecordAccessDecision({
          tx: db,
          request: { ...RECORD_ROW, requestedLens } as never,
          approverUserId: 'admin1',
          action: 'approve',
        })
      ).rejects.toThrow(/grantable/i)
      expect(calls.updates).toHaveLength(0)
    }
    expect(grantInstanceAccess).not.toHaveBeenCalled()
  })

  it('DENY records `deniedAt`, which is what the cooldown is measured from', async () => {
    const { applyRecordAccessDecision } = await import('../record-access-request-mutations')
    const { db, calls } = makeFakeDb({ instances: [INSTANCE_ROW] })
    const out = await applyRecordAccessDecision({
      tx: db,
      request: RECORD_ROW as never,
      approverUserId: 'admin1',
      action: 'deny',
    })
    expect(grantInstanceAccess).not.toHaveBeenCalled()
    const patch = calls.updates[0] as { metadata: { deniedAt?: string; decidedById?: string } }
    expect(typeof patch.metadata.deniedAt).toBe('string')
    expect(patch.metadata.decidedById).toBe('admin1')

    sendNotification.mockClear()
    await out.afterCommit?.(db as never)
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ACCESS_REQUEST_DECIDED',
        userId: 'requester1',
        metadata: expect.objectContaining({ decision: 'denied' }),
      })
    )
  })

  it('refuses a deleted / cross-org record instead of granting into the void', async () => {
    const { applyRecordAccessDecision } = await import('../record-access-request-mutations')
    const { db } = makeFakeDb({ instances: [] })
    await expect(
      applyRecordAccessDecision({
        tx: db,
        request: RECORD_ROW as never,
        approverUserId: 'admin1',
        action: 'approve',
      })
    ).rejects.toThrow(/no longer available/i)
    expect(grantInstanceAccess).not.toHaveBeenCalled()
  })

  it('refuses to grant access a WORKER-seat requester could never use', async () => {
    const { applyRecordAccessDecision } = await import('../record-access-request-mutations')
    capabilitiesByUser.requester1 = await caps(editKeys, 'worker')
    const { db } = makeFakeDb({ instances: [INSTANCE_ROW] })
    await expect(
      applyRecordAccessDecision({
        tx: db,
        request: RECORD_ROW as never,
        approverUserId: 'admin1',
        action: 'approve',
      })
    ).rejects.toThrow(/seat/i)
    expect(grantInstanceAccess).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §7 — the preflight
// ═══════════════════════════════════════════════════════════════════════════════

describe('preflightRecordAccessRequest (plan v3/04 §7)', () => {
  it('reports the derived rung and the admin audience for an eligible member', async () => {
    const { preflightRecordAccessRequest } = await import('../record-access-request-queries')
    const { db } = makeFakeDb({ instances: [INSTANCE_ROW], pendingRequest: null })
    const result = await preflightRecordAccessRequest(
      db as never,
      ORG,
      'requester1',
      DEF_SLUG,
      RECORD
    )

    expect(result).toMatchObject({
      eligible: true,
      currentRung: 'read',
      requestedRung: 'edit',
      refusalReason: null,
      pending: null,
    })
    expect(result.approvers.map((a) => a.userId).sort()).toEqual(['admin1', 'owner1'])
    expect(result.subjectLabel).toBe('Ticket · ACME onboarding')
  })

  it('gives a `none` member the def noun alone and an ask of `read` (§9)', async () => {
    const { preflightRecordAccessRequest } = await import('../record-access-request-queries')
    capabilitiesByUser.requester1 = await caps(noAccessKeys)
    const { db } = makeFakeDb({ instances: [INSTANCE_ROW], pendingRequest: null })
    const result = await preflightRecordAccessRequest(
      db as never,
      ORG,
      'requester1',
      DEF_SLUG,
      RECORD
    )

    expect(result).toMatchObject({ eligible: true, currentRung: 'none', requestedRung: 'read' })
    // Keeping this generic is what bounds mount 4's existence oracle to an
    // EXISTENCE oracle rather than a content leak.
    expect(result.subjectLabel).toBe('Ticket')
    expect(result.subjectLabel).not.toContain('ACME')
  })

  it('folds a per-ROW grant into the current rung (the `_access` stamp, not the def)', async () => {
    const { preflightRecordAccessRequest } = await import('../record-access-request-queries')
    const { RUNG_ORDER } = await import('../../permissions/capabilities/rung')
    // Def level None, but an explicit `edit` grant on this one row.
    capabilitiesByUser.requester1 = await caps(noAccessKeys)
    const { db } = makeFakeDb({
      instances: [INSTANCE_ROW],
      pendingRequest: null,
      grantRankByUser: { requester1: RUNG_ORDER.edit },
    })
    const result = await preflightRecordAccessRequest(
      db as never,
      ORG,
      'requester1',
      DEF_SLUG,
      RECORD
    )
    expect(result).toMatchObject({
      eligible: false,
      currentRung: 'edit',
      refusalReason: 'already_at_ceiling',
    })
  })

  it('refuses a member who can already share the row with `already_at_ceiling`', async () => {
    const { preflightRecordAccessRequest } = await import('../record-access-request-queries')
    capabilitiesByUser.requester1 = await caps(editKeys)
    const { db } = makeFakeDb({ instances: [INSTANCE_ROW], pendingRequest: null })
    const result = await preflightRecordAccessRequest(
      db as never,
      ORG,
      'requester1',
      DEF_SLUG,
      RECORD
    )
    expect(result).toMatchObject({ eligible: false, refusalReason: 'already_at_ceiling' })
    expect(result.requestedRung).toBeNull()
  })

  it('refuses a WORKER seat with `worker_seat`', async () => {
    const { preflightRecordAccessRequest } = await import('../record-access-request-queries')
    const { RECORD_ACCESS_REFUSAL_COPY } = await import('../client')
    capabilitiesByUser.requester1 = await caps(editKeys, 'worker')
    const { db } = makeFakeDb({ instances: [INSTANCE_ROW], pendingRequest: null })
    const result = await preflightRecordAccessRequest(
      db as never,
      ORG,
      'requester1',
      DEF_SLUG,
      RECORD
    )
    expect(result).toMatchObject({ eligible: false, refusalReason: 'worker_seat' })
    expect(RECORD_ACCESS_REFUSAL_COPY.worker_seat).toMatch(/seat/i)
    expect(RECORD_ACCESS_REFUSAL_COPY.worker_seat).not.toMatch(/profile/i)
  })

  it('refuses a PLAN-GATED org with `plan_gated`, naming the plan and not the profile', async () => {
    const { preflightRecordAccessRequest } = await import('../record-access-request-queries')
    const { RECORD_ACCESS_REFUSAL_COPY } = await import('../client')
    const { ForbiddenError } = await import('../../errors')
    assertRecordSharingFeature.mockRejectedValueOnce(new ForbiddenError('nope') as never)
    const { db } = makeFakeDb({ instances: [INSTANCE_ROW], pendingRequest: null })
    const result = await preflightRecordAccessRequest(
      db as never,
      ORG,
      'requester1',
      DEF_SLUG,
      RECORD
    )
    expect(result).toMatchObject({ eligible: false, refusalReason: 'plan_gated' })
    expect(RECORD_ACCESS_REFUSAL_COPY.plan_gated).toMatch(/plan/i)
    expect(RECORD_ACCESS_REFUSAL_COPY.plan_gated).not.toMatch(/admin|profile/i)
  })

  it('does NOT swallow an infrastructure failure as a plan refusal', async () => {
    const { preflightRecordAccessRequest } = await import('../record-access-request-queries')
    assertRecordSharingFeature.mockRejectedValueOnce(new Error('redis is down') as never)
    const { db } = makeFakeDb({ instances: [INSTANCE_ROW], pendingRequest: null })
    // Reporting "your plan does not include this" over an outage is a wrong
    // answer wearing a confident label, and it sends the user to billing.
    await expect(
      preflightRecordAccessRequest(db as never, ORG, 'requester1', DEF_SLUG, RECORD)
    ).rejects.toThrow(/redis/i)
  })

  it('refuses a missing record, a thread and a contact all as `target_unavailable`', async () => {
    const { preflightRecordAccessRequest } = await import('../record-access-request-queries')
    const missing = makeFakeDb({ instances: [] })
    expect(
      await preflightRecordAccessRequest(missing.db as never, ORG, 'requester1', DEF_SLUG, 'nope')
    ).toMatchObject({ eligible: false, refusalReason: 'target_unavailable' })

    const present = makeFakeDb({ instances: [INSTANCE_ROW] })
    for (const def of ['thread', 'contact']) {
      expect(
        await preflightRecordAccessRequest(present.db as never, ORG, 'requester1', def, RECORD)
      ).toMatchObject({ eligible: false, refusalReason: 'target_unavailable' })
    }
  })

  it('reports a pending request rather than refusing, so the trigger can swap', async () => {
    const { preflightRecordAccessRequest } = await import('../record-access-request-queries')
    const created = new Date()
    const { db } = makeFakeDb({
      instances: [INSTANCE_ROW],
      pendingRequest: { id: 'req-1', createdAt: created, metadata: { remindedAt: null } },
      // A live cooldown must NOT beat a pending row — only a fresh deny blocks,
      // and a pending request means there is nothing to re-ask.
      deniedRows: [{ createdAt: new Date(), metadata: { deniedAt: new Date().toISOString() } }],
    })
    const result = await preflightRecordAccessRequest(
      db as never,
      ORG,
      'requester1',
      DEF_SLUG,
      RECORD
    )
    expect(result.eligible).toBe(true)
    expect(result.pending).toMatchObject({ id: 'req-1', createdAt: created })
  })

  it('refuses inside the deny cooldown when there is no pending row', async () => {
    const { preflightRecordAccessRequest } = await import('../record-access-request-queries')
    const { db } = makeFakeDb({
      instances: [INSTANCE_ROW],
      pendingRequest: null,
      deniedRows: [{ createdAt: new Date(), metadata: { deniedAt: new Date().toISOString() } }],
    })
    const result = await preflightRecordAccessRequest(
      db as never,
      ORG,
      'requester1',
      DEF_SLUG,
      RECORD
    )
    expect(result).toMatchObject({ eligible: false, refusalReason: 'deny_cooldown' })
  })

  it('pays for NO ResourceAccess approver query — D3 deleted rule 1', async () => {
    const { preflightRecordAccessRequest } = await import('../record-access-request-queries')
    const { db, calls } = makeFakeDb({ instances: [INSTANCE_ROW], pendingRequest: null })
    await preflightRecordAccessRequest(db as never, ORG, 'requester1', DEF_SLUG, RECORD)
    // The instance load, the rank read, and the cooldown read the eligible path
    // owes. Approver resolution is a `memberRoleMap` CACHE read — the thread
    // lane's `ResourceAccess` Manager query has no counterpart here.
    expect(calls.selects).toEqual(['instance', 'grantRank', 'denied'])
    expect(calls.selects).not.toContain('managers')
  })

  it('a REFUSAL never pays for the pending or cooldown reads (cheapest-first)', async () => {
    const { preflightRecordAccessRequest } = await import('../record-access-request-queries')
    capabilitiesByUser.requester1 = await caps(editKeys)
    const { db, calls } = makeFakeDb({ instances: [INSTANCE_ROW], pendingRequest: null })
    await preflightRecordAccessRequest(db as never, ORG, 'requester1', DEF_SLUG, RECORD)
    expect(calls.selects).toEqual(['instance', 'grantRank'])
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §6 — the approver-side view and its hydration gate
// ═══════════════════════════════════════════════════════════════════════════════

describe('getRecordAccessRequestApproverView (plan v3/04 §6)', () => {
  const PENDING_ROW = {
    ...RECORD_ROW,
    status: 'pending',
    // Built at creation from the REQUESTER's own view, so it carries no display name.
    subjectLabel: 'Ticket',
    metadata: { remindCount: 2 },
  }

  it('HYDRATES for an approver who can read the record', async () => {
    const { getRecordAccessRequestApproverView } = await import('../record-access-request-queries')
    const { db } = makeFakeDb({ instances: [INSTANCE_ROW], pendingRequest: PENDING_ROW })
    const view = await getRecordAccessRequestApproverView(db as never, ORG, 'admin1', 'req-1')

    expect(view).toMatchObject({
      hydrated: true,
      approverRung: 'edit',
      requesterRung: 'read',
      requestedRung: 'edit',
      targetAvailable: true,
      remindCount: 2,
      requester: { userId: 'requester1', name: 'Name requester1' },
    })
    expect(view?.label).toBe('Ticket · ACME onboarding')
  })

  it('falls back to the SNAPSHOT for an approver who cannot read it — no leaked name', async () => {
    const { getRecordAccessRequestApproverView } = await import('../record-access-request-queries')
    // The case §6 exists for: under D3 requests route to org admins, who may hold
    // nothing on the def at all. Sharing authority is not a reading rung.
    capabilitiesByUser.admin1 = await caps(noAccessKeys)
    const { db } = makeFakeDb({ instances: [INSTANCE_ROW], pendingRequest: PENDING_ROW })
    const view = await getRecordAccessRequestApproverView(db as never, ORG, 'admin1', 'req-1')

    expect(view?.hydrated).toBe(false)
    expect(view?.approverRung).toBe('none')
    expect(view?.label).toBe('Ticket')
    expect(view?.label).not.toContain('ACME')
  })

  it('reports a deleted / cross-org target instead of offering an Approve that fails', async () => {
    const { getRecordAccessRequestApproverView } = await import('../record-access-request-queries')
    const { db } = makeFakeDb({ instances: [], pendingRequest: PENDING_ROW })
    const view = await getRecordAccessRequestApproverView(db as never, ORG, 'admin1', 'req-1')
    expect(view).toMatchObject({ targetAvailable: false, hydrated: false, approverRung: 'none' })
    expect(view?.label).toBe('Ticket')
  })

  it('returns null for a THREAD request, so the row falls back to the mail view', async () => {
    const { getRecordAccessRequestApproverView } = await import('../record-access-request-queries')
    const { db } = makeFakeDb({
      instances: [INSTANCE_ROW],
      pendingRequest: { ...PENDING_ROW, entityDefinitionId: 'thread', entityInstanceId: 't1' },
    })
    expect(await getRecordAccessRequestApproverView(db as never, ORG, 'admin1', 'req-1')).toBeNull()
  })
})
