// apps/web/src/server/api/routers/mail-instance-access.test.ts

import fs from 'node:fs'
import path from 'node:path'
import { ResourceGranteeType, type Rung } from '@auxx/database/enums'
import type { OrganizationRole, SeatType } from '@auxx/database/types'
import { isGoverningInstanceRow } from '@auxx/lib/cache/providers/governing-instance-ids-provider'
import { PermissionKey } from '@auxx/lib/permissions/capabilities/registry'
import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_ROOT } from '../../../test/app-root'

/**
 * Plan 40 phase 3 — the enforcement surface, driven for real.
 *
 * Three claims, in the order they are easiest to get wrong:
 *
 *  1. **The mail front door exists at all.** Before this slice every procedure
 *     in `thread.ts` was a bare `protectedProcedure` with no `PermissionKey`
 *     anywhere in the file (§0.1), so no profile could express "this member has
 *     no mail access" and a worker seat read and replied to every org inbox.
 *     Every `thread.*` procedure now gates on `inboxes.view` and **nothing
 *     finer** — there is no thread-authority axis (§1.1), and no inbox-instance
 *     assert may appear on a thread procedure (§1.4).
 *  2. **§5.5's live 403.** Applying a tag from a thread's Tags field
 *     (`fieldValue.set`) 403'd with "You don't have permission to edit these
 *     records" while the *same* tag on the *same* thread applied fine from the
 *     bulk toolbar (`thread.tagBulk`). Two surfaces, two authorities. They must
 *     now agree in BOTH directions — allowed together, denied together.
 *  3. **`resourceAccess.grantInstance` on an inbox routes to
 *     `assertAdminInstance`** (§5.3) *without* losing the Enterprise
 *     `granularPermissions` plan gate, which §2 lists as out of scope.
 *
 * **The positive controls are the point** (§12): the repo's discipline is
 * denial-shaped and structurally blind to OVER-denial, and the single most
 * likely way to break mail here is to add an inbox-instance gate that looks
 * correct and silently denies every dispatch-org assignee. The block named
 * "positive controls" must pass, and the dispatch case asserts explicitly that
 * an instance gate *would* have denied it.
 *
 * Behavioral, not source-text: the real router modules are imported and driven
 * through tRPC callers, `ctx.capabilities` is a **real** `CapabilitySet`, and
 * `assertCanActOnThreads` is the **real shared** lib helper (the one
 * `ThreadMutationService` delegates to — `packages/lib/src/threads/__tests__/
 * thread-action-access.test.ts` pins that half). Only the lens computation
 * itself is stubbed: it is question 4, out of scope, and already tested.
 */

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'

/** The org's `thread` def, as the FE mints it: a CUID, never the `'thread'` slug. */
const THREAD_DEF_ID = 'edf_threadcuid0000000000000'
const INBOX_DEF_ID = 'edf_inboxcuid00000000000000'
const CONTACT_DEF_ID = 'edf_contactcuid000000000000'

const THREAD_ID = 'thr_cuid00000000000000000a'
const OTHER_THREAD_ID = 'thr_cuid00000000000000000b'
const INBOX_ID = 'ibx_cuid00000000000000000a'
const OTHER_INBOX_ID = 'ibx_cuid00000000000000000b'
const CONTACT_ID = 'cnt_cuid00000000000000000a'
const TAG_RECORD_ID = 'tag:tag_cuid0000000000000000'

/** As `use-thread-tags.ts` builds it — `useResource('thread').entityDefinitionId`. */
const THREAD_RECORD_ID = `${THREAD_DEF_ID}:${THREAD_ID}`
const INBOX_RECORD_ID = `inbox:${INBOX_ID}`
const CONTACT_RECORD_ID = `${CONTACT_DEF_ID}:${CONTACT_ID}`

/**
 * The ONE row `InboxService.createInbox` writes: the creator's Manager grant.
 * Every inbox in every org carries one, which is why the pre-2026-07-29 "carries
 * ≥1 row ⇒ restricted" reading 403'd every non-creator admin. It is deliberately
 * NOT a governing row — see `isGoverningInstanceRow`.
 */
const CREATOR_ROW = {
  instanceId: INBOX_ID,
  granteeType: ResourceGranteeType.user,
  granteeId: 'usr_creator',
  rung: 'admin',
}

const { lensFixture, getThreadLensBatch } = vi.hoisted(() => {
  const lensFixture: { lenses: Record<string, string> } = { lenses: {} }
  const build = async (_db: unknown, _org: string, _v: unknown, ids: string[]) => {
    const map = new Map<string, string>()
    for (const id of ids) map.set(id, lensFixture.lenses[id] ?? 'none')
    return map
  }
  return { lensFixture, getThreadLensBatch: vi.fn(build) }
})

// The lens computation is question 4 (§2, untouched). Stubbing it here lets each
// case name a lens directly; `assertCanActOnThreads` around it stays REAL.
vi.mock('@auxx/lib/permissions/visibility/thread-lens', () => ({
  getThreadLensBatch,
  getThreadLens: vi.fn(),
}))

