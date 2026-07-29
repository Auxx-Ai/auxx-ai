// apps/web/src/server/api/routers/signature-request-edge-gates.test.ts

import { schema } from '@auxx/database'
import { ResourcePermission } from '@auxx/database/enums'
import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 36 §5's consumer sweep — the three request-edge signature-id gates.
 *
 * **`thread.sendMessage` was a LIVE LEAK**, and it is the reason gating only
 * `signature.ts` would have closed nothing: `MessageComposerService.appendSignature`
 * — the only code in the tree that reads signature BODIES — is scoped by
 * `EntityInstance.id` + `organizationId` and nothing else, so any member could
 * read the rendered HTML of any other member's private signature simply by
 * passing its id to a send. `draft.upsert` is the same read with a longer fuse
 * (the id is echoed back on every draft read and handed to the sender later), and
 * `sequence.update` pins an id into a cadence.
 *
 * All three go through `assertSignatureUsable` at `view`. Three properties:
 *
 * 1. **Each of the three refuses an id the caller cannot `view`**, with 403, and
 *    the downstream service is never reached. All three are `protectedProcedure`,
 *    not `capabilityProcedure`, so the `CapabilitySet` is fetched inside the gate
 *    — deleting the call is invisible in the procedure's signature.
 * 2. **A foreign-org id is a 404**, indistinguishable from a restricted one.
 * 3. **The HEADLESS CARVE-OUT survives.** The gate lives at the request edge and
 *    NOT inside `appendSignature`, precisely so the system senders (the
 *    `sequence-send-email` node, automated sends) keep stamping a restricted
 *    signature. That is asserted here the only way a router test honestly can —
 *    by pinning that the id reaches `MessageSenderService` unchanged once the
 *    gate passes, and that the gate is a router-layer wrapper rather than
 *    something `appendSignature` itself does. See the note on the last case for
 *    what this does and does not prove.
 */

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const SIGNATURE_DEF_ID = 'edf_signature0000000000000000'

/** Shared with the caller at `view`. */
const SHARED = 'sig_shared000000000000000000'
/** Another member's private signature — the leak's target. */
const OTHERS = 'sig_others000000000000000000'
/** Not in this org. */
const FOREIGN = 'sig_foreignorg00000000000000'

const SEQUENCE_ID = 'seq_cuid0000000000000000000'
const INTEGRATION_ID = 'int_cuid0000000000000000000'

const { mail, drafts, sequences, cache, caps } = vi.hoisted(() => ({
  mail: {
    sendMessage: vi.fn(async () => ({ id: 'msg_1', threadId: 'thr_1' })),
  },
  drafts: {
    // The service method is `upsert`; the router transforms its `Draft` shape.
    upsert: vi.fn(async () => ({
      id: 'drf_1',
      threadId: null,
      integrationId: 'int_cuid0000000000000000000',
      inReplyToMessageId: null,
      createdAt: new Date('2026-07-28T00:00:00Z'),
      updatedAt: new Date('2026-07-28T00:00:00Z'),
      content: {
        subject: 'Hi',
        bodyJson: null,
        bodyHtml: '',
        bodyText: '',
        signatureId: 'sig_shared000000000000000000',
        recipients: { to: [], cc: [], bcc: [] },
        attachments: [],
        actions: [],
        metadata: {},
      },
    })),
  },
  sequences: {
    checkSequenceAccess: vi.fn(async () => true),
    updateSequence: vi.fn(async () => ({ isErr: () => false, value: { id: 'seq_1' } })),
  },
  cache: {
    findCachedResource: vi.fn(async () => ({
      entityDefinitionId: 'edf_signature0000000000000000',
    })),
  },
  caps: { current: null as unknown },
}))

vi.mock('@auxx/lib/cache', () => ({
  findCachedResource: cache.findCachedResource,
  getCachedUserMailVisibility: async () => ({ userId: USER_ID, inboxIds: [] }),
  getCachedEntityDefId: async () => 'edf_ticket000000000000000000',
  getOrgCache: () => ({ get: async () => [] }),
}))

// The gate resolves the caller's CapabilitySet itself (these are
// `protectedProcedure`s, so it is not on `ctx`). Handing back a REAL
// `CapabilitySet` here is what keeps this behavioral.
vi.mock('@auxx/lib/permissions/capabilities/get-capabilities', () => ({
  getCapabilities: async () => caps.current,
}))

vi.mock('@auxx/lib/messages', () => ({
  MessageSenderService: class {
    sendMessage = mail.sendMessage
  },
}))

vi.mock('@auxx/lib/drafts', () => ({
  DraftService: class {
    upsert = drafts.upsert
  },
}))

