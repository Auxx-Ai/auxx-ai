// apps/web/src/server/api/routers/mail-router-front-door.test.ts

import fs from 'node:fs'
import path from 'node:path'
import { ResourcePermission } from '@auxx/database/enums'
import type { OrganizationRole, SeatType } from '@auxx/database/types'
import { PermissionKey } from '@auxx/lib/permissions/capabilities/registry'
import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 40 phase 3 — the FOUR routers §5.3's table never enumerated.
 *
 * §5.3 names "ALL `thread.*` procedures" and phase 3 gated those (plus
 * `draft.*`, closed as gap 1 in `mail-gap-closures.test.ts`). Three more mail
 * surfaces were left on bare `protectedProcedure`s with no `PermissionKey`
 * anywhere in the file:
 *
 *  - **`mailView.ts`** — ten procedures, including **`getThreads`**: a paginated
 *    thread-reading surface with no door at all.
 *  - **`message.ts`** — `getByIds` / `listByThread`, the message bodies
 *    themselves. Content was lens-gated (both construct a
 *    `MessageQueryService` from the caller's `UserInstanceGrants`); the *area*
 *    question was simply unanswerable.
 *  - **`participant.ts`** — `getByIds` / `ensureContact`.
 *
 * A fourth, `attachment.ts`, is **deliberately not** on the mail key: it is the
 * generic `FIELD_VALUE` attachment path, so a mail gate would over-deny every
 * non-mail record. It takes plan 40 §5.5's per-host gate instead, and the last
 * block is the over-denial control that proves it.
 *
 * Behavioral, with a **real** `CapabilitySet` — the `@auxx/lib/permissions`
 * barrel hangs under vitest, so every permissions import is a deep one.
 */

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'

const THREAD_ID = 'thr_cuid00000000000000000a'
const INBOX_ID = 'ibx_cuid00000000000000000a'
const OTHER_INBOX_ID = 'ibx_cuid00000000000000000b'
const VIEW_ID = 'mvw_cuid00000000000000000a'
const MESSAGE_ID = 'msg_cuid00000000000000000a'
const PARTICIPANT_ID = 'prt_cuid00000000000000000a'
const ATTACHMENT_ID = 'att_cuid00000000000000000a'
const FIELD_VALUE_ID = 'fvl_cuid00000000000000000a'
const CONTACT_ID = 'cnt_cuid00000000000000000a'

const INBOX_DEF_ID = 'edf_inboxcuid00000000000000'
const CONTACT_DEF_ID = 'edf_contactcuid000000000000'
const THREAD_DEF_ID = 'edf_threadcuid00000000000000'

// ─────────────────────────────────────────────────────────────────────────────
// Doubles
// ─────────────────────────────────────────────────────────────────────────────

const {
  mailViewService,
  messageQuery,
  participantService,
  ensureContactForParticipant,
  attachmentService,
  cache,
  onCacheEvent,
  assertCanActOnThreads,
  getCapabilities,
} = vi.hoisted(() => ({
  mailViewService: {
    createMailView: vi.fn(async () => ({ id: VIEW_ID })),
    getMailView: vi.fn(async () => MAIL_VIEW_ROW()),
    getUserMailViews: vi.fn(async () => [MAIL_VIEW_ROW()]),
    getSharedMailViews: vi.fn(async () => [MAIL_VIEW_ROW()]),
    updateMailView: vi.fn(async () => MAIL_VIEW_ROW()),
    deleteMailView: vi.fn(async () => ({ success: true })),
    setMailViewAsDefault: vi.fn(async () => MAIL_VIEW_ROW()),
    toggleMailViewPinned: vi.fn(async () => MAIL_VIEW_ROW()),
    getThreadsByMailView: vi.fn(async () => ({ threads: [], total: 0 })),
  },
  messageQuery: {
    getMessageMetaBatch: vi.fn(async () => [{ id: MESSAGE_ID }]),
    getMessagesByThread: vi.fn(async () => [{ id: MESSAGE_ID }]),
  },
  participantService: {
    getParticipantMetaBatch: vi.fn(async () => [{ id: PARTICIPANT_ID }]),
  },
  ensureContactForParticipant: vi.fn(async () => ({
    entityInstanceId: CONTACT_ID,
    created: true,
  })),
  attachmentService: {
    create: vi.fn(async () => ({ id: ATTACHMENT_ID })),
    delete: vi.fn(async () => undefined),
    get: vi.fn(async () => null),
  },
  cache: {
    getCachedUserInstanceGrants: vi.fn(),
    getCachedResources: vi.fn(),
  },
  onCacheEvent: vi.fn(async () => undefined),
  assertCanActOnThreads: vi.fn(async () => undefined),
  getCapabilities: vi.fn(),
}))

function MAIL_VIEW_ROW() {
  return { id: VIEW_ID, userId: USER_ID, isShared: true, isPinned: false, isDefault: false }
}

/** Minimal drizzle table stand-ins — only identity matters to the stub db. */
vi.mock('@auxx/database', () => ({
  schema: {
    MailView: { organizationId: 'MailView.organizationId', isShared: 'MailView.isShared' },
    FieldValue: {
      id: 'FieldValue.id',
      organizationId: 'FieldValue.organizationId',
      entityDefinitionId: 'FieldValue.entityDefinitionId',
      entityId: 'FieldValue.entityId',
    },
    Attachment: {
      id: 'Attachment.id',
      organizationId: 'Attachment.organizationId',
      entityType: 'Attachment.entityType',
      entityId: 'Attachment.entityId',
    },
  },
}))
vi.mock('drizzle-orm', () => ({
  and: (...parts: unknown[]) => parts,
  eq: (a: unknown, b: unknown) => [a, b],
  count: () => 'count',
}))

vi.mock('@auxx/lib/mail-views', () => ({
  MailViewService: class {
    createMailView = mailViewService.createMailView
    getMailView = mailViewService.getMailView
    getUserMailViews = mailViewService.getUserMailViews
    getSharedMailViews = mailViewService.getSharedMailViews
    updateMailView = mailViewService.updateMailView
    deleteMailView = mailViewService.deleteMailView
    setMailViewAsDefault = mailViewService.setMailViewAsDefault
    toggleMailViewPinned = mailViewService.toggleMailViewPinned
    getThreadsByMailView = mailViewService.getThreadsByMailView
  },
}))
vi.mock('@auxx/lib/messages', () => ({
  MessageQueryService: class {
    getMessageMetaBatch = messageQuery.getMessageMetaBatch
    getMessagesByThread = messageQuery.getMessagesByThread
  },
}))
vi.mock('@auxx/lib/participants', () => ({
  ParticipantService: class {
    getParticipantMetaBatch = participantService.getParticipantMetaBatch
  },
  ensureContactForParticipant,
}))
vi.mock('@auxx/lib/files', () => ({
  AttachmentService: class {
    create = attachmentService.create
    delete = attachmentService.delete
    get = attachmentService.get
  },
  FileService: class {
    get = vi.fn(async () => null)
  },
  MediaAssetService: class {
    get = vi.fn(async () => null)
  },
}))
vi.mock('@auxx/lib/cache', () => ({ ...cache, onCacheEvent }))
vi.mock('@auxx/lib/threads', () => ({ assertCanActOnThreads }))
vi.mock('@auxx/lib/email', () => ({ getUserOrganizationId: () => ORG_ID }))
vi.mock('@auxx/lib/conditions/client', async () => {
  const { z } = await import('zod')
  return { conditionGroupsSchema: z.any() }
})
vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

/**
 * The REAL registry + REAL `INSTANCE_ACCESS_RESOURCES` + the REAL
 * `buildDefIdToSlug` (the resolver `assertFieldValueHostsWritable` uses to
 * decide which of its three branches a host takes). Only capability resolution
 * and the plan service are stubbed.
 */
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
      requireAccess = vi.fn(async () => undefined)
      getLimit = vi.fn(async () => -1)
    },
    getCapabilities,
  }
})