const { mail, cache, fieldValueService, resourceAccess, isAdminOrOwner, recordAuditFromCtx } =
  vi.hoisted(() => ({
    mail: {
      listThreadIds: vi.fn(async () => ({ ids: [], nextCursor: null })),
      getThreadMetaBatch: vi.fn(async () => []),
      sendMessage: vi.fn(async () => ({ id: 'msg_1', threadId: 'thr_1', sendStatus: 'SENT' })),
      tagThreadsBulk: vi.fn(async () => ({ created: 1, skipped: 0, errors: [] })),
      threadUpdate: vi.fn(async () => ({ id: 'thr_1', success: true, updatedFields: {} })),
      remove: vi.fn(async () => ({ id: 'thr_1', success: true, updatedFields: {} })),
      removeBulk: vi.fn(async () => ({ count: 1 })),
      getMailCounts: vi.fn(async () => ({})),
      findScheduledMessagesByThreadId: vi.fn(async () => []),
    },
    cache: {
      getCachedUserInstanceGrants: vi.fn(),
      getCachedResources: vi.fn(),
      getCachedEntityDefId: vi.fn(async () => null),
      getCachedPermissionProfiles: vi.fn(async () => []),
    },
    fieldValueService: {
      setValueWithBuiltIn: vi.fn(async () => ({ state: 'complete', values: [] })),
      applyBulk: vi.fn(async () => ({ updated: 1 })),
      deleteValue: vi.fn(async () => undefined),
      addValue: vi.fn(async () => ({ id: 'fv_1' })),
      removeValue: vi.fn(async () => undefined),
      addValues: vi.fn(async () => []),
      removeValues: vi.fn(async () => undefined),
    },
    resourceAccess: {
      grantInstanceAccess: vi.fn(async () => undefined),
      setInstanceAccess: vi.fn(async () => undefined),
      revokeInstanceAccess: vi.fn(async () => true),
      grantTypeAccess: vi.fn(async () => undefined),
      setTypeAccess: vi.fn(async () => undefined),
      revokeTypeAccess: vi.fn(async () => true),
      getInstanceAccess: vi.fn(async () => []),
      getTypeAccess: vi.fn(async () => []),
      getAllInstanceAccess: vi.fn(async () => []),
      getAllTypeAccess: vi.fn(async () => []),
      assertCanManageMailSharing: vi.fn(async () => undefined),
      assertCanManageMailTypeAccess: vi.fn(async () => undefined),
      assertMailSharingFeature: vi.fn(async () => undefined),
      isMailSharingDef: vi.fn((d: string) =>
        ['inbox', 'personal_inbox', 'thread', 'contact'].includes(d)
      ),
    },
    isAdminOrOwner: vi.fn(async () => false),
    recordAuditFromCtx: vi.fn(async () => undefined),
  }))

/**
 * `@auxx/lib/threads` is stubbed for the SERVICES (they reach db/redis/realtime),
 * but `assertCanActOnThreads` is re-exported from the REAL module — it is the
 * shared predicate under test, and a stub would make §5.5's whole claim vacuous.
 *
 * `ThreadMutationService.tagThreadsBulk` reproduces the ONE property this file
 * rests on: the real service's first statement is
 * `await this.assertCanActOnThreads(recordIds.map(parse))`
 * (`thread-mutation.service.ts`). It calls the same exported helper with the same
 * arguments, so the bulk-toolbar arm of the §5.5 pairing runs the real gate.
 * That the shipped service really delegates like this is pinned separately, with
 * the real class, in the lib test named above.
 */
vi.mock('@auxx/lib/threads', async () => {
  const real = await import('@auxx/lib/threads/thread-action-access')
  class ThreadQueryService {
    listThreadIds = mail.listThreadIds
    getThreadMetaBatch = mail.getThreadMetaBatch
  }
  class ThreadMutationService {
    constructor(
      private organizationId: string,
      private db: unknown,
      _socketId: unknown,
      _userId: unknown,
      private viewer: never
    ) {}
    async tagThreadsBulk(recordIds: string[], related: string[], op: string) {
      await real.assertCanActOnThreads(
        this.db as never,
        this.organizationId,
        this.viewer,
        recordIds.map((r) => r.split(':')[1] as string)
      )
      return mail.tagThreadsBulk(recordIds as never, related as never, op as never)
    }
    async update(recordId: string, updates: unknown) {
      await real.assertCanActOnThreads(this.db as never, this.organizationId, this.viewer, [
        recordId.split(':')[1] as string,
      ])
      return mail.threadUpdate(recordId as never, updates as never)
    }
    remove = mail.remove
    removeBulk = mail.removeBulk
  }
  return {
    assertCanActOnThreads: real.assertCanActOnThreads,
    ThreadQueryService,
    ThreadMutationService,
    ThreadMergeService: class {
      unmergeBatch = vi.fn(async () => undefined)
    },
    UnreadService: class {
      setReadStatus = vi.fn(async () => undefined)
    },
    getMailCounts: mail.getMailCounts,
    canLinkThread: vi.fn(async () => true),
    linkEntityToThread: vi.fn(async () => undefined),
    returnThreadToAi: vi.fn(async () => ({ isErr: () => false, value: {} })),
    takeOverThread: vi.fn(async () => ({ isErr: () => false, value: {} })),
  }
})

vi.mock('@auxx/lib/cache', () => cache)
vi.mock('@auxx/lib/field-values', () => ({
  FieldValueService: class {
    setValueWithBuiltIn = fieldValueService.setValueWithBuiltIn
    applyBulk = fieldValueService.applyBulk
    deleteValue = fieldValueService.deleteValue
    addValue = fieldValueService.addValue
    removeValue = fieldValueService.removeValue
    addValues = fieldValueService.addValues
    removeValues = fieldValueService.removeValues
    batchGetValues = vi.fn(async () => ({}))
  },
}))
vi.mock('@auxx/lib/resource-access', () => resourceAccess)
vi.mock('@auxx/lib/members', () => ({ isAdminOrOwner }))
vi.mock('~/server/api/audit-context', () => ({ recordAuditFromCtx }))
vi.mock('~/server/lib/signature-instance-access', () => ({
  assertSignatureUsable: vi.fn(async () => undefined),
}))
vi.mock('@auxx/lib/drafts', () => ({
  DraftService: class {
    markAsSent = vi.fn()
  },
}))
vi.mock('@auxx/lib/email', () => ({ getUserOrganizationId: () => ORG_ID }))
vi.mock('@auxx/lib/mail-schedule', () => ({
  cancelScheduledMessage: vi.fn(async () => null),
  createScheduledMessage: vi.fn(async () => ({ id: 's1' })),
  enqueueScheduledMessageJob: vi.fn(async () => 'job'),
  findPendingByDraftId: vi.fn(async () => null),
  findScheduledMessagesByThreadId: mail.findScheduledMessagesByThreadId,
  updateScheduledMessage: vi.fn(async () => null),
  updateScheduledMessageStatus: vi.fn(async () => undefined),
}))
vi.mock('@auxx/lib/messages', () => ({
  MessageSenderService: class {
    sendMessage = mail.sendMessage
    retryFailedMessage = vi.fn(async () => ({ success: true, attemptNumber: 1 }))
  },
}))
vi.mock('@auxx/lib/money', () => ({
  markInvoiceSent: vi.fn(),
  markQuoteSent: vi.fn(),
  recordDocumentSendSignal: vi.fn(),
}))
vi.mock('@auxx/lib/placeholders', () => ({
  buildPlaceholderContextForThread: vi.fn(async () => ({})),
  resolvePlaceholdersInHtml: vi.fn(async (h: string) => h),
}))
vi.mock('@auxx/lib/providers', () => ({ ProviderRegistryService: class {} }))
vi.mock('@auxx/logger', async () => (await import('~/test/logger-mock')).mockAuxxLogger())