vi.mock('@auxx/lib/threads', () => ({
  ThreadQueryService: class {},
  ThreadMutationService: class {},
  ThreadMergeService: class {},
  UnreadService: class {},
  canLinkThread: vi.fn(async () => true),
  getMailCounts: vi.fn(async () => ({})),
  linkEntityToThread: vi.fn(async () => undefined),
  returnThreadToAi: vi.fn(async () => undefined),
  takeOverThread: vi.fn(async () => undefined),
}))

vi.mock('@auxx/lib/providers', () => ({ ProviderRegistryService: class {} }))
vi.mock('@auxx/lib/email', () => ({ getUserOrganizationId: () => ORG_ID }))
vi.mock('@auxx/lib/placeholders', () => ({
  buildPlaceholderContextForThread: vi.fn(async () => ({})),
  resolvePlaceholdersInHtml: vi.fn(async (html: string) => html),
}))
vi.mock('@auxx/lib/mail-schedule', () => ({
  cancelScheduledMessage: vi.fn(async () => undefined),
  createScheduledMessage: vi.fn(async () => ({ id: 'sch_1' })),
  enqueueScheduledMessageJob: vi.fn(async () => 'job_1'),
  findPendingByDraftId: vi.fn(async () => null),
  findScheduledMessagesByThreadId: vi.fn(async () => []),
  updateScheduledMessage: vi.fn(async () => undefined),
  updateScheduledMessageStatus: vi.fn(async () => undefined),
}))
vi.mock('@auxx/lib/money', () => ({
  markInvoiceSent: vi.fn(async () => undefined),
  markQuoteSent: vi.fn(async () => undefined),
  recordDocumentSendSignal: vi.fn(async () => undefined),
}))

vi.mock('@auxx/lib/conditions', async () => {
  const { z } = await import('zod')
  return { conditionGroupSchema: z.any(), conditionGroupsSchema: z.any() }
})

vi.mock('@auxx/lib/sequences', () => ({
  checkSequenceAccess: sequences.checkSequenceAccess,
  updateSequence: sequences.updateSequence,
  createSequence: vi.fn(),
  createStep: vi.fn(),
  deleteSequence: vi.fn(),
  deleteStep: vi.fn(),
  deriveSubjectKindFromTrigger: () => 'generic',
  enrollRecipients: vi.fn(),
  getSequence: vi.fn(async () => ({ isErr: () => false, value: {} })),
  getSequenceStats: vi.fn(),
  listRuns: vi.fn(),
  listSequences: vi.fn(),
  manualExitRun: vi.fn(),
  publishSequence: vi.fn(),
  reorderStep: vi.fn(),
  updateStep: vi.fn(),
  SEQUENCE_ENROLL_MAX_RECIPIENTS: 100,
  SEQUENCE_SEED_TEMPLATES: [],
  SEQUENCE_TRIGGER_TYPES: ['manual'],
}))

// The `@auxx/lib/permissions` barrel hangs under vitest.
vi.mock('@auxx/lib/permissions', async () => {
  const registry = await import('@auxx/lib/permissions/capabilities/registry')
  const types = await import('@auxx/lib/permissions/types')
  return {
    PermissionKey: registry.PermissionKey,
    FeatureKey: types.FeatureKey,
    FeaturePermissionService: class {
      requireAccess = async () => undefined
    },
  }
})

vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('~/server/api/trpc', async () => {
  const { initTRPC } = await import('@trpc/server')
  const t = initTRPC.context<Record<string, unknown>>().create()
  return {
    createTRPCRouter: t.router,
    protectedProcedure: t.procedure,
    capabilityProcedure: t.procedure,
    // `thread.*` moved onto `permissionProcedure(inboxesView)` in plan 40 phase 3.
    // Mirrors the real builder — resolve the set, assert the key — so the mail
    // front door is genuinely in front of `sendMessage` here too, and the
    // signature gate below it is reached only by a caller who may use mail.
    permissionProcedure: (key: string) =>
      t.procedure.use(async ({ ctx, next }) => {
        const { getCapabilities } = await import(
          '@auxx/lib/permissions/capabilities/get-capabilities'
        )
        const session = (ctx as { session: { userId: string; organizationId: string } }).session
        const capabilities = (await getCapabilities(
          session.userId,
          session.organizationId
        )) as unknown as { assert: (k: string) => void }
        capabilities.assert(key)
        return next({ ctx: { capabilities } })
      }),
    // The real one blocks demo orgs; irrelevant here and deliberately inert, so
    // a gate deleted from `sendMessage` cannot hide behind a demo refusal.
    notDemo:
      () =>
      ({ next }: { next: () => unknown }) =>
        next(),
  }
})