/**
 * Mirrors the REAL `permissionProcedure`: a plain `capabilities.assert(key)`.
 * Only the plan-AND (`inboxes.view` carries no `featureKey`) and the
 * `getCapabilities` read are dropped — ctx already carries the set. So the gate
 * on the BUILDER is under test: deleting `permissionProcedure(inboxesView)` from
 * any of the three mail routers fails its whole block.
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
    isAuxxError: (e: unknown) =>
      typeof e === 'object' && e !== null && 'statusCode' in (e as Record<string, unknown>),
  }
})

const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { mailViewRouter } = await import('./mailView')
const { messageRouter } = await import('./message')
const { participantRouter } = await import('./participant')
const { attachmentRouter } = await import('./attachment')

/**
 * Asserting the STATUS, not merely "it rejected". The asserts throw `AuxxError`
 * (never `TRPCError`); tRPC exposes it as `cause`, and `auxxErrorMiddleware` +
 * `errorFormatter` map it onto this status in the app. A denial that surfaces as
 * a 500 is a different and worse outcome — which is exactly what a blanket
 * router `catch` does to it, and why `message.ts` / `participant.ts` grew an
 * `isAuxxError` rethrow in the same change.
 */
const FORBIDDEN = { cause: { name: 'ForbiddenError', statusCode: 403 } }