/**
 * The `@auxx/lib/permissions` barrel reaches redis/db at import time and hangs
 * under vitest. Hand back the REAL registry, the REAL instance-access map (it is
 * what makes `inbox`/`personal_inbox` instance-access targets at all) and the
 * REAL `buildDefIdToSlug` — the def→slug resolution is the half of §5.5 that a
 * naive `=== 'thread'` test would get wrong. Only capability resolution and the
 * plan service are stubbed.
 */
const { getCapabilities, featureService } = vi.hoisted(() => ({
  getCapabilities: vi.fn(),
  featureService: { requireAccess: vi.fn(async () => undefined) },
}))

vi.mock('@auxx/lib/permissions', async () => {
  const instanceAccess = await import('@auxx/lib/permissions/capabilities/instance-access')
  const registry = await import('@auxx/lib/permissions/capabilities/registry')
  const resolve = await import('@auxx/lib/permissions/capabilities/resolve-capability-inputs')
  const types = await import('@auxx/lib/permissions/types')
  return {
    ...instanceAccess,
    PermissionKey: registry.PermissionKey,
    buildDefIdToSlug: resolve.buildDefIdToSlug,
    FeatureKey: types.FeatureKey,
    FeaturePermissionService: class {
      requireAccess = featureService.requireAccess
      requireAccessAndLimit = featureService.requireAccess
      requireLimit = featureService.requireAccess
    },
    getCapabilities,
  }
})

/**
 * The `permissionProcedure` stand-in mirrors the REAL builder's gate: a plain
 * `capabilities.assert(key)`. Kept in lockstep with `trpc.ts`; only the plan-AND
 * (`inboxes.view` carries no `featureKey`, so it is a no-op here) and the
 * `getCapabilities` read are dropped, since ctx carries the set already. So the
 * coarse rung on the BUILDER is under test — deleting
 * `permissionProcedure(inboxesView)` from `thread.ts` fails the whole first block.
 */
// Plan v3/03 §5.3 — the record-host branch now gets a SECOND chance after the
// def gate refuses: the row is stamped through the read path and re-judged
// against `_access`. These tests exercise the DENIAL, so the stamped read
// returns nothing, which is the non-enumeration contract's strongest denial
// ("an id the read path hid must not pass the write path"). Mocked at the
// picker rather than at the gate so the gate's own logic still runs.
vi.mock('@auxx/lib/resources/picker/record-picker-service', () => ({
  RecordPickerService: class {
    async getResourcesByIds() {
      return {}
    }
  },
}))

vi.mock('~/server/api/trpc', async () => {
  const { initTRPC } = await import('@trpc/server')
  const { AuxxError } = await import('@auxx/lib/errors')
  const t = initTRPC.context<Record<string, unknown>>().create()
  return {
    // The REAL predicate: `thread.ts`'s `handleServiceError` uses it to let an
    // AuxxError through untouched instead of flattening it to a 500 (plan 44).
    isAuxxError: (error: unknown) =>
      error instanceof AuxxError ||
      (error instanceof Error && typeof (error as { statusCode?: number }).statusCode === 'number'),
    createTRPCRouter: t.router,
    capabilityProcedure: t.procedure,
    protectedProcedure: t.procedure,
    permissionProcedure: (key: string) =>
      t.procedure.use(({ ctx, next }) => {
        ;(ctx as { capabilities: { assert: (k: string) => void } }).capabilities.assert(key)
        return next()
      }),
    notDemo:
      () =>
      ({ next }: { next: () => unknown }) =>
        next(),
  }
})

// Deep path on purpose: the barrel hangs, and `CapabilitySet` is not on the
// client-safe subpath. Test files are excluded from apps/web's tsconfig.
const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { threadRouter } = await import('./thread')
const { fieldValueRouter } = await import('./fieldValue')
const { resourceAccessRouter } = await import('./resourceAccess')

/**
 * The asserts throw `AuxxError` (never `TRPCError`); tRPC wraps it as `cause`,
 * and in the app `auxxErrorMiddleware` + `errorFormatter` map it onto the status
 * asserted here. Asserting the STATUS, not merely "it rejected" — a denial that
 * surfaces as a 500 is a different and worse outcome.
 */
const FORBIDDEN = { cause: { name: 'ForbiddenError', statusCode: 403 } }

/** What the org `resources` cache projects, as `buildDefIdToSlug` reads it. */
const RESOURCES = [
  { id: 'res_thread', apiSlug: 'threads', entityDefinitionId: THREAD_DEF_ID, entityType: 'thread' },
  { id: 'res_inbox', apiSlug: 'inboxes', entityDefinitionId: INBOX_DEF_ID, entityType: 'inbox' },
  {
    id: 'res_contact',
    apiSlug: 'contacts',
    entityDefinitionId: CONTACT_DEF_ID,
    entityType: 'contact',
  },
]

interface CapsOpts {
  role?: OrganizationRole
  seatType?: SeatType
  /** `Area.inboxes` level. Defaults to `Level.Read` — the seeded Member baseline. */
  inboxes?: Level
  /** `Area.records` level. Defaults to `Level.Edit` — the seeded Member baseline. */
  records?: Level
  /** Explicit `ResourceAccess` instance rows reaching this member. */
  instances?: Record<string, Rung>
  /** Read-rung keys the composer SYNTHESIZES from instance grants (front door only). */
  derivedKeys?: PermissionKey[]
  /**
   * EVERY instance-level `ResourceAccess` row the ORG holds, whoever the grantee
   * is. The `governingInstanceIds` set is derived from these through the SAME
   * `isGoverningInstanceRow` predicate the cache provider uses, so a case built
   * this way exercises the real filter rather than restating its answer.
   *
   * Omit it and the set defaults to this member's own row ids — the right default
   * for every pre-existing case here, all of which author a baseline or a
   * restriction. Pass it for the case that distinguishes SHARING from
   * RESTRICTING: `InboxService.createInbox` writes its creator a `user @ admin`
   * row, which must not govern.
   */
  orgRows?: Array<{
    instanceId: string
    granteeType: ResourceGranteeType
    granteeId: string
    rung: Rung
  }>
}