const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { threadRouter } = await import('./thread')
const { draftRouter } = await import('./draft')
const { sequenceRouter } = await import('./sequence')

/** What the mocked `DraftService.upsert` resolves to — a `Draft` the router can transform. */
const DRAFT_ROW = {
  id: 'drf_1',
  threadId: null,
  integrationId: INTEGRATION_ID,
  inReplyToMessageId: null,
  createdAt: new Date('2026-07-28T00:00:00Z'),
  updatedAt: new Date('2026-07-28T00:00:00Z'),
  content: {
    subject: 'Hi',
    bodyJson: null,
    bodyHtml: '',
    bodyText: '',
    signatureId: SHARED,
    recipients: { to: [], cc: [], bcc: [] },
    attachments: [],
    actions: [],
    metadata: {},
  },
}

const FORBIDDEN = { cause: { name: 'ForbiddenError', statusCode: 403 } }
const NOT_FOUND = { cause: { name: 'NotFoundError', statusCode: 404 } }

/** The org's signatures, as `resolveSignatureId` sees them. */
const INSTANCES = [{ id: SHARED }, { id: OTHERS }]

const dialect = new PgDialect()

function fakeDb() {
  const chain: Record<string, unknown> = {
    from: () => chain,
    innerJoin: () => chain,
    where: (cond: unknown) => {
      // Only `resolveSignatureId` selects from EntityInstance in these paths, so
      // the bound params of its compiled WHERE are a real existence check.
      const { params } = dialect.sqlToQuery(cond as never)
      const bound = new Set((params as unknown[]).filter((p) => typeof p === 'string'))
      const rows = INSTANCES.filter((i) => bound.has(i.id))
      const pending = Promise.resolve(rows) as Promise<unknown[]> & {
        limit: () => Promise<unknown[]>
        orderBy: () => Promise<unknown[]>
      }
      pending.limit = () => Promise.resolve(rows.slice(0, 1))
      pending.orderBy = () => Promise.resolve(rows)
      return pending
    },
  }
  return { select: () => chain, _schema: schema }
}

/** A real `CapabilitySet` holding `permission` on {@link SHARED} and nothing else. */
function capabilitiesFor(permission?: ResourcePermission) {
  const instances = permission === undefined ? {} : { [SHARED]: permission }
  return new CapabilitySet(
    // `Area.inboxes` is present so the mail front door (plan 40 §5.3) is open —
    // this file is about the SIGNATURE gate behind it, not about mail gating.
    new Set(
      expandLevelsToKeys({
        [Area.signatures]: Level.Full,
        [Area.records]: Level.Full,
        [Area.inboxes]: Level.Full,
      })
    ),
    {},
    'USER',
    'full',
    undefined,
    undefined,
    undefined,
    instances,
    // Both signatures carry rows in the org; only SHARED has one for us.
    new Set([SHARED, OTHERS])
  )
}

function callers() {
  const ctx = {
    db: fakeDb(),
    headers: new Headers(),
    session: {
      organizationId: ORG_ID,
      userId: USER_ID,
      user: { id: USER_ID, defaultOrganizationId: ORG_ID },
    },
  } as never
  return {
    thread: threadRouter.createCaller(ctx),
    draft: draftRouter.createCaller(ctx),
    sequence: sequenceRouter.createCaller(ctx),
  }
}

const send = (signatureId: string | null) =>
  callers().thread.sendMessage({
    integrationId: INTEGRATION_ID,
    signatureId,
    textHtml: '<p>hi</p>',
    to: [{ identifier: 'a@b.c', identifierType: 'EMAIL' }],
  })

const upsert = (signatureId: string | null) =>
  callers().draft.upsert({ integrationId: INTEGRATION_ID, signatureId, subject: 'Hi', to: [] })

const pin = (signatureId: string | null) =>
  callers().sequence.update({ id: SEQUENCE_ID, fields: { signatureEntityInstanceId: signatureId } })

const EDGES: [string, (id: string | null) => Promise<unknown>, () => ReturnType<typeof vi.fn>][] = [
  ['thread.sendMessage', send, () => mail.sendMessage],
  ['draft.upsert', upsert, () => drafts.upsert],
  ['sequence.update', pin, () => sequences.updateSequence],
]

beforeEach(() => {
  mail.sendMessage.mockReset()
  mail.sendMessage.mockResolvedValue({ id: 'msg_1', threadId: 'thr_1' })
  drafts.upsert.mockReset()
  drafts.upsert.mockResolvedValue(DRAFT_ROW)
  sequences.updateSequence.mockReset()
  sequences.updateSequence.mockResolvedValue({ isErr: () => false, value: { id: 'seq_1' } })
  sequences.checkSequenceAccess.mockReset()
  sequences.checkSequenceAccess.mockResolvedValue(true)
  cache.findCachedResource.mockReset()
  cache.findCachedResource.mockResolvedValue({ entityDefinitionId: SIGNATURE_DEF_ID })
  caps.current = capabilitiesFor(ResourcePermission.view)
})