/** What the org `resources` cache projects, as `buildDefIdToSlug` reads it. */
const RESOURCES = [
  { id: 'res_inbox', apiSlug: 'inboxes', entityDefinitionId: INBOX_DEF_ID, entityType: 'inbox' },
  {
    id: 'res_contact',
    apiSlug: 'contacts',
    entityDefinitionId: CONTACT_DEF_ID,
    entityType: 'contact',
  },
  { id: 'res_thread', apiSlug: 'threads', entityDefinitionId: THREAD_DEF_ID, entityType: 'thread' },
]

interface CapsOpts {
  role?: OrganizationRole
  seatType?: SeatType
  inboxes?: Level
  records?: Level
  instances?: Record<string, ResourcePermission>
  /**
   * Org-wide ROW-GOVERNED set (`governingInstanceIds`): instances carrying a
   * `role:org_member` baseline at any permission, or any `none` marker. Defaults
   * to the granted ids. **Not** "carries ≥1 row" — sharing an instance does not
   * restrict it, and a creator's `user @ admin` row governs nothing
   * (`isGoverningInstanceRow`, 2026-07-29).
   */
  restricted?: string[]
  derivedKeys?: PermissionKey[]
}

function capabilitiesFor(opts: CapsOpts = {}) {
  const instances = opts.instances ?? {}
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
    new Set(opts.restricted ?? Object.keys(instances)),
    {},
    new Set(opts.derivedKeys ?? [])
  )
}

type Caps = InstanceType<typeof CapabilitySet>

/** Rows the stub db hands back, in call order. */
let dbRows: unknown[][] = []

const db = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => dbRows.shift() ?? [],
      }),
    }),
  }),
}

function ctxFor(capabilities: Caps) {
  return {
    db,
    capabilities,
    headers: new Headers(),
    session: {
      organizationId: ORG_ID,
      userId: USER_ID,
      user: { id: USER_ID, defaultOrganizationId: ORG_ID, isAdmin: false },
    },
  } as never
}

const views = (c: Caps) => mailViewRouter.createCaller(ctxFor(c))
const messages = (c: Caps) => messageRouter.createCaller(ctxFor(c))
const participants = (c: Caps) => participantRouter.createCaller(ctxFor(c))
const attachments = (c: Caps) => attachmentRouter.createCaller(ctxFor(c))

/** Baseline viewer: full lens on the shared inbox, nothing special. */
const VIEWER = {
  userId: USER_ID,
  role: 'MEMBER',
  isAdmin: false,
  isMailAdmin: false,
  inboxLens: { [INBOX_ID]: 'full' },
  personalInboxIds: {},
  grants: {},
}