function capabilitiesFor(opts: CapsOpts = {}) {
  const instances = opts.instances ?? {}
  const governing = opts.orgRows
    ? opts.orgRows.filter(isGoverningInstanceRow).map((row) => row.instanceId)
    : Object.keys(instances)
  const toSlug = (id: string) =>
    RESOURCES.find((r) => r.id === id || r.apiSlug === id || r.entityDefinitionId === id)
      ?.entityType ?? id
  return new CapabilitySet(
    new Set(
      expandLevelsToKeys({
        [Area.inboxes]: opts.inboxes ?? Level.Read,
        [Area.records]: opts.records ?? Level.Edit,
      })
    ),
    {},
    opts.role ?? 'MEMBER',
    opts.seatType ?? 'full',
    toSlug,
    undefined,
    toSlug,
    instances,
    new Set(governing),
    {},
    new Set(opts.derivedKeys ?? [])
  )
}

type Caps = InstanceType<typeof CapabilitySet>

function ctxFor(capabilities: Caps, db: unknown = {}) {
  return {
    db,
    capabilities,
    headers: new Headers(),
    session: {
      organizationId: ORG_ID,
      userId: USER_ID,
      user: { id: USER_ID, defaultOrganizationId: ORG_ID },
    },
  } as never
}

const threads = (c: Caps, db?: unknown) => threadRouter.createCaller(ctxFor(c, db))
const fields = (c: Caps, db?: unknown) => fieldValueRouter.createCaller(ctxFor(c, db))
const sharing = (c: Caps) => resourceAccessRouter.createCaller(ctxFor(c))

/** A plain member viewer — no admin short-circuit, no grants of its own. */
const VIEWER = {
  userId: USER_ID,
  role: 'MEMBER',
  isAdmin: false,
  isMailAdmin: false,
  inboxLens: {},
  personalInboxIds: {},
  grants: {},
}

/**
 * A representative slice of `thread.*` — read, batch read, counts, send, tag,
 * update, delete and a scheduled-message read. The gate is one middleware, so
 * one case per SHAPE is enough here; exhaustiveness over all 20 procedures is
 * pinned structurally at the bottom of the file.
 */
const THREAD_CALLS = [
  ['listIds', (c: ReturnType<typeof threads>) => c.listIds({ filter: [], limit: 50 })],
  ['getByIds', (c: ReturnType<typeof threads>) => c.getByIds({ ids: [THREAD_ID] })],
  ['getCounts', (c: ReturnType<typeof threads>) => c.getCounts()],
  [
    'sendMessage',
    (c: ReturnType<typeof threads>) =>
      c.sendMessage({ integrationId: 'int_1', threadId: THREAD_ID, to: [] }),
  ],
  [
    'tagBulk',
    (c: ReturnType<typeof threads>) =>
      c.tagBulk({
        recordIds: [THREAD_RECORD_ID as never],
        relatedRecordIds: [TAG_RECORD_ID as never],
      }),
  ],
  [
    'update',
    (c: ReturnType<typeof threads>) =>
      c.update({ recordId: THREAD_RECORD_ID as never, updates: { status: 'ARCHIVED' } }),
  ],
  [
    'getScheduledMessages',
    (c: ReturnType<typeof threads>) => c.getScheduledMessages({ threadId: THREAD_ID }),
  ],
] as const

beforeEach(() => {
  // `mockReset()`, not `mockClear()` — a `mockResolvedValueOnce` queue survives
  // `mockClear` and shifts every later value, which makes a mutated source line
  // look caught when it is not.
  getThreadLensBatch.mockReset()
  getThreadLensBatch.mockImplementation(async (_d, _o, _v, ids: string[]) => {
    const map = new Map<string, string>()
    for (const id of ids) map.set(id, lensFixture.lenses[id] ?? 'none')
    return map
  })
  lensFixture.lenses = { [THREAD_ID]: 'read', [OTHER_THREAD_ID]: 'read' }

  for (const fn of Object.values(mail)) fn.mockClear()
  for (const fn of Object.values(fieldValueService)) fn.mockClear()
  for (const fn of Object.values(resourceAccess)) fn.mockClear()

  cache.getCachedUserInstanceGrants.mockReset()
  cache.getCachedUserInstanceGrants.mockResolvedValue(VIEWER as never)
  cache.getCachedResources.mockReset()
  cache.getCachedResources.mockResolvedValue(RESOURCES as never)
  cache.getCachedEntityDefId.mockResolvedValue(null as never)
  cache.getCachedPermissionProfiles.mockResolvedValue([] as never)

  getCapabilities.mockReset()
  isAdminOrOwner.mockReset()
  isAdminOrOwner.mockResolvedValue(false as never)
  recordAuditFromCtx.mockReset()
  recordAuditFromCtx.mockResolvedValue(undefined as never)
  featureService.requireAccess.mockReset()
  featureService.requireAccess.mockResolvedValue(undefined as never)
})

// ═══════════════════════════════════════════════════════════════════════════
// 1. The front door
// ═══════════════════════════════════════════════════════════════════════════