describe('signature request-edge gates — another member’s private signature is refused', () => {
  it.each(EDGES)('%s refuses it with 403', async (_name, call, mock) => {
    // The live leak, pinned: without the gate this reads OTHERS' signature HTML.
    caps.current = capabilitiesFor(ResourcePermission.view)
    await expect(call(OTHERS)).rejects.toMatchObject(FORBIDDEN)
    expect(mock()).not.toHaveBeenCalled()
  })

  it.each(EDGES)('%s refuses it for a member holding no grant at all', async (_n, call, mock) => {
    caps.current = capabilitiesFor(undefined)
    await expect(call(SHARED)).rejects.toMatchObject(FORBIDDEN)
    expect(mock()).not.toHaveBeenCalled()
  })

  it.each(EDGES)('%s refuses an explicit `none` row', async (_n, call, mock) => {
    caps.current = capabilitiesFor(ResourcePermission.none)
    await expect(call(SHARED)).rejects.toMatchObject(FORBIDDEN)
    expect(mock()).not.toHaveBeenCalled()
  })

  it.each(EDGES)('%s 404s a foreign-org id, never 403', async (_n, call, mock) => {
    await expect(call(FOREIGN)).rejects.toMatchObject(NOT_FOUND)
    expect(mock()).not.toHaveBeenCalled()
  })
})

describe('signature request-edge gates — `view` is the tier, and null is a no-op', () => {
  it.each(EDGES)('%s succeeds at instance `view`', async (_name, call, mock) => {
    // Stamping a signature on your own outgoing mail is READING it, not editing
    // it — an `edit`-tier gate here would break every shared signature.
    caps.current = capabilitiesFor(ResourcePermission.view)
    await expect(call(SHARED)).resolves.toBeDefined()
    expect(mock()).toHaveBeenCalledTimes(1)
  })

  it.each(EDGES)('%s treats a null signature as "no signature"', async (_n, call, mock) => {
    // A no-op, not a denial: most sends carry no signature at all, and they must
    // not pay a resolve or a 404.
    caps.current = capabilitiesFor(undefined)
    await expect(call(null)).resolves.toBeDefined()
    expect(mock()).toHaveBeenCalledTimes(1)
    expect(cache.findCachedResource).not.toHaveBeenCalled()
  })
})

describe('signature request-edge gates — the headless carve-out', () => {
  it('the gate is the router’s, and hands the id to the sender untouched', async () => {
    // What this pins: the check is a REQUEST-EDGE wrapper. Once it passes, the
    // id is forwarded verbatim to `MessageSenderService`, which is the shared
    // entry point the headless senders also use — `appendSignature` itself does
    // no capability work, so a `sequence-send-email` run (no member, no
    // CapabilitySet) still stamps a restricted signature.
    //
    // What it does NOT prove: that the headless path actually runs. That entry
    // point is `sequence-send-email` in the worker and is out of reach from a
    // router test; plan §11 case 5 is the browser check for it. Stated rather
    // than faked.
    caps.current = capabilitiesFor(ResourcePermission.view)
    await send(SHARED)
    expect(mail.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ signatureId: SHARED, organizationId: ORG_ID, userId: USER_ID })
    )
  })

  it('a `view` grant is enough — the sender is not asked for `edit`', async () => {
    caps.current = capabilitiesFor(ResourcePermission.view)
    await expect(send(SHARED)).resolves.toBeDefined()
    await expect(upsert(SHARED)).resolves.toBeDefined()
  })
})

describe('signature request-edge gates — ordering', () => {
  it('sequence.update checks SEQUENCE access before it resolves the signature', async () => {
    // Otherwise a member with no access to the sequence learns whether a given
    // signature id exists in the org by watching 403 flip to 404.
    sequences.checkSequenceAccess.mockResolvedValue(false)
    caps.current = capabilitiesFor(ResourcePermission.view)
    await expect(pin(FOREIGN)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(cache.findCachedResource).not.toHaveBeenCalled()
  })

  it('thread.sendMessage gates BEFORE the try, so the failure is 403 and not 500', async () => {
    // `sendMessage`'s catch flattens unknown errors to INTERNAL_SERVER_ERROR.
    caps.current = capabilitiesFor(ResourcePermission.view)
    await expect(send(OTHERS)).rejects.toMatchObject({
      cause: { name: 'ForbiddenError', statusCode: 403 },
    })
  })
})