beforeEach(() => {
  // `mockReset()`, not `mockClear()` — a `mockResolvedValueOnce` queue survives
  // `mockClear` and shifts every later value, which makes a mutated source line
  // look caught when it is not.
  for (const fn of Object.values(mailViewService)) fn.mockClear()
  for (const fn of Object.values(messageQuery)) fn.mockClear()
  for (const fn of Object.values(participantService)) fn.mockClear()
  for (const fn of Object.values(attachmentService)) fn.mockClear()
  ensureContactForParticipant.mockClear()
  onCacheEvent.mockClear()

  assertCanActOnThreads.mockReset()
  assertCanActOnThreads.mockResolvedValue(undefined as never)
  cache.getCachedUserInstanceGrants.mockReset()
  cache.getCachedUserInstanceGrants.mockResolvedValue(VIEWER as never)
  cache.getCachedResources.mockReset()
  cache.getCachedResources.mockResolvedValue(RESOURCES as never)
  getCapabilities.mockReset()
  dbRows = []
})

// ═══════════════════════════════════════════════════════════════════════════
// mailView.ts — ten procedures, none of which had a door
// ═══════════════════════════════════════════════════════════════════════════

const MAIL_VIEW_CALLS = [
  [
    'create',
    (c: ReturnType<typeof views>) =>
      c.create({ name: 'Mine', filterGroups: [], isShared: false } as never),
  ],
  ['getById', (c: ReturnType<typeof views>) => c.getById({ id: VIEW_ID })],
  ['getUserMailViews', (c: ReturnType<typeof views>) => c.getUserMailViews()],
  ['getSharedMailViews', (c: ReturnType<typeof views>) => c.getSharedMailViews()],
  ['getAllAccessibleMailViews', (c: ReturnType<typeof views>) => c.getAllAccessibleMailViews()],
  ['update', (c: ReturnType<typeof views>) => c.update({ id: VIEW_ID, data: { name: 'x' } })],
  ['delete', (c: ReturnType<typeof views>) => c.delete({ id: VIEW_ID })],
  ['setDefault', (c: ReturnType<typeof views>) => c.setDefault({ id: VIEW_ID })],
  ['togglePinned', (c: ReturnType<typeof views>) => c.togglePinned({ id: VIEW_ID })],
  ['getThreads', (c: ReturnType<typeof views>) => c.getThreads({ mailViewId: VIEW_ID })],
] as const