describe('thread router — the mail front door (§5.3)', () => {
  it.each(THREAD_CALLS)('%s is REFUSED at inboxes: None', async (_name, call) => {
    await expect(call(threads(capabilitiesFor({ inboxes: Level.None })))).rejects.toMatchObject(
      FORBIDDEN
    )
    // The middleware answered — no service was constructed, no lens was read.
    expect(getThreadLensBatch).not.toHaveBeenCalled()
    expect(cache.getCachedUserInstanceGrants).not.toHaveBeenCalled()
  })

  it.each(THREAD_CALLS)('%s is permitted at the Member baseline (Read)', async (_n, call) => {
    await expect(call(threads(capabilitiesFor()))).resolves.toBeDefined()
  })

  it.each(THREAD_CALLS)('%s is permitted at inboxes: Full too', async (_n, call) => {
    await expect(call(threads(capabilitiesFor({ inboxes: Level.Full })))).resolves.toBeDefined()
  })

  it('a WORKER seat holds no mail key at all — `inboxes` is outside WORKER_AREAS (§7)', async () => {
    // The §0.1 consequence being fixed: with no area, `SEAT_CEILINGS` had nothing
    // to clamp, so a field tech read and replied to every org inbox at
    // `defaultLens: 'read'`. `expandLevelsToKeys` is fed an unclamped level here
    // on purpose — the ceiling is what must produce the denial.
    const caps = capabilitiesFor({ seatType: 'worker', inboxes: Level.Full })
    // The key set itself is composed upstream; what this file can pin is that a
    // worker seat's ceiling on `Area.inboxes` is None, which zeroes every rung.
    const { SEAT_CEILINGS } = await import('@auxx/lib/permissions/capabilities/seat-policy')
    expect(SEAT_CEILINGS.worker[Area.inboxes]).toBe(Level.None)
    // …and that a member without the key is refused, whatever their seat.
    await expect(
      threads(capabilitiesFor({ seatType: 'worker', inboxes: Level.None })).getCounts()
    ).rejects.toMatchObject(FORBIDDEN)
    expect(caps.areaLevel(Area.inboxes)).toBe(Level.Full)
  })

  it('no thread procedure consults the inbox instance layer (§1.4)', async () => {
    // The structural half of the dispatch guarantee: a member whose ONLY inbox
    // row is an explicit `none` still reaches every thread surface, because no
    // thread procedure asks `canViewInstance('inbox', …)` at all.
    const caps = capabilitiesFor({ instances: { [INBOX_ID]: 'none' } })
    expect(caps.canViewInstance('inbox', INBOX_ID)).toBe(false)
    for (const [, call] of THREAD_CALLS) {
      await expect(call(threads(caps))).resolves.toBeDefined()
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. §5.5 — the generic field-value write path
// ═══════════════════════════════════════════════════════════════════════════

/** The two surfaces from §5.5's table, applying the same tag to the same thread. */
const TAG_FROM_FIELD = (c: Caps) =>
  fields(c).set({ recordId: THREAD_RECORD_ID, fieldId: 'thread:thread_tags', value: [] })
const TAG_FROM_BULK_BAR = (c: Caps) =>
  threads(c).tagBulk({
    recordIds: [THREAD_RECORD_ID as never],
    relatedRecordIds: [TAG_RECORD_ID as never],
  })

describe('§5.5 — the Tags field and the bulk toolbar must AGREE', () => {
  it('both ALLOWED for a baseline member at `full` lens (the live 403, fixed)', async () => {
    // This is the repro. Before the fix `fieldValue.set` asserted
    // `assertEditEntity('thread')` → no `ENTITY_WRITE_KEYS['thread']` →
    // `records.edit`, so a member without org-wide Records: Edit got
    // "You don't have permission to edit these records" from the field while the
    // bulk bar worked. `records: None` here proves the records layer is no longer
    // consulted for a thread host.
    const caps = capabilitiesFor({ records: Level.None })
    expect(caps.canEditEntity(THREAD_DEF_ID)).toBe(false)
    await expect(TAG_FROM_FIELD(caps)).resolves.toBeDefined()
    await expect(TAG_FROM_BULK_BAR(caps)).resolves.toBeDefined()
    expect(fieldValueService.setValueWithBuiltIn).toHaveBeenCalledTimes(1)
    expect(mail.tagThreadsBulk).toHaveBeenCalledTimes(1)
  })

  it('both DENIED at inboxes: None — the front door closes both surfaces', async () => {
    // `records: Full` on purpose: the records area must not be a way back in.
    const caps = capabilitiesFor({ inboxes: Level.None, records: Level.Full })
    await expect(TAG_FROM_FIELD(caps)).rejects.toMatchObject(FORBIDDEN)
    await expect(TAG_FROM_BULK_BAR(caps)).rejects.toMatchObject(FORBIDDEN)
    expect(fieldValueService.setValueWithBuiltIn).not.toHaveBeenCalled()
    expect(mail.tagThreadsBulk).not.toHaveBeenCalled()
  })

  it.each(['metadata', 'identity', 'none'])('both DENIED at a `%s` lens', async (lens) => {
    lensFixture.lenses = { [THREAD_ID]: lens }
    const caps = capabilitiesFor({ records: Level.Full })
    await expect(TAG_FROM_FIELD(caps)).rejects.toMatchObject(FORBIDDEN)
    await expect(TAG_FROM_BULK_BAR(caps)).rejects.toMatchObject(FORBIDDEN)
    expect(fieldValueService.setValueWithBuiltIn).not.toHaveBeenCalled()
    expect(mail.tagThreadsBulk).not.toHaveBeenCalled()
  })

  it('the front door is checked BEFORE the thread row is read', async () => {
    // Ordering, not just outcome: a lens read on a member who may not use mail
    // would leak "this thread exists in an inbox you cannot see" through timing
    // and through the error shape.
    await expect(TAG_FROM_FIELD(capabilitiesFor({ inboxes: Level.None }))).rejects.toMatchObject(
      FORBIDDEN
    )
    expect(getThreadLensBatch).not.toHaveBeenCalled()
  })

  it('the def part is resolved by SLUG — a CUID-keyed thread RecordId is not missed', async () => {
    // `use-thread-tags.ts` mints `toRecordId(useResource('thread').entityDefinitionId, id)`,
    // i.e. the def CUID. A literal `=== 'thread'` branch would fall through to the
    // records gate and reproduce the exact bug this slice fixes.
    expect(THREAD_RECORD_ID.startsWith('thread:')).toBe(false)
    lensFixture.lenses = { [THREAD_ID]: 'metadata' }
    await expect(TAG_FROM_FIELD(capabilitiesFor({ records: Level.Full }))).rejects.toMatchObject(
      FORBIDDEN
    )
    expect(getThreadLensBatch).toHaveBeenCalledTimes(1)
  })
})

describe('§5.5 — every fieldValue write procedure is branched', () => {
  const db = {
    select: () => ({
      from: () => ({
        where: async () => [{ entityDefinitionId: THREAD_DEF_ID, entityId: THREAD_ID }],
      }),
    }),
  }

  const WRITES = [
    [
      'set',
      (c: Caps) =>
        fields(c, db).set({ recordId: THREAD_RECORD_ID, fieldId: 'thread:thread_tags', value: [] }),
    ],
    [
      'setBulk',
      (c: Caps) =>
        fields(c, db).setBulk({
          recordIds: [THREAD_RECORD_ID],
          values: [{ fieldId: 'thread:thread_tags', value: [] }],
        }),
    ],
    [
      'delete',
      (c: Caps) =>
        fields(c, db).delete({ recordId: THREAD_RECORD_ID, fieldId: 'thread:thread_tags' }),
    ],
    [
      'add',
      (c: Caps) =>
        fields(c, db).add({
          recordId: THREAD_RECORD_ID,
          fieldId: 'thread:thread_tags',
          fieldType: 'RELATIONSHIP',
          value: { type: 'relationship', recordId: TAG_RECORD_ID as never },
        }),
    ],
    // `remove` carries only a value id, so its host is resolved from the row —
    // and the INSTANCE is load-bearing now, not just the def.
    ['remove', (c: Caps) => fields(c, db).remove({ valueId: 'fv_1' })],
  ] as const

  it.each(WRITES)('%s is refused on a thread host at a sub-`read` lens', async (_n, call) => {
    lensFixture.lenses = { [THREAD_ID]: 'identity' }
    await expect(call(capabilitiesFor({ records: Level.Full }))).rejects.toMatchObject(FORBIDDEN)
  })

  it.each(WRITES)('%s is refused on a thread host at inboxes: None', async (_n, call) => {
    await expect(
      call(capabilitiesFor({ inboxes: Level.None, records: Level.Full }))
    ).rejects.toMatchObject(FORBIDDEN)
  })

  it.each(
    WRITES
  )('%s succeeds on a thread host at `full` lens with records: None', async (_n, c) => {
    await expect(c(capabilitiesFor({ records: Level.None }))).resolves.toBeDefined()
  })
})

describe('§5.5 — the other two host kinds are untouched / newly gated', () => {
  it('a NON-mail host still takes the records gate, unchanged', async () => {
    const editable = capabilitiesFor({ records: Level.Edit })
    await expect(
      fields(editable).set({
        recordId: CONTACT_RECORD_ID,
        fieldId: 'contact:email',
        value: 'a@b.c',
      })
    ).resolves.toBeDefined()

    // …and is still refused below it. Mail levels are irrelevant to a contact.
    const readOnly = capabilitiesFor({ records: Level.Read, inboxes: Level.Full })
    await expect(
      fields(readOnly).set({
        recordId: CONTACT_RECORD_ID,
        fieldId: 'contact:email',
        value: 'a@b.c',
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(getThreadLensBatch).not.toHaveBeenCalled()
  })

  it('an INBOX host takes assertAdminInstance — settings are the Manager’s (§5.3)', async () => {
    const manager = capabilitiesFor({
      instances: { [INBOX_ID]: 'admin' },
      records: Level.None,
    })
    await expect(
      fields(manager).set({
        recordId: `${INBOX_DEF_ID}:${INBOX_ID}`,
        fieldId: 'inbox:inbox_name',
        value: 'Support',
      })
    ).resolves.toBeDefined()

    // The same 403 as the sharing case, on the OTHER `assertAdminInstance` call
    // site: a default org ADMIN editing the settings of an inbox they did not
    // create. The creator's row does not govern, so the `inboxes: Full` fallback
    // supplies `admin`.
    const admin = capabilitiesFor({
      role: 'ADMIN',
      inboxes: Level.Full,
      instances: {},
      orgRows: [CREATOR_ROW],
      records: Level.None,
    })
    await expect(
      fields(admin).set({
        recordId: `${INBOX_DEF_ID}:${INBOX_ID}`,
        fieldId: 'inbox:inbox_name',
        value: 'Support',
      })
    ).resolves.toBeDefined()

    // A `view` grantee works the inbox but does not own its settings.
    const worker = capabilitiesFor({
      instances: { [INBOX_ID]: 'read' },
      records: Level.Full,
    })
    await expect(
      fields(worker).set({
        recordId: `${INBOX_DEF_ID}:${INBOX_ID}`,
        fieldId: 'inbox:inbox_name',
        value: 'Support',
      })
    ).rejects.toMatchObject(FORBIDDEN)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. Sharing an inbox
// ═══════════════════════════════════════════════════════════════════════════

describe('resourceAccess.grantInstance on an inbox (§5.3)', () => {
  const share = (rung: Rung = 'read') =>
    sharing(capabilitiesFor()).grantInstance({
      recordId: INBOX_RECORD_ID,
      granteeType: ResourceGranteeType.user,
      granteeId: 'usr_grantee',
      rung,
    })

  it('routes to assertAdminInstance, NOT to assertCanManageMailSharing', async () => {
    getCapabilities.mockResolvedValue(capabilitiesFor({ instances: { [INBOX_ID]: 'admin' } }))
    await expect(share()).resolves.toEqual({ success: true })
    expect(resourceAccess.assertCanManageMailSharing).not.toHaveBeenCalled()
    expect(resourceAccess.grantInstanceAccess).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_ID }),
      expect.objectContaining({ recordId: INBOX_RECORD_ID })
    )
  })

  it('a default org ADMIN manages an inbox they did not create (the live 403)', async () => {
    // THE REGRESSION `governingInstanceIds` fixes, proved at the ROUTER rather
    // than in the resolver: `authorizeInstanceTarget` routes inbox targets to
    // `capabilities.assertAdminInstance`, and because EVERY inbox carries the
    // creator's `user @ admin` row from `InboxService.createInbox`, the old
    // "carries ≥1 row ⇒ restricted" set denied every admin who was not that
    // creator. `inbox-form.tsx` shows the Access section to a rank-ADMIN, so this
    // was reachable from the UI and 403'd on submit.
    //
    // No own row (`instances: {}`), and the org's only row is the creator's —
    // which `isGoverningInstanceRow` rejects — so `inboxes: Full` falls back to
    // `admin`. Neither the router nor `createInbox` is touched by the fix; this
    // asserts they were already correct.
    getCapabilities.mockResolvedValue(
      capabilitiesFor({
        role: 'ADMIN',
        inboxes: Level.Full,
        instances: {},
        orgRows: [CREATOR_ROW],
      })
    )
    await expect(share()).resolves.toEqual({ success: true })
    expect(resourceAccess.grantInstanceAccess).toHaveBeenCalled()
  })

  it('…but inboxes: Read is still not manage authority on that same inbox', async () => {
    // The other half: the fallback maps Read → `view`, which is working access,
    // not Manager. Without this the case above would pass on a resolver that had
    // simply stopped gating.
    getCapabilities.mockResolvedValue(
      capabilitiesFor({ inboxes: Level.Read, instances: {}, orgRows: [CREATOR_ROW] })
    )
    await expect(share()).rejects.toMatchObject(FORBIDDEN)
    expect(resourceAccess.grantInstanceAccess).not.toHaveBeenCalled()
  })

  it('a `role:org_member @ none` baseline still refuses a non-granted ADMIN', () => {
    // Restriction survives the narrowing: an authored baseline DOES govern, so an
    // admin holding no row of their own is denied — plan 40 §4.2's whole point.
    const admin = capabilitiesFor({
      role: 'ADMIN',
      inboxes: Level.Full,
      instances: {},
      orgRows: [
        CREATOR_ROW,
        {
          instanceId: INBOX_ID,
          granteeType: ResourceGranteeType.role,
          granteeId: 'org_member',
          rung: 'none',
        },
      ],
    })
    expect(admin.canAdminInstance('inbox', INBOX_ID)).toBe(false)
    expect(admin.canViewInstance('inbox', INBOX_ID)).toBe(false)
  })

  it('a `profile @ none` row the resolver cannot expand still refuses an ADMIN', () => {
    // The `none` half of the filter, on a grantee kind that never reaches
    // `instanceAccess` (plan 19 §8.2): only the org-wide governing set can deny
    // here, so this is the case that keeps that set from being redundant.
    const admin = capabilitiesFor({
      role: 'ADMIN',
      inboxes: Level.Full,
      instances: {},
      orgRows: [
        CREATOR_ROW,
        {
          instanceId: INBOX_ID,
          granteeType: ResourceGranteeType.profile,
          granteeId: 'prof_support',
          rung: 'none',
        },
      ],
    })
    expect(admin.canViewInstance('inbox', INBOX_ID)).toBe(false)
    expect(admin.canAdminInstance('inbox', INBOX_ID)).toBe(false)
  })

  it('one `view` row opens exactly that inbox for a member at inboxes: None', () => {
    // Own-row-first at the router: the inbox carries the creator's row plus this
    // member's share, and NEITHER governs. Before the fix the resolver only read
    // a member's own row for instances in the set, so on a non-governed instance
    // it fell through to the area — `None` — and the share was inert.
    const shared = capabilitiesFor({
      inboxes: Level.None,
      records: Level.None,
      instances: { [INBOX_ID]: 'read' },
      derivedKeys: [PermissionKey.inboxesView],
      orgRows: [
        CREATOR_ROW,
        {
          instanceId: INBOX_ID,
          granteeType: ResourceGranteeType.user,
          granteeId: 'usr_me',
          rung: 'read',
        },
      ],
    })
    expect(shared.canViewInstance('inbox', INBOX_ID)).toBe(true)
    // …and nothing else in the org.
    expect(shared.canViewInstance('inbox', OTHER_INBOX_ID)).toBe(false)
    expect(shared.canAdminInstance('inbox', INBOX_ID)).toBe(false)
  })

  it('a member with inboxes: Read but no admin row on a RESTRICTED inbox is refused', async () => {
    getCapabilities.mockResolvedValue(capabilitiesFor({ instances: { [INBOX_ID]: 'read' } }))
    await expect(share()).rejects.toMatchObject(FORBIDDEN)
    expect(resourceAccess.grantInstanceAccess).not.toHaveBeenCalled()
  })

  it('inboxes: None cannot share even a row-less inbox', async () => {
    getCapabilities.mockResolvedValue(capabilitiesFor({ inboxes: Level.None }))
    await expect(share()).rejects.toMatchObject(FORBIDDEN)
    expect(resourceAccess.grantInstanceAccess).not.toHaveBeenCalled()
  })

  it('the granularPermissions plan gate SURVIVES the reroute (§2)', async () => {
    // `authorizeInstanceTarget` answering `true` used to skip the plan gate along
    // with the authorizer, which would have handed free-plan orgs sub-`full` lens
    // shares and new Managers. §2 lists that gate as out of scope, so it runs on
    // its own line regardless of which authorizer answered.
    getCapabilities.mockResolvedValue(capabilitiesFor({ instances: { [INBOX_ID]: 'admin' } }))
    await share('identity')
    expect(resourceAccess.assertMailSharingFeature).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_ID }),
      INBOX_RECORD_ID,
      [expect.objectContaining({ rung: 'identity' })]
    )
  })

  it('a denied plan gate blocks the write even for a Manager', async () => {
    getCapabilities.mockResolvedValue(capabilitiesFor({ instances: { [INBOX_ID]: 'admin' } }))
    resourceAccess.assertMailSharingFeature.mockRejectedValueOnce(
      Object.assign(new Error('upgrade'), { name: 'ForbiddenError', statusCode: 403 })
    )
    await expect(share('admin')).rejects.toMatchObject(FORBIDDEN)
    expect(resourceAccess.grantInstanceAccess).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. POSITIVE CONTROLS (§12) — the cases that must PASS
// ═══════════════════════════════════════════════════════════════════════════

describe('positive controls — over-denial is the failure mode this slice risks', () => {
  it('a DISPATCH-ORG ASSIGNEE reads and replies from a floor-`none` inbox', async () => {
    // The controller/dispatch pattern (§1.4): the shared inbox is floored at
    // `none` with a `role:org_member @ none` row, a controller assigns threads,
    // and each member works only what is assigned to them. The assignee holds NO
    // row on that inbox by construction, and assignment confers `full` lens.
    //
    // An inbox-instance assert on any thread surface would deny them — which is
    // exactly why §1.4 forbids one. The first expectation below is the proof
    // that such a gate would have bitten.
    const assignee = capabilitiesFor({
      inboxes: Level.Read, // the seeded Member baseline (§7)
      records: Level.None, // and no records authority whatsoever
      instances: { [INBOX_ID]: 'none' },
    })
    expect(assignee.canViewInstance('inbox', INBOX_ID)).toBe(false)

    lensFixture.lenses = { [THREAD_ID]: 'read' } // assignment ⇒ read

    await expect(threads(assignee).listIds({ filter: [], limit: 50 })).resolves.toBeDefined()
    await expect(threads(assignee).getByIds({ ids: [THREAD_ID] })).resolves.toBeDefined()
    await expect(
      threads(assignee).sendMessage({ integrationId: 'int_1', threadId: THREAD_ID, to: [] })
    ).resolves.toBeDefined()
    await expect(
      threads(assignee).update({
        recordId: THREAD_RECORD_ID as never,
        updates: { status: 'ARCHIVED' },
      })
    ).resolves.toBeDefined()
    await expect(TAG_FROM_FIELD(assignee)).resolves.toBeDefined()
    await expect(TAG_FROM_BULK_BAR(assignee)).resolves.toBeDefined()
  })

  it('a member at area None with ONE explicit inbox `view` row gets in — and sees only it', async () => {
    // Plan 25 §2 / `INSTANCE_ACCESS_READ_KEYS`: `composeUserCapabilities`
    // synthesizes the area's Read rung from the member's instance grants, so the
    // front door opens for them even though `areaLevel(inboxes)` is None. The
    // derived key is a FRONT DOOR — never an instance answer, which the last two
    // expectations pin.
    const single = capabilitiesFor({
      inboxes: Level.None,
      records: Level.None,
      instances: { [INBOX_ID]: 'read' },
      derivedKeys: [PermissionKey.inboxesView],
    })
    expect(single.areaLevel(Area.inboxes)).toBe(Level.None)
    expect(single.can(PermissionKey.inboxesView)).toBe(true)

    await expect(threads(single).listIds({ filter: [], limit: 50 })).resolves.toBeDefined()
    await expect(threads(single).getCounts()).resolves.toBeDefined()

    expect(single.canViewInstance('inbox', INBOX_ID)).toBe(true)
    expect(single.canViewInstance('inbox', OTHER_INBOX_ID)).toBe(false)
    // …and the front door alone is not manage authority.
    expect(single.can(PermissionKey.inboxesManage)).toBe(false)
  })

  it('an inbox MANAGER who is not an admin manages that inbox’s access', async () => {
    // The delegation case: a plain MEMBER at the baseline, holding one `admin`
    // instance row (what `createInbox` writes its creator). `isAdminOrOwner` is
    // false throughout, so nothing here rides on rank.
    const manager = capabilitiesFor({
      instances: { [INBOX_ID]: 'admin' },
      records: Level.None,
    })
    expect(manager.role).toBe('MEMBER')
    getCapabilities.mockResolvedValue(manager)

    await expect(
      sharing(manager).grantInstance({
        recordId: INBOX_RECORD_ID,
        granteeType: ResourceGranteeType.user,
        granteeId: 'usr_teammate',
        rung: 'read',
      })
    ).resolves.toEqual({ success: true })

    // …but not the inbox NEXT DOOR. Scoped to the exact instance.
    await expect(
      sharing(manager).grantInstance({
        recordId: `inbox:${OTHER_INBOX_ID}`,
        granteeType: ResourceGranteeType.user,
        granteeId: 'usr_teammate',
        rung: 'read',
      })
    ).rejects.toMatchObject(FORBIDDEN)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. Structural invariants
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The behavioral blocks run against a stubbed `~/server/api/trpc`, so they cannot
 * see a downgrade of the procedure BUILDER itself — and this router's pre-plan-40
 * state was exactly that: twenty bare `protectedProcedure`s. Pin it in source,
 * the same idiom as `snippet-instance-access.test.ts`.
 */
describe('thread router — structural invariants', () => {
  const src = fs.readFileSync(path.resolve(APP_ROOT, 'src/server/api/routers/thread.ts'), 'utf8')

  const PROCEDURES = [
    'cancelScheduledMessage',
    'getByIds',
    'getCounts',
    'getScheduledMessages',
    'linkToTicket',
    'listEvents',
    'listIds',
    'rememberThread',
    'remove',
    'removeBulk',
    'retrySendMessage',
    'returnToAi',
    'sendMessage',
    'takeOver',
    'tagBulk',
    'unlinkFromTicket',
    'unmergeBatch',
    'update',
    'updateBulk',
    'updateScheduledMessage',
  ]

  it('the front door is the inboxes Read rung, declared once', () => {
    expect(src).toContain('permissionProcedure(PermissionKey.inboxesView)')
  })

  it('every procedure builds on it — no bare protectedProcedure survives', () => {
    for (const name of PROCEDURES) {
      expect(src, `${name} must build on the mail front door`).toContain(`${name}: mailProcedure`)
    }
    // Matched with the colon: the file's doc comment names `protectedProcedure`
    // when explaining what these used to be.
    expect(src).not.toContain(': protectedProcedure')
    expect(src).not.toContain(': publicProcedure')
  })

  it('the procedure list is exhaustive — a NEW thread procedure must be gated too', () => {
    const declared = [...src.matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9]*): mailProcedure/gm)].map(
      (m) => m[1] as string
    )
    expect(declared.sort()).toEqual([...PROCEDURES].sort())
  })

  it('no thread procedure reaches for the inbox instance layer (§1.4)', () => {
    // The rule with the quietest failure mode: an instance assert here reads as
    // defence-in-depth and silently breaks every dispatch org.
    expect(src).not.toContain('canViewInstance')
    expect(src).not.toContain('assertViewInstance')
    expect(src).not.toContain('assertAdminInstance')
    expect(src).not.toContain('instanceListScope')
  })
})

describe('page guards (§5.3)', () => {
  const read = (p: string) => fs.readFileSync(path.resolve(APP_ROOT, p), 'utf8')

  it('/app/mail is guarded on inboxes.view, at the LAYOUT', () => {
    // On the layout, not the index page: every nested mailbox route
    // (`inboxes/…`, `personal/…`, `views/…`, a deep-linked thread URL) must
    // inherit it.
    const src = read('src/app/(protected)/app/mail/layout.tsx')
    expect(src).toContain('CapabilityPageGuard')
    expect(src).toContain("permissionKey='inboxes.view'")
  })

  it('settings/channels is guarded on channels.manage, like settings/inbox', () => {
    const src = read('src/app/(protected)/app/settings/channels/page.tsx')
    expect(src).toContain('CapabilityPageGuard')
    expect(src).toContain("permissionKey='channels.manage'")
  })
})
