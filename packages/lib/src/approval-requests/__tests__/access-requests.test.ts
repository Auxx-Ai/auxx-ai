// packages/lib/src/approval-requests/__tests__/access-requests.test.ts
//
// The thread access-request lane (plan 42 §13's verification bar).
//
// Behavioural, with a REAL `CapabilitySet` — the front-door tests drive the actual
// `can()` implementation, including its `instanceDerivedKeys` arm, rather than a
// `{ can: () => boolean }` fake that would pass with the assert replaced by a
// `throw` (the trap #1359 documented in `agent-authoring-guard.test.ts`).
//
// `inboxAccessRecordId` is mocked but stays CACHE-DRIVEN: it resolves the def off
// the mocked `inboxes` org-cache entry exactly as the real one does, so hardcoding
// `toRecordId('inbox', …)` in the resolver under test still breaks the
// personal-inbox case.

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── mocks ─────────────────────────────────────────────────────────────────────

const orgCacheData: Record<string, unknown> = {}
const mailVisibility: Record<string, unknown> = {}

vi.mock('../../cache', () => ({
  getOrgCache: () => ({
    get: async (_orgId: string, key: string) => orgCacheData[key],
  }),
  getCachedUserMailVisibility: async (userId: string) => mailVisibility[userId],
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

const assertCanManageMailSharing = vi.fn(async () => undefined)

/**
 * The RecordId the code under test last resolved for an inbox, or `null` if it
 * never asked.
 *
 * This is the instrument that makes the personal-inbox case mutation-sensitive.
 * The fake db cannot read a Drizzle predicate (the default setup mocks `schema` as
 * a Proxy of empty objects), so "which def did you query?" has to be observed
 * here: a resolver that hardcodes `toRecordId('inbox', …)` never calls
 * `inboxAccessRecordId`, this stays `null`, and the manager-row store returns
 * nothing — exactly the empty approver set the real bug produces.
 */
let resolvedInboxRecordId: string | null = null

vi.mock('../../resource-access/mail-sharing-guard', () => ({
  assertCanManageMailSharing: (...args: unknown[]) =>
    (assertCanManageMailSharing as unknown as (...a: unknown[]) => Promise<void>)(...args),
  // Cache-driven, mirroring the real implementation: read the instance's ACTUAL
  // def off the merged `inboxes` list and key the RecordId by it.
  inboxAccessRecordId: async (_orgId: string, inboxId: string) => {
    const inboxes = (orgCacheData.inboxes ?? []) as Array<{
      id: string
      entityDefinitionKey?: string
    }>
    const defKey = inboxes.find((i) => i.id === inboxId)?.entityDefinitionKey
    const def = defKey === 'inbox' || defKey === 'personal_inbox' ? defKey : 'inbox'
    resolvedInboxRecordId = `${def}:${inboxId}`
    return resolvedInboxRecordId
  },
}))

// Returns the real `GrantInstanceAccessResult` shape, not `undefined`: the
// deferred-emit contract means the handler destructures `flushEmits` from this
// and calls it in `afterCommit`. A mock resolving to `undefined` fails to
// destructure — and a mock returning a no-op `flushEmits` would hide whether the
// flush is actually invoked, so `flushEmits` is a spy of its own.
const flushEmits = vi.fn(async () => {})
const grantInstanceAccess = vi.fn(async () => ({ flushEmits }))
vi.mock('../../resource-access/resource-access-service', () => ({
  grantInstanceAccess: (...args: unknown[]) =>
    (grantInstanceAccess as unknown as (...a: unknown[]) => Promise<{ flushEmits: () => void }>)(
      ...args
    ),
}))

const sendNotification = vi.fn(async () => ({}))
const deleteNotificationsByTarget = vi.fn(async () => 0)
/**
 * The constructor argument is RECORDED, not discarded. It is the only way a test
 * can see WHICH db handle a notification was written through — and post-commit
 * work handed the released transaction handle instead of the outer `db` fails
 * silently in production (the resolve path only warns), so "it sent a
 * notification" is not the assertion that matters. `notificationDbs` is.
 */
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
  threads?: Array<Record<string, unknown>>
  /**
   * Inbox `admin` ResourceAccess rows, keyed by the RecordId they are stored
   * under. Keyed rather than flat so the DEF the resolver picked decides what comes
   * back — a flat array would answer identically for `inbox:` and `personal_inbox:`
   * and make the personal-mailbox regression invisible.
   */
  managerRowsByRecordId?: Record<string, Array<{ granteeType: string; granteeId: string }>>
  groupMembers?: Array<{ memberRefId: string }>
  /** `ApprovalRequest.findFirst` result, per call. */
  pendingRequest?: Record<string, unknown> | null
  deniedRows?: Array<Record<string, unknown>>
  /** `.returning()` results for INSERT, in order. `null` entry = ON CONFLICT DO NOTHING. */
  insertReturning?: Array<Array<Record<string, unknown>>>
  /** `.returning()` results for UPDATE, in order. */
  updateReturning?: Array<Array<Record<string, unknown>>>
}

function makeFakeDb(opts: FakeDbOpts = {}) {
  const calls = {
    inserts: [] as unknown[],
    updates: [] as unknown[],
    selects: [] as string[],
  }
  let insertIdx = 0
  let updateIdx = 0

  // `select({...})` is used for: thread load, manager rows, deny-cooldown rows,
  // participant rows. They are told apart by the projected key set.
  const selectHandler = (projection: Record<string, unknown>) => {
    const keys = Object.keys(projection)
    let rows: unknown[] = []
    if (keys.includes('primaryEntityInstanceId')) {
      calls.selects.push('thread')
      rows = opts.threads ?? []
    } else if (keys.includes('granteeType')) {
      calls.selects.push('managers')
      rows =
        resolvedInboxRecordId === null
          ? []
          : (opts.managerRowsByRecordId?.[resolvedInboxRecordId] ?? [])
    } else if (keys.includes('metadata') && keys.includes('createdAt')) {
      calls.selects.push('denied')
      rows = opts.deniedRows ?? []
    } else if (keys.includes('entityInstanceId')) {
      calls.selects.push('participants')
      rows = []
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
      ApprovalRequest: {
        findFirst: async () => opts.pendingRequest ?? null,
      },
      EntityGroupMember: {
        findMany: async () => opts.groupMembers ?? [],
      },
    },
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  }
  return { db, calls }
}

// ── fixtures ──────────────────────────────────────────────────────────────────

const ORG = 'org1'
const THREAD = 'thread-1'
const INBOX = 'inbox-1'

const THREAD_ROW = {
  id: THREAD,
  inboxId: INBOX,
  assigneeId: null,
  primaryEntityInstanceId: null,
  subject: 'Refund for order #4821',
  messageCount: 4,
  participantCount: 2,
}

function vis(userId: string, overrides: Record<string, unknown> = {}) {
  return {
    userId,
    role: 'USER',
    isAdmin: false,
    isMailAdmin: false,
    inboxLens: {},
    personalInboxIds: {},
    threadGrants: {},
    contactGrants: {},
    entityGrants: {},
    ...overrides,
  }
}

async function fullSeatCaps(keys: string[], seatType = 'full', derived: string[] = []) {
  const { CapabilitySet } = await import('../../permissions/capabilities/capability-set')
  const { PermissionKey } = await import('../../permissions/capabilities/registry')
  const asKey = (k: string) => (PermissionKey as Record<string, string>)[k] ?? k
  return new CapabilitySet(
    new Set(keys.map(asKey) as never),
    {},
    'USER' as never,
    seatType as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    new Set(derived.map(asKey) as never)
  )
}

beforeEach(async () => {
  vi.clearAllMocks()
  resolvedInboxRecordId = null
  for (const key of Object.keys(orgCacheData)) delete orgCacheData[key]
  for (const key of Object.keys(mailVisibility)) delete mailVisibility[key]
  for (const key of Object.keys(capabilitiesByUser)) delete capabilitiesByUser[key]

  orgCacheData.inboxes = [
    { id: INBOX, entityDefinitionKey: 'inbox', name: 'Support', ownerUserId: null },
  ]
  orgCacheData.memberRoleMap = {
    owner1: { role: 'OWNER', seatType: 'full', userType: 'USER', permissionProfileId: null },
    admin1: { role: 'ADMIN', seatType: 'full', userType: 'USER', permissionProfileId: null },
    manager1: { role: 'USER', seatType: 'full', userType: 'USER', permissionProfileId: null },
    requester1: { role: 'USER', seatType: 'full', userType: 'USER', permissionProfileId: null },
    agent1: { role: 'USER', seatType: 'full', userType: 'AGENT', permissionProfileId: null },
  }
  orgCacheData.members = Object.keys(orgCacheData.memberRoleMap as Record<string, unknown>).map(
    (userId) => ({ userId })
  )

  mailVisibility.requester1 = vis('requester1', { inboxLens: { [INBOX]: 'metadata' } })
  mailVisibility.manager1 = vis('manager1', { inboxLens: { [INBOX]: 'full' } })
  capabilitiesByUser.requester1 = await fullSeatCaps(['inboxesView'])
})

// ═══════════════════════════════════════════════════════════════════════════════
// §3 — approver resolution
// ═══════════════════════════════════════════════════════════════════════════════

describe('resolveThreadApprovers (plan 42 §3)', () => {
  it('resolves inbox Managers as the primary audience', async () => {
    const { resolveThreadApprovers, loadThreadAuthorityContext } = await import(
      '../access-request-queries'
    )
    const { db } = makeFakeDb({
      threads: [THREAD_ROW],
      managerRowsByRecordId: { 'inbox:inbox-1': [{ granteeType: 'user', granteeId: 'manager1' }] },
    })
    const ctx = await loadThreadAuthorityContext(db as never, ORG, THREAD)
    const result = await resolveThreadApprovers(db as never, ORG, ctx!)

    expect(result.hasManagers).toBe(true)
    expect(result.primaryUserIds).toEqual(['manager1'])
    // Owners ride along as SILENT recovery approvers — in `userIds`, not primaries.
    expect(result.userIds).toContain('owner1')
    expect(result.primaryUserIds).not.toContain('owner1')
  })

  it('expands a GROUP-granted Manager through the shared expansion (§3.1)', async () => {
    const { resolveThreadApprovers, loadThreadAuthorityContext } = await import(
      '../access-request-queries'
    )
    const { db } = makeFakeDb({
      threads: [THREAD_ROW],
      managerRowsByRecordId: { 'inbox:inbox-1': [{ granteeType: 'group', granteeId: 'group-1' }] },
      groupMembers: [{ memberRefId: 'manager1' }],
    })
    const ctx = await loadThreadAuthorityContext(db as never, ORG, THREAD)
    const result = await resolveThreadApprovers(db as never, ORG, ctx!)
    expect(result.primaryUserIds).toEqual(['manager1'])
  })

  it('does NOT make an agent user an approver, even holding inbox admin (§3.1)', async () => {
    const { resolveThreadApprovers, loadThreadAuthorityContext } = await import(
      '../access-request-queries'
    )
    const { db } = makeFakeDb({
      threads: [THREAD_ROW],
      managerRowsByRecordId: { 'inbox:inbox-1': [{ granteeType: 'user', granteeId: 'agent1' }] },
    })
    const ctx = await loadThreadAuthorityContext(db as never, ORG, THREAD)
    const result = await resolveThreadApprovers(db as never, ORG, ctx!)

    expect(result.primaryUserIds).not.toContain('agent1')
    expect(result.userIds).not.toContain('agent1')
    // Dropping the only "Manager" must fall through to org admins, not to nobody —
    // an empty set would trip plan 28 §4.4's non-empty assertion.
    expect(result.hasManagers).toBe(false)
    expect(result.primaryUserIds).toEqual(expect.arrayContaining(['admin1', 'owner1']))
  })

  it('resolves a PERSONAL-INBOX thread to the mailbox owner’s Manager row (§3, plan-40 interaction)', async () => {
    const { resolveThreadApprovers, loadThreadAuthorityContext } = await import(
      '../access-request-queries'
    )
    // The mailbox lives on `personal_inbox`, so its `ResourceAccess` rows are keyed
    // by that slug. Hardcoding `toRecordId('inbox', …)` returns an EMPTY manager set.
    orgCacheData.inboxes = [
      {
        id: INBOX,
        entityDefinitionKey: 'personal_inbox',
        name: 'Sarah’s mailbox',
        ownerUserId: 'manager1',
      },
    ]
    const { db } = makeFakeDb({
      threads: [THREAD_ROW],
      managerRowsByRecordId: {
        // The rows live ONLY under the personal def — migration 060 re-keyed them.
        'personal_inbox:inbox-1': [{ granteeType: 'user', granteeId: 'manager1' }],
        'inbox:inbox-1': [],
      },
    })
    const ctx = await loadThreadAuthorityContext(db as never, ORG, THREAD)
    const result = await resolveThreadApprovers(db as never, ORG, ctx!)

    // The def must be RESOLVED, not assumed.
    expect(resolvedInboxRecordId).toBe('personal_inbox:inbox-1')
    expect(result.hasManagers).toBe(true)
    expect(result.primaryUserIds).toEqual(['manager1'])
  })

  it('falls back to org admins for a null-inboxId (triage) thread', async () => {
    const { resolveThreadApprovers, loadThreadAuthorityContext } = await import(
      '../access-request-queries'
    )
    const { db, calls } = makeFakeDb({
      threads: [{ ...THREAD_ROW, inboxId: null }],
      managerRowsByRecordId: { 'inbox:inbox-1': [{ granteeType: 'user', granteeId: 'manager1' }] },
    })
    const ctx = await loadThreadAuthorityContext(db as never, ORG, THREAD)
    const result = await resolveThreadApprovers(db as never, ORG, ctx!)

    expect(result.hasManagers).toBe(false)
    expect(result.primaryUserIds).toEqual(expect.arrayContaining(['admin1', 'owner1']))
    expect(result.userIds.length).toBeGreaterThan(0)
    // A null-inbox thread has no inbox to query Managers on at all.
    expect(calls.selects).not.toContain('managers')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §5.3 — the mail front door
// ═══════════════════════════════════════════════════════════════════════════════

describe('resolveThreadFrontDoor (plan 42 §5.3)', () => {
  it('opens for an ordinary member (MEMBER_BASELINE_LEVELS[inboxes] = Read)', async () => {
    const { resolveThreadFrontDoor } = await import('../access-request-queries')
    capabilitiesByUser.requester1 = await fullSeatCaps(['inboxesView'])
    expect(await resolveThreadFrontDoor(ORG, 'requester1')).toEqual({ open: true })
  })

  it('POSITIVE CONTROL: profile-None + one instance-derived key is still open', async () => {
    const { resolveThreadFrontDoor } = await import('../access-request-queries')
    const { PermissionKey } = await import('../../permissions/capabilities/registry')
    // `areaLevel(Area.inboxes)` is None here — `keys` is empty — but `can()` reads
    // `instanceDerivedKeys` too. Refusing from the area level rejects a VALID request.
    const caps = await fullSeatCaps([], 'full', ['inboxesView'])
    capabilitiesByUser.requester1 = caps
    expect(caps.can(PermissionKey.inboxesView)).toBe(true)
    expect(await resolveThreadFrontDoor(ORG, 'requester1')).toEqual({ open: true })
  })

  it('refuses a closed profile and names the profile lever', async () => {
    const { resolveThreadFrontDoor } = await import('../access-request-queries')
    capabilitiesByUser.requester1 = await fullSeatCaps([], 'full')
    expect(await resolveThreadFrontDoor(ORG, 'requester1')).toEqual({
      open: false,
      reason: 'front_door_closed',
    })
  })

  it('refuses a WORKER seat and names the SEAT, not the profile', async () => {
    const { resolveThreadFrontDoor } = await import('../access-request-queries')
    const { ACCESS_REFUSAL_COPY } = await import('../client')
    // `Area.inboxes` is absent from `WORKER_AREAS` and the seat ceiling clamps
    // LAST, so no permission change and no inbox row can lift this.
    capabilitiesByUser.requester1 = await fullSeatCaps([], 'worker')
    const result = await resolveThreadFrontDoor(ORG, 'requester1')
    expect(result).toEqual({ open: false, reason: 'worker_seat' })
    expect(ACCESS_REFUSAL_COPY.worker_seat).toMatch(/seat/i)
    expect(ACCESS_REFUSAL_COPY.worker_seat).not.toMatch(/profile/i)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §7 — subjectLabel
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildThreadSubjectLabel (plan 42 §7 / §6.2)', () => {
  it('shows the subject at `subject`+ lens', async () => {
    const { buildThreadSubjectLabel, loadThreadAuthorityContext } = await import(
      '../access-request-queries'
    )
    const { db } = makeFakeDb({ threads: [THREAD_ROW] })
    const ctx = await loadThreadAuthorityContext(db as never, ORG, THREAD)
    const label = await buildThreadSubjectLabel(ORG, ctx!, 'subject')
    expect(label).toBe('Support · Refund for order #4821')
  })

  it('degrades to inbox + participants + message count at `metadata`, never an empty subject', async () => {
    const { buildThreadSubjectLabel, loadThreadAuthorityContext } = await import(
      '../access-request-queries'
    )
    const { db } = makeFakeDb({ threads: [THREAD_ROW] })
    const ctx = await loadThreadAuthorityContext(db as never, ORG, THREAD)
    const label = await buildThreadSubjectLabel(ORG, ctx!, 'metadata')

    expect(label).toBe('Support · 2 participants · 4 messages')
    expect(label).not.toContain('Refund')
    expect(label.trim()).not.toBe('')
    expect(label).not.toMatch(/·\s*·/)
    expect(label).not.toMatch(/·\s*$/)
  })

  it('names an unassigned (null-inbox) thread rather than rendering a bare separator', async () => {
    const { buildThreadSubjectLabel, loadThreadAuthorityContext } = await import(
      '../access-request-queries'
    )
    const { db } = makeFakeDb({ threads: [{ ...THREAD_ROW, inboxId: null }] })
    const ctx = await loadThreadAuthorityContext(db as never, ORG, THREAD)
    const label = await buildThreadSubjectLabel(ORG, ctx!, 'metadata')
    expect(label.startsWith('Unassigned · ')).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §2.2 / §4.5 — creation, dedup, cooldown
// ═══════════════════════════════════════════════════════════════════════════════

describe('createThreadAccessRequest', () => {
  it('files a pending request with a 14-day expiry, both assignee arrays, and the slug def id', async () => {
    const { createThreadAccessRequest } = await import('../access-request-mutations')
    const { ACCESS_REQUEST_EXPIRY_DAYS } = await import('../client')
    const { db, calls } = makeFakeDb({
      threads: [THREAD_ROW],
      managerRowsByRecordId: { 'inbox:inbox-1': [{ granteeType: 'user', granteeId: 'manager1' }] },
      pendingRequest: null,
      insertReturning: [[{ id: 'req-new' }]],
    })

    const result = await createThreadAccessRequest(db as never, ORG, 'requester1', {
      threadId: THREAD,
    })
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().reRequested).toBe(false)

    const row = calls.inserts[0] as Record<string, unknown>
    expect(row.kind).toBe('access')
    expect(row.targetKind).toBe('instance')
    // Type-level guarantee of §2.3: there is no caller-supplied RecordId to
    // canonicalize, so the persisted def id is the literal slug.
    expect(row.entityDefinitionId).toBe('thread')
    expect(row.entityInstanceId).toBe(THREAD)
    expect(row.requestedLens).toBe('full')
    // H3 — both arrays are always written, never NULL.
    expect(Array.isArray(row.assigneeUsers)).toBe(true)
    expect(row.assigneeGroups).toEqual([])
    // H2 — always an expiry.
    const days = ((row.expiresAt as Date).getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(ACCESS_REQUEST_EXPIRY_DAYS - 0.1)
    expect(days).toBeLessThan(ACCESS_REQUEST_EXPIRY_DAYS + 0.1)
    // The label is server-built, never client input.
    expect(row.subjectLabel).toBe('Support · 2 participants · 4 messages')
  })

  it('notifies the primary approvers, not the owner recovery audience', async () => {
    const { createThreadAccessRequest } = await import('../access-request-mutations')
    const { db } = makeFakeDb({
      threads: [THREAD_ROW],
      managerRowsByRecordId: { 'inbox:inbox-1': [{ granteeType: 'user', granteeId: 'manager1' }] },
      pendingRequest: null,
      insertReturning: [[{ id: 'req-new' }]],
    })
    await createThreadAccessRequest(db as never, ORG, 'requester1', { threadId: THREAD })

    const notified = (sendNotification.mock.calls as unknown as Array<[{ userId: string }]>).map(
      (c) => c[0].userId
    )
    expect(notified).toEqual(['manager1'])
    expect((sendNotification.mock.calls as unknown as Array<[unknown]>)[0]![0]).toMatchObject({
      type: 'ACCESS_REQUESTED',
      targetType: 'APPROVAL',
      targetIds: { approvalRequestId: 'req-new' },
    })
  })

  it('DEDUPES a second identical ask: updates in place and re-notifies (§2.2 / §4.5)', async () => {
    const { createThreadAccessRequest } = await import('../access-request-mutations')
    const { db, calls } = makeFakeDb({
      threads: [THREAD_ROW],
      managerRowsByRecordId: { 'inbox:inbox-1': [{ granteeType: 'user', granteeId: 'manager1' }] },
      pendingRequest: { id: 'req-1', metadata: { remindCount: 1 }, message: 'please' },
    })

    const result = await createThreadAccessRequest(db as never, ORG, 'requester1', {
      threadId: THREAD,
    })
    expect(result._unsafeUnwrap()).toMatchObject({ requestId: 'req-1', reRequested: true })
    expect(calls.inserts).toHaveLength(0)

    const patch = calls.updates[0] as { metadata: { remindedAt: string; remindCount: number } }
    expect(patch.metadata.remindCount).toBe(2)
    expect(typeof patch.metadata.remindedAt).toBe('string')
    expect(sendNotification).toHaveBeenCalledTimes(1)
  })

  it('two RACING identical creates yield ONE pending row and no leaked unique-index error', async () => {
    const { createThreadAccessRequest } = await import('../access-request-mutations')
    // The loser's `ON CONFLICT DO NOTHING` returns no row; the follow-up read then
    // finds the winner's row and the ask becomes a re-notify.
    let pending: Record<string, unknown> | null = null
    const base = makeFakeDb({
      threads: [THREAD_ROW],
      managerRowsByRecordId: { 'inbox:inbox-1': [{ granteeType: 'user', granteeId: 'manager1' }] },
      insertReturning: [[{ id: 'req-winner' }], []],
    })
    base.db.query.ApprovalRequest.findFirst = async () => pending

    const first = await createThreadAccessRequest(base.db as never, ORG, 'requester1', {
      threadId: THREAD,
    })
    expect(first._unsafeUnwrap()).toMatchObject({ requestId: 'req-winner', reRequested: false })
    pending = { id: 'req-winner', metadata: {}, message: null }

    const second = await createThreadAccessRequest(base.db as never, ORG, 'requester1', {
      threadId: THREAD,
    })
    expect(second.isOk()).toBe(true)
    expect(second._unsafeUnwrap()).toMatchObject({ requestId: 'req-winner', reRequested: true })
    // Exactly one insert attempt produced a row.
    expect(base.calls.inserts).toHaveLength(1)
  })

  it('blocks a re-ask inside the 7-day DENY COOLDOWN (§4.5)', async () => {
    const { createThreadAccessRequest } = await import('../access-request-mutations')
    const { db, calls } = makeFakeDb({
      threads: [THREAD_ROW],
      managerRowsByRecordId: { 'inbox:inbox-1': [{ granteeType: 'user', granteeId: 'manager1' }] },
      pendingRequest: null,
      deniedRows: [{ createdAt: new Date(), metadata: { deniedAt: new Date().toISOString() } }],
    })
    const result = await createThreadAccessRequest(db as never, ORG, 'requester1', {
      threadId: THREAD,
    })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/recently declined/i)
    expect(calls.inserts).toHaveLength(0)
  })

  it('allows the ask once the cooldown window has elapsed', async () => {
    const { createThreadAccessRequest } = await import('../access-request-mutations')
    const { ACCESS_DENY_COOLDOWN_DAYS } = await import('../client')
    const old = new Date(Date.now() - (ACCESS_DENY_COOLDOWN_DAYS + 1) * 86_400_000)
    const { db, calls } = makeFakeDb({
      threads: [THREAD_ROW],
      managerRowsByRecordId: { 'inbox:inbox-1': [{ granteeType: 'user', granteeId: 'manager1' }] },
      pendingRequest: null,
      deniedRows: [{ createdAt: old, metadata: { deniedAt: old.toISOString() } }],
      insertReturning: [[{ id: 'req-new' }]],
    })
    const result = await createThreadAccessRequest(db as never, ORG, 'requester1', {
      threadId: THREAD,
    })
    expect(result.isOk()).toBe(true)
    expect(calls.inserts).toHaveLength(1)
  })

  it('refuses a WORKER-seat requester at creation, naming the seat (§5.3)', async () => {
    const { createThreadAccessRequest } = await import('../access-request-mutations')
    capabilitiesByUser.requester1 = await fullSeatCaps([], 'worker')
    const { db, calls } = makeFakeDb({
      threads: [THREAD_ROW],
      managerRowsByRecordId: { 'inbox:inbox-1': [{ granteeType: 'user', granteeId: 'manager1' }] },
      pendingRequest: null,
    })
    const result = await createThreadAccessRequest(db as never, ORG, 'requester1', {
      threadId: THREAD,
    })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/seat/i)
    expect(calls.inserts).toHaveLength(0)
  })

  it('refuses a requester who already holds `full` — nothing to ask for', async () => {
    const { createThreadAccessRequest } = await import('../access-request-mutations')
    mailVisibility.requester1 = vis('requester1', { threadGrants: { [THREAD]: 'full' } })
    const { db, calls } = makeFakeDb({
      threads: [THREAD_ROW],
      managerRowsByRecordId: { 'inbox:inbox-1': [{ granteeType: 'user', granteeId: 'manager1' }] },
      pendingRequest: null,
    })
    const result = await createThreadAccessRequest(db as never, ORG, 'requester1', {
      threadId: THREAD,
    })
    expect(result.isErr()).toBe(true)
    expect(calls.inserts).toHaveLength(0)
  })

  it('refuses a cross-org / missing thread without probing further', async () => {
    const { createThreadAccessRequest } = await import('../access-request-mutations')
    const { db, calls } = makeFakeDb({ threads: [] })
    const result = await createThreadAccessRequest(db as never, ORG, 'requester1', {
      threadId: 'foreign-thread',
    })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/no longer available/i)
    expect(calls.inserts).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §4.2 — the decision handler
// ═══════════════════════════════════════════════════════════════════════════════

const ACCESS_ROW = {
  id: 'req-1',
  organizationId: ORG,
  kind: 'access' as const,
  status: 'approved',
  subjectLabel: 'Support · 2 participants · 4 messages',
  targetKind: 'instance',
  entityDefinitionId: 'thread',
  entityInstanceId: THREAD,
  requesterId: 'requester1',
  metadata: {},
}

describe('applyAccessDecision (plan 42 §4.2)', () => {
  it('APPROVE grants through the shared funnel with origin=approval, never a direct row', async () => {
    const { applyAccessDecision } = await import('../access-request-mutations')
    const { db, calls } = makeFakeDb({ threads: [THREAD_ROW] })

    const out = await applyAccessDecision({
      tx: db,
      request: ACCESS_ROW as never,
      approverUserId: 'manager1',
      action: 'approve',
    })

    expect(grantInstanceAccess).toHaveBeenCalledTimes(1)
    const [ctx, input] = grantInstanceAccess.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ]
    expect(ctx).toMatchObject({ organizationId: ORG, userId: 'manager1' })
    expect(input).toMatchObject({
      recordId: `thread:${THREAD}`,
      granteeType: 'user',
      granteeId: 'requester1',
      permission: 'view',
      lens: 'full',
      // §8 — suppresses the generic MESSAGE_SHARED so the requester is not told a
      // teammate "shared" the thing they asked for.
      origin: 'approval',
      // Module guide §8 — the grant row is transactional, its cache emits are not.
      deferEmits: true,
    })

    const patch = calls.updates.at(-1) as Record<string, unknown>
    expect(patch).toMatchObject({ grantedLevel: 'view', grantedLens: 'full' })

    await out.afterCommit?.(db as never)
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ACCESS_REQUEST_DECIDED',
        userId: 'requester1',
        targetType: 'APPROVAL',
      })
    )
  })

  /**
   * The deferred-emit contract (module guide §8 / plan 42 §4.2). Two separate
   * failures this pins, both silent:
   *
   *  - **Emits inside the transaction.** `grantInstanceAccess` busts the cache and
   *    publishes `capabilities:changed` itself. Called with the decision `tx` and
   *    WITHOUT `deferEmits`, that fires while the grant row is invisible to every
   *    other connection, so a reader racing the commit repopulates the requester's
   *    blob from PRE-grant state — the exact "stale blob after approval" §4.2
   *    warns about. Asserting `deferEmits: true` on the call is not enough: the
   *    flush must actually be invoked, or the cache is never busted at all.
   *  - **`afterCommit` closing over `tx`.** It runs after commit, when `tx` is a
   *    released handle. The resolve path only *warns* when `afterCommit` throws,
   *    so the requester's decided-notification would vanish with no error — and
   *    since `origin: 'approval'` suppresses `MESSAGE_SHARED`, they would be told
   *    nothing at all. Hence `afterCommit` takes the outer `db`.
   */
  it('defers cache emits out of the transaction and flushes them before notifying', async () => {
    const { applyAccessDecision } = await import('../access-request-mutations')
    const { db } = makeFakeDb({ threads: [THREAD_ROW] })

    const order: string[] = []
    flushEmits.mockImplementation(async () => {
      order.push('flush')
    })
    sendNotification.mockImplementation(async () => {
      order.push('notify')
      return {}
    })

    const out = await applyAccessDecision({
      tx: db,
      request: ACCESS_ROW as never,
      approverUserId: 'manager1',
      action: 'approve',
    })

    // Still inside the transaction as far as the handler is concerned: the grant
    // row is written, the emits are NOT.
    expect(grantInstanceAccess).toHaveBeenCalledTimes(1)
    expect(flushEmits).not.toHaveBeenCalled()

    // A DIFFERENT handle than the one the grant ran on — proving the closure does
    // not reach for the released `tx`.
    const outerDb = { marker: 'outer' }
    notificationDbs.length = 0
    await out.afterCommit?.(outerDb as never)

    expect(flushEmits).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['flush', 'notify'])
    // THE assertion, not `sendNotification` having been called: the notification
    // must be written through the handle `afterCommit` was GIVEN. Closing over
    // `tx` still "sends" one here, because the mock does not care — but in
    // production that handle is released and the send throws into a warn.
    expect(notificationDbs).toEqual([outerDb])
    expect(notificationDbs).not.toContain(db)
  })

  it('revalidates the ACTING APPROVER on approve — a removed Manager gets 403 and NO grant', async () => {
    const { applyAccessDecision } = await import('../access-request-mutations')
    const { ForbiddenError } = await import('../../errors')
    assertCanManageMailSharing.mockRejectedValueOnce(
      new ForbiddenError('Only admins or inbox managers can share this conversation') as never
    )
    const { db } = makeFakeDb({ threads: [THREAD_ROW] })

    await expect(
      applyAccessDecision({
        tx: db,
        request: ACCESS_ROW as never,
        approverUserId: 'manager1',
        action: 'approve',
      })
    ).rejects.toThrow(/inbox managers/i)

    // The whole point: the stale assignee snapshot did not become authorization.
    expect(grantInstanceAccess).not.toHaveBeenCalled()
  })

  it('revalidates on DENY too — a removed Manager cannot block it either', async () => {
    const { applyAccessDecision } = await import('../access-request-mutations')
    const { ForbiddenError } = await import('../../errors')
    assertCanManageMailSharing.mockRejectedValueOnce(new ForbiddenError('nope') as never)
    const { db, calls } = makeFakeDb({ threads: [THREAD_ROW] })

    await expect(
      applyAccessDecision({
        tx: db,
        request: ACCESS_ROW as never,
        approverUserId: 'manager1',
        action: 'deny',
      })
    ).rejects.toThrow()
    expect(calls.updates).toHaveLength(0)
  })

  it('asserts with the ACTING approver’s identity, not the requester’s', async () => {
    const { applyAccessDecision } = await import('../access-request-mutations')
    const { db } = makeFakeDb({ threads: [THREAD_ROW] })
    await applyAccessDecision({
      tx: db,
      request: ACCESS_ROW as never,
      approverUserId: 'owner1',
      action: 'approve',
    })
    expect(assertCanManageMailSharing).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG, userId: 'owner1' }),
      `thread:${THREAD}`
    )
  })

  it('DENY records deniedAt, which is what the cooldown window is measured from', async () => {
    const { applyAccessDecision } = await import('../access-request-mutations')
    const { db, calls } = makeFakeDb({ threads: [THREAD_ROW] })
    await applyAccessDecision({
      tx: db,
      request: ACCESS_ROW as never,
      approverUserId: 'manager1',
      action: 'deny',
    })
    expect(grantInstanceAccess).not.toHaveBeenCalled()
    const patch = calls.updates[0] as { metadata: { deniedAt?: string; decidedById?: string } }
    expect(typeof patch.metadata.deniedAt).toBe('string')
    expect(patch.metadata.decidedById).toBe('manager1')
  })

  it('SUPERSEDES rather than re-granting when the requester already reached `full` (§5.1)', async () => {
    const { applyAccessDecision } = await import('../access-request-mutations')
    // Access arrived by another route between filing and Accept. Asserted on the
    // requester's CURRENT composed lens — NOT a fold of the proposed grant, which
    // `thread-grant` + `maxLens` make unconditionally `full` for everyone.
    mailVisibility.requester1 = vis('requester1', { inboxLens: { [INBOX]: 'full' } })
    const { db, calls } = makeFakeDb({ threads: [THREAD_ROW] })

    const out = await applyAccessDecision({
      tx: db,
      request: ACCESS_ROW as never,
      approverUserId: 'manager1',
      action: 'approve',
    })

    expect(grantInstanceAccess).not.toHaveBeenCalled()
    expect(calls.updates[0]).toMatchObject({ status: 'superseded' })
    expect(out.message).toMatch(/already have full access/i)
  })

  it('RAISE-ONLY: a requester at `subject` via a group grant is raised, not replaced', async () => {
    const { applyAccessDecision } = await import('../access-request-mutations')
    const { maxLens } = await import('../../permissions/visibility/lens')
    mailVisibility.requester1 = vis('requester1', { inboxLens: { [INBOX]: 'subject' } })
    const { db } = makeFakeDb({ threads: [THREAD_ROW] })

    await applyAccessDecision({
      tx: db,
      request: ACCESS_ROW as never,
      approverUserId: 'manager1',
      action: 'approve',
    })
    // Not superseded — sub-full is a real ask — and the grant widens.
    expect(grantInstanceAccess).toHaveBeenCalledTimes(1)
    // `maxLens` is the mechanism, not `stripInertNoneLevels`.
    expect(maxLens('subject', 'full')).toBe('full')
    expect(maxLens('full', 'subject')).toBe('full')
  })

  it('refuses the decision when the target thread is gone or cross-org (§4.2 step 1)', async () => {
    const { applyAccessDecision } = await import('../access-request-mutations')
    const { db } = makeFakeDb({ threads: [] })
    await expect(
      applyAccessDecision({
        tx: db,
        request: ACCESS_ROW as never,
        approverUserId: 'manager1',
        action: 'approve',
      })
    ).rejects.toThrow(/no longer available/i)
    expect(grantInstanceAccess).not.toHaveBeenCalled()
  })

  it('refuses to grant access the requester could not use (front door re-checked at Accept)', async () => {
    const { applyAccessDecision } = await import('../access-request-mutations')
    capabilitiesByUser.requester1 = await fullSeatCaps([], 'worker')
    const { db } = makeFakeDb({ threads: [THREAD_ROW] })
    await expect(
      applyAccessDecision({
        tx: db,
        request: ACCESS_ROW as never,
        approverUserId: 'manager1',
        action: 'approve',
      })
    ).rejects.toThrow(/seat/i)
    expect(grantInstanceAccess).not.toHaveBeenCalled()
  })

  it('refuses a lane it does not own rather than writing a mail-shaped grant', async () => {
    const { applyAccessDecision } = await import('../access-request-mutations')
    const { db } = makeFakeDb({ threads: [THREAD_ROW] })
    await expect(
      applyAccessDecision({
        tx: db,
        request: { ...ACCESS_ROW, targetKind: 'area', entityDefinitionId: null } as never,
        approverUserId: 'manager1',
        action: 'approve',
      })
    ).rejects.toThrow(/not supported/i)
    expect(grantInstanceAccess).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §4.5 — withdraw
// ═══════════════════════════════════════════════════════════════════════════════

describe('withdrawAccessRequest', () => {
  it('withdraws the requester’s own pending request', async () => {
    const { withdrawAccessRequest } = await import('../access-request-mutations')
    const { db, calls } = makeFakeDb({ updateReturning: [[{ id: 'req-1' }]] })
    const result = await withdrawAccessRequest(db as never, ORG, 'requester1', 'req-1')
    expect(result.isOk()).toBe(true)
    expect(calls.updates[0]).toMatchObject({ status: 'withdrawn' })
    expect(deleteNotificationsByTarget).toHaveBeenCalled()
  })

  it('refuses when the scoped UPDATE claims nothing (someone else’s row, or not pending)', async () => {
    const { withdrawAccessRequest } = await import('../access-request-mutations')
    const { db } = makeFakeDb({ updateReturning: [[]] })
    const result = await withdrawAccessRequest(db as never, ORG, 'requester1', 'req-1')
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/no pending request/i)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §6.2 — the server preflight
// ═══════════════════════════════════════════════════════════════════════════════

describe('preflightThreadAccessRequest (plan 42 §6.2)', () => {
  it('returns eligibility plus safe approver display names from the member CACHE', async () => {
    const { preflightThreadAccessRequest } = await import('../access-request-queries')
    const { db } = makeFakeDb({
      threads: [THREAD_ROW],
      managerRowsByRecordId: { 'inbox:inbox-1': [{ granteeType: 'user', granteeId: 'manager1' }] },
      pendingRequest: null,
    })
    const result = await preflightThreadAccessRequest(db as never, ORG, 'requester1', THREAD)

    expect(result.eligible).toBe(true)
    expect(result.currentLens).toBe('metadata')
    expect(result.pending).toBeNull()
    expect(result.approvers).toEqual([{ userId: 'manager1', name: 'Name manager1', image: null }])
    expect(result.refusalReason).toBeNull()
  })

  it('reports the pending request rather than refusing, so the trigger can swap (§6.4)', async () => {
    const { preflightThreadAccessRequest } = await import('../access-request-queries')
    const created = new Date()
    const { db } = makeFakeDb({
      threads: [THREAD_ROW],
      managerRowsByRecordId: { 'inbox:inbox-1': [{ granteeType: 'user', granteeId: 'manager1' }] },
      pendingRequest: { id: 'req-1', createdAt: created, metadata: { remindedAt: null } },
    })
    const result = await preflightThreadAccessRequest(db as never, ORG, 'requester1', THREAD)
    expect(result.eligible).toBe(true)
    expect(result.pending).toMatchObject({ id: 'req-1', createdAt: created })
  })

  it('refuses a full-lens viewer with `already_full`', async () => {
    const { preflightThreadAccessRequest } = await import('../access-request-queries')
    mailVisibility.requester1 = vis('requester1', { inboxLens: { [INBOX]: 'full' } })
    const { db } = makeFakeDb({
      threads: [THREAD_ROW],
      managerRowsByRecordId: { 'inbox:inbox-1': [{ granteeType: 'user', granteeId: 'manager1' }] },
      pendingRequest: null,
    })
    const result = await preflightThreadAccessRequest(db as never, ORG, 'requester1', THREAD)
    expect(result).toMatchObject({ eligible: false, refusalReason: 'already_full' })
  })

  it('refuses a missing / cross-org thread with `target_unavailable`', async () => {
    const { preflightThreadAccessRequest } = await import('../access-request-queries')
    const { db } = makeFakeDb({ threads: [] })
    const result = await preflightThreadAccessRequest(db as never, ORG, 'requester1', 'nope')
    expect(result).toMatchObject({ eligible: false, refusalReason: 'target_unavailable' })
  })
})