describe('mailView router — the mail front door (§5.3, the surface phase 3 missed)', () => {
  it.each(MAIL_VIEW_CALLS)('%s is REFUSED at inboxes: None', async (_name, call) => {
    await expect(call(views(capabilitiesFor({ inboxes: Level.None })))).rejects.toMatchObject(
      FORBIDDEN
    )
  })

  it.each(MAIL_VIEW_CALLS)('%s is ALLOWED for a baseline member at Read', async (_name, call) => {
    await expect(call(views(capabilitiesFor({ inboxes: Level.Read })))).resolves.toBeDefined()
  })

  it('the door answers BEFORE any view row is read — no existence oracle', async () => {
    await expect(
      views(capabilitiesFor({ inboxes: Level.None })).getById({ id: VIEW_ID })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(mailViewService.getMailView).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// message.ts + participant.ts
// ═══════════════════════════════════════════════════════════════════════════

const MESSAGE_CALLS = [
  ['getByIds', (c: ReturnType<typeof messages>) => c.getByIds({ ids: [MESSAGE_ID] })],
  ['listByThread', (c: ReturnType<typeof messages>) => c.listByThread({ threadId: THREAD_ID })],
] as const

const PARTICIPANT_CALLS = [
  ['getByIds', (c: ReturnType<typeof participants>) => c.getByIds({ ids: [PARTICIPANT_ID] })],
  [
    'ensureContact',
    (c: ReturnType<typeof participants>) => c.ensureContact({ participantId: PARTICIPANT_ID }),
  ],
] as const

describe('message router — the mail front door', () => {
  it.each(MESSAGE_CALLS)('%s is REFUSED at inboxes: None', async (_name, call) => {
    await expect(call(messages(capabilitiesFor({ inboxes: Level.None })))).rejects.toMatchObject(
      FORBIDDEN
    )
  })

  it.each(MESSAGE_CALLS)('%s is ALLOWED for a baseline member at Read', async (_name, call) => {
    await expect(call(messages(capabilitiesFor({ inboxes: Level.Read })))).resolves.toBeDefined()
  })

  it('the door answers before the message query runs', async () => {
    await expect(
      messages(capabilitiesFor({ inboxes: Level.None })).listByThread({ threadId: THREAD_ID })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(messageQuery.getMessagesByThread).not.toHaveBeenCalled()
  })
})

describe('participant router — the mail front door', () => {
  it.each(PARTICIPANT_CALLS)('%s is REFUSED at inboxes: None', async (_name, call) => {
    await expect(
      call(participants(capabilitiesFor({ inboxes: Level.None })))
    ).rejects.toMatchObject(FORBIDDEN)
  })

  it.each(PARTICIPANT_CALLS)('%s is ALLOWED for a baseline member at Read', async (_name, call) => {
    await expect(
      call(participants(capabilitiesFor({ inboxes: Level.Read })))
    ).resolves.toBeDefined()
  })

  /**
   * `ensureContact` writes a contact `EntityInstance`, so a records key is the
   * obvious guess and the wrong one — it runs the INGEST path, the same one
   * inbound mail runs headlessly with no member capability consulted. Requiring
   * `records.*` would break the dispatch shape §1.4 exists to protect: a
   * mail-only profile works threads and creates tickets from them by design.
   */
  it('ensureContact does NOT additionally require records access', async () => {
    await expect(
      participants(capabilitiesFor({ inboxes: Level.Read, records: Level.None })).ensureContact({
        participantId: PARTICIPANT_ID,
      })
    ).resolves.toMatchObject({ entityInstanceId: CONTACT_ID })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Blanket catches — a gate whose denial reads as a bug is not a gate
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Both routers wrap their service call in a `catch` that used to flatten
 * EVERYTHING into `INTERNAL_SERVER_ERROR` — the same shape that turned
 * `draft.ts`'s `ForbiddenError` into a 500 reading "Failed to save draft.".
 * These assert the STATUS survives the catch, so removing the `isAuxxError`
 * rethrow (and leaving the import behind, which a source-text test cannot see)
 * is caught.
 */
describe('blanket catches must not flatten an AuxxError into a 500', () => {
  /** Shape `isAuxxError` recognises: anything carrying a `statusCode`. */
  const forbidden = () =>
    Object.assign(new Error('nope'), { name: 'ForbiddenError', statusCode: 403 })

  it('message.getByIds preserves a 403 from the query layer', async () => {
    messageQuery.getMessageMetaBatch.mockRejectedValueOnce(forbidden() as never)
    await expect(messages(capabilitiesFor()).getByIds({ ids: [MESSAGE_ID] })).rejects.toMatchObject(
      FORBIDDEN
    )
  })

  it('message.listByThread preserves a 403 from the query layer', async () => {
    messageQuery.getMessagesByThread.mockRejectedValueOnce(forbidden() as never)
    await expect(
      messages(capabilitiesFor()).listByThread({ threadId: THREAD_ID })
    ).rejects.toMatchObject(FORBIDDEN)
  })

  it('participant.getByIds preserves a 403 from the service', async () => {
    participantService.getParticipantMetaBatch.mockRejectedValueOnce(forbidden() as never)
    await expect(
      participants(capabilitiesFor()).getByIds({ ids: [PARTICIPANT_ID] })
    ).rejects.toMatchObject(FORBIDDEN)
  })

  it('participant.ensureContact preserves a 403 from the ingest path', async () => {
    ensureContactForParticipant.mockRejectedValueOnce(forbidden() as never)
    await expect(
      participants(capabilitiesFor()).ensureContact({ participantId: PARTICIPANT_ID })
    ).rejects.toMatchObject(FORBIDDEN)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// POSITIVE CONTROLS — the cases that must PASS (§12: the repo's discipline is
// denial-shaped and structurally blind to over-denial)
// ═══════════════════════════════════════════════════════════════════════════

describe('positive controls — the dispatch org, which an instance gate would break', () => {
  /**
   * The shape §1.4 exists to serve: a shared inbox floored at `none`, a
   * controller who assigns, a member who holds **no row on that inbox by
   * construction** and whose profile is `records: None`. Assignment confers the
   * `full` lens (`effective-lens.ts:23`), and the lens predicate seeds
   * `Thread.assigneeId === userId`, so their assigned thread survives the inbox
   * exclusion. An `assertViewInstance('inbox', …)` on any of these surfaces
   * would deny exactly this member.
   */
  const dispatchAssignee = () =>
    capabilitiesFor({
      inboxes: Level.Read,
      records: Level.None,
      // The explicit `none` row IS the inbox restriction; they hold nothing else.
      instances: { [INBOX_ID]: ResourcePermission.none },
      restricted: [INBOX_ID],
    })

  const ASSIGNEE_VIEWER = {
    ...VIEWER,
    // No inbox floor at all — only the assigned thread is reachable.
    inboxLens: {},
    grants: { thread: { [THREAD_ID]: 'read' } },
  }

  beforeEach(() => {
    cache.getCachedUserInstanceGrants.mockResolvedValue(ASSIGNEE_VIEWER as never)
  })

  it('reads their assigned thread through message.listByThread', async () => {
    await expect(
      messages(dispatchAssignee()).listByThread({ threadId: THREAD_ID })
    ).resolves.toBeDefined()
    expect(messageQuery.getMessagesByThread).toHaveBeenCalledWith(THREAD_ID)
  })

  it('loads a saved view through mailView.getThreads', async () => {
    await expect(
      views(dispatchAssignee()).getThreads({ mailViewId: VIEW_ID })
    ).resolves.toBeDefined()
    expect(mailViewService.getThreadsByMailView).toHaveBeenCalled()
  })

  it('batch-fetches the thread participants and messages', async () => {
    await expect(
      participants(dispatchAssignee()).getByIds({ ids: [PARTICIPANT_ID] })
    ).resolves.toBeDefined()
    await expect(
      messages(dispatchAssignee()).getByIds({ ids: [MESSAGE_ID] })
    ).resolves.toBeDefined()
  })
})

describe('positive control — the plan-25 derived-key member (area None, one inbox row)', () => {
  /**
   * `composeUserCapabilities` synthesizes the area's Read rung from a member's
   * own instance grants, so a member whose PROFILE closes `Area.inboxes` but who
   * holds one explicit `view` row on one inbox genuinely holds `inboxesView`
   * (§1.4). `permissionProcedure` honours it, so the front door opens — and they
   * then see exactly that inbox, because the lens layer, not the door, decides.
   */
  const singleInboxMember = () =>
    capabilitiesFor({
      inboxes: Level.None,
      instances: { [INBOX_ID]: ResourcePermission.view },
      restricted: [INBOX_ID, OTHER_INBOX_ID],
      derivedKeys: [PermissionKey.inboxesView],
    })

  it('the derived key is what opens the door — areaLevel is still None', () => {
    const caps = singleInboxMember()
    expect(caps.areaLevel(Area.inboxes)).toBe(Level.None)
    expect(caps.can(PermissionKey.inboxesView)).toBe(true)
  })

  it.each([...MAIL_VIEW_CALLS])('mailView.%s lets them in', async (_name, call) => {
    await expect(call(views(singleInboxMember()))).resolves.toBeDefined()
  })

  it.each([...MESSAGE_CALLS])('message.%s lets them in', async (_name, call) => {
    await expect(call(messages(singleInboxMember()))).resolves.toBeDefined()
  })

  it.each([...PARTICIPANT_CALLS])('participant.%s lets them in', async (_name, call) => {
    await expect(call(participants(singleInboxMember()))).resolves.toBeDefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// attachment.ts — the router that must NOT take the mail key
// ═══════════════════════════════════════════════════════════════════════════

describe('attachment router — gated by HOST, not by a mail key', () => {
  /** `createForCustomField` reads one FieldValue row to resolve its host. */
  const queueHost = (entityDefinitionId: string, entityInstanceId: string) => {
    dbRows.push([{ entityDefinitionId, entityInstanceId }])
  }
  /** `removeFromCustomField` reads the Attachment row first, then the FieldValue. */
  const queueAttachmentThenHost = (entityDefinitionId: string, entityInstanceId: string) => {
    dbRows.push([{ entityType: 'FIELD_VALUE', entityId: FIELD_VALUE_ID }])
    queueHost(entityDefinitionId, entityInstanceId)
  }

  it('a RECORD host takes the records edit gate — allowed at records: Edit', async () => {
    queueHost(CONTACT_DEF_ID, CONTACT_ID)
    await expect(
      attachments(capabilitiesFor({ records: Level.Edit })).createForCustomField({
        fieldValueId: FIELD_VALUE_ID,
        fileId: 'fil_1',
      })
    ).resolves.toBeDefined()
    expect(attachmentService.create).toHaveBeenCalled()
  })

  it('…and REFUSED at records: None', async () => {
    queueHost(CONTACT_DEF_ID, CONTACT_ID)
    await expect(
      attachments(capabilitiesFor({ records: Level.None })).createForCustomField({
        fieldValueId: FIELD_VALUE_ID,
        fileId: 'fil_1',
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(attachmentService.create).not.toHaveBeenCalled()
  })

  /**
   * THE over-denial control for this router. `inboxesView` would have been the
   * convenient gate; it is the wrong one, and this is what it would have broken:
   * a records-only member attaching a file to a contact's file field, which has
   * nothing to do with mail.
   */
  it('is NOT gated on the mail key — a member at inboxes: None still attaches to a contact', async () => {
    queueHost(CONTACT_DEF_ID, CONTACT_ID)
    await expect(
      attachments(
        capabilitiesFor({ inboxes: Level.None, records: Level.Edit })
      ).createForCustomField({ fieldValueId: FIELD_VALUE_ID, fileId: 'fil_1' })
    ).resolves.toBeDefined()
  })

  it('a THREAD host takes question 4s gate — front door + full lens', async () => {
    queueHost(THREAD_DEF_ID, THREAD_ID)
    await expect(
      attachments(
        capabilitiesFor({ inboxes: Level.Read, records: Level.None })
      ).createForCustomField({ fieldValueId: FIELD_VALUE_ID, fileId: 'fil_1' })
    ).resolves.toBeDefined()
    expect(assertCanActOnThreads).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      expect.anything(),
      [THREAD_ID]
    )
  })

  it('a THREAD host is refused at inboxes: None, before the lens is read', async () => {
    queueHost(THREAD_DEF_ID, THREAD_ID)
    await expect(
      attachments(capabilitiesFor({ inboxes: Level.None })).createForCustomField({
        fieldValueId: FIELD_VALUE_ID,
        fileId: 'fil_1',
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(assertCanActOnThreads).not.toHaveBeenCalled()
  })

  it('an INBOX host takes assertAdminInstance — Manager only', async () => {
    queueHost(INBOX_DEF_ID, INBOX_ID)
    await expect(
      attachments(
        capabilitiesFor({ instances: { [INBOX_ID]: ResourcePermission.admin } })
      ).createForCustomField({ fieldValueId: FIELD_VALUE_ID, fileId: 'fil_1' })
    ).resolves.toBeDefined()

    queueHost(INBOX_DEF_ID, INBOX_ID)
    await expect(
      attachments(
        capabilitiesFor({ instances: { [INBOX_ID]: ResourcePermission.view } })
      ).createForCustomField({ fieldValueId: FIELD_VALUE_ID, fileId: 'fil_1' })
    ).rejects.toMatchObject(FORBIDDEN)
  })

  it('removeFromCustomField gates on the same host', async () => {
    queueAttachmentThenHost(CONTACT_DEF_ID, CONTACT_ID)
    await expect(
      attachments(capabilitiesFor({ records: Level.Edit })).removeFromCustomField({
        attachmentId: ATTACHMENT_ID,
      })
    ).resolves.toBeUndefined()
    expect(attachmentService.delete).toHaveBeenCalledWith(ATTACHMENT_ID)

    queueAttachmentThenHost(CONTACT_DEF_ID, CONTACT_ID)
    await expect(
      attachments(capabilitiesFor({ records: Level.None })).removeFromCustomField({
        attachmentId: ATTACHMENT_ID,
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(attachmentService.delete).toHaveBeenCalledTimes(1)
  })

  /**
   * The host read is the ONLY thing standing between an arbitrary
   * `fieldValueId` and a write, so a FieldValue that does not resolve inside the
   * caller's org must refuse rather than fall through to the gate with an
   * undefined host.
   */
  it('a FieldValue outside the caller org is NOT FOUND, and nothing is written', async () => {
    dbRows.push([]) // org-scoped lookup misses
    await expect(
      attachments(capabilitiesFor()).createForCustomField({
        fieldValueId: FIELD_VALUE_ID,
        fileId: 'fil_1',
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(attachmentService.create).not.toHaveBeenCalled()
  })

  it('removeFromCustomField refuses a non-FIELD_VALUE attachment rather than deleting it', async () => {
    dbRows.push([{ entityType: 'MESSAGE', entityId: MESSAGE_ID }])
    await expect(
      attachments(capabilitiesFor()).removeFromCustomField({ attachmentId: ATTACHMENT_ID })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(attachmentService.delete).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Structural invariants
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The behavioral blocks run against a stubbed `~/server/api/trpc`, so they
 * cannot see a downgrade of the procedure BUILDER itself — and the pre-fix state
 * of all three mail routers was exactly that: bare `protectedProcedure`s.
 */
describe('structural invariants — the builder itself', () => {
  const read = (name: string) =>
    fs.readFileSync(path.resolve(process.cwd(), `src/server/api/routers/${name}`), 'utf8')

  const GATED: Array<[string, string[]]> = [
    [
      'mailView.ts',
      [
        'create',
        'delete',
        'getAllAccessibleMailViews',
        'getById',
        'getSharedMailViews',
        'getThreads',
        'getUserMailViews',
        'setDefault',
        'togglePinned',
        'update',
      ],
    ],
    ['message.ts', ['getByIds', 'listByThread']],
    ['participant.ts', ['ensureContact', 'getByIds']],
  ]

  it.each(GATED)('%s declares the front door exactly once', (name) => {
    expect(read(name)).toContain('permissionProcedure(PermissionKey.inboxesView)')
  })

  it.each(GATED)('%s: every procedure builds on it — no bare procedure survives', (name, procs) => {
    const src = read(name)
    for (const p of procs) {
      expect(src, `${p} must build on the mail front door`).toContain(`${p}: mailProcedure`)
    }
    expect(src).not.toContain(': protectedProcedure')
    expect(src).not.toContain(': publicProcedure')
    expect(src).not.toContain(': capabilityProcedure')
  })

  it.each(
    GATED
  )('%s: the procedure list is exhaustive — a NEW one must be gated too', (name, procs) => {
    const declared = [...read(name).matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9]*): mailProcedure/gm)].map(
      (m) => m[1] as string
    )
    expect(declared.sort()).toEqual([...procs].sort())
  })

  it.each(GATED)('%s: no procedure reaches for the inbox instance layer (§1.4)', (name) => {
    const src = read(name)
    expect(src).not.toContain('canViewInstance')
    expect(src).not.toContain('assertViewInstance')
    expect(src).not.toContain('assertAdminInstance')
  })

  /**
   * A gate whose denial reads as a bug is not a gate. Both routers wrap their
   * service call in a blanket `catch` that used to flatten everything into a
   * 500 — the same shape that turned `draft.ts`'s `ForbiddenError` into
   * "Failed to save draft."
   */
  it.each([
    ['message.ts'],
    ['participant.ts'],
  ])('%s rethrows AuxxErrors instead of 500ing', (name) => {
    const src = read(name)
    expect(src).toContain('isAuxxError')
    expect(src).not.toContain('instanceof TRPCError')
  })

  /**
   * The negative half: `attachment.ts` must never acquire the mail key. Asserted
   * against the CODE, not the prose — the module docblock names
   * `PermissionKey.inboxesView` precisely to explain why it is absent.
   */
  it('attachment.ts is NOT on the mail front door', () => {
    const code = read('attachment.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toContain('PermissionKey')
    expect(code).not.toContain('permissionProcedure')
    expect(code).toContain('assertFieldValueHostsWritable')
  })
})
