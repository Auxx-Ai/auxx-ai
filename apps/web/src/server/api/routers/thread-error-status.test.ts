// apps/web/src/server/api/routers/thread-error-status.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 44 §1.3 / §1.4 — a thread-service refusal must surface as its own
 * status, never as a 500.
 *
 * `thread.ts` catches broadly and re-wraps. Two shapes existed:
 *
 *  - `handleServiceError`, reached from ~20 procedures, re-wrapped as
 *    `INTERNAL_SERVER_ERROR` but PASSED the original on `cause` — which
 *    `auxxErrorMiddleware` reads, so those already recovered the right code.
 *    It now rethrows the `AuxxError` untouched, so the recovery no longer
 *    depends on one `cause:` argument staying in place.
 *  - `linkToTicket` and `retryMessage` re-wrap with **no `cause` at all**.
 *    There is nothing for the middleware to read, so an authorization refusal
 *    genuinely reached the client as a 500 with a message-sniffed status.
 *
 * Every assertion below is on the CODE. "It rejected" is the assertion that
 * passes against the bug — HANDOFF's standing gotcha, where one mutation
 * failed with literally `expected 500 to be 403`.
 */

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const THREAD_ID = 'thr_cuid00000000000000000a'
const TICKET_ID = 'tkt_cuid00000000000000000a'

const { svc } = vi.hoisted(() => ({
  svc: {
    setReadStatus: vi.fn(async () => undefined),
    threadUpdate: vi.fn(async () => ({ id: 'thr_1', success: true, updatedFields: {} })),
    linkEntityToThread: vi.fn(async () => undefined),
  },
}))

vi.mock('@auxx/lib/threads', () => ({
  ThreadQueryService: class {
    listThreadIds = vi.fn(async () => ({ ids: [], nextCursor: null }))
    getThreadMetaBatch = vi.fn(async () => [])
  },
  ThreadMutationService: class {
    update = svc.threadUpdate
    updateBulk = vi.fn(async () => ({ count: 0 }))
    remove = vi.fn()
    removeBulk = vi.fn()
    tagThreadsBulk = vi.fn()
  },
  ThreadMergeService: class {
    unmergeBatch = vi.fn()
  },
  UnreadService: class {
    setReadStatus = svc.setReadStatus
  },
  getMailCounts: vi.fn(async () => ({})),
  canLinkThread: vi.fn(async () => true),
  linkEntityToThread: svc.linkEntityToThread,
  returnThreadToAi: vi.fn(),
  takeOverThread: vi.fn(),
  assertCanActOnThreads: vi.fn(async () => undefined),
}))

vi.mock('@auxx/lib/cache', () => ({
  getCachedUserInstanceGrants: vi.fn(async () => ({ userId: USER_ID })),
  getCachedEntityDefId: vi.fn(async () => null),
  getCachedResources: vi.fn(async () => []),
}))
vi.mock('@auxx/lib/email', () => ({ getUserOrganizationId: () => ORG_ID }))
vi.mock('@auxx/lib/drafts', () => ({ DraftService: class {} }))
vi.mock('@auxx/lib/messages', () => ({ MessageSenderService: class {} }))
vi.mock('@auxx/lib/providers', () => ({ ProviderRegistryService: class {} }))
vi.mock('@auxx/lib/money', () => ({
  markInvoiceSent: vi.fn(),
  markQuoteSent: vi.fn(),
  recordDocumentSendSignal: vi.fn(),
}))
vi.mock('@auxx/lib/placeholders', () => ({
  buildPlaceholderContextForThread: vi.fn(),
  resolvePlaceholdersInHtml: vi.fn(),
}))
vi.mock('@auxx/lib/mail-schedule', () => ({
  cancelScheduledMessage: vi.fn(),
  createScheduledMessage: vi.fn(),
  enqueueScheduledMessageJob: vi.fn(),
  findPendingByDraftId: vi.fn(),
  findScheduledMessagesByThreadId: vi.fn(),
  updateScheduledMessage: vi.fn(),
  updateScheduledMessageStatus: vi.fn(),
}))
vi.mock('~/server/lib/signature-instance-access', () => ({
  assertSignatureUsable: vi.fn(),
}))
vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@auxx/lib/permissions', async () => {
  const registry = await import('@auxx/lib/permissions/capabilities/registry')
  const types = await import('@auxx/lib/permissions/types')
  return {
    PermissionKey: registry.PermissionKey,
    FeatureKey: types.FeatureKey,
    FeaturePermissionService: class {
      requireAccess = vi.fn(async () => undefined)
    },
  }
})

/**
 * `trpc.ts` itself reaches redis/db at import time and hangs under vitest, so
 * the procedure builder is stubbed — but `auxxErrorMiddleware` is transcribed
 * FAITHFULLY from it, including the `HTTP_TO_TRPC` table and the tRPC v11
 * detail the real comment calls out: `next()` RESOLVES with `{ok:false}` for a
 * downstream throw rather than rejecting. `isAuxxError` is the real predicate's
 * duck-type, since the transpiled `@auxx/lib` copy defeats `instanceof`.
 */
vi.mock('~/server/api/trpc', async () => {
  const { initTRPC, TRPCError } = await import('@trpc/server')
  const { AuxxError, AuxxErrorCodes } = await import('@auxx/lib/errors')
  const HTTP_TO_TRPC: Record<number, string> = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    422: 'UNPROCESSABLE_CONTENT',
    429: 'TOO_MANY_REQUESTS',
  }
  const NAMES = new Set<string>(Object.values(AuxxErrorCodes))
  const isAuxxError = (error: unknown): error is InstanceType<typeof AuxxError> =>
    error instanceof AuxxError ||
    (error instanceof Error &&
      typeof (error as { statusCode?: number }).statusCode === 'number' &&
      NAMES.has(error.name))

  const t = initTRPC.context<Record<string, unknown>>().create()
  const auxxErrorMiddleware = t.middleware(async ({ next }) => {
    const result = await next()
    if (!result.ok && isAuxxError(result.error.cause)) {
      const cause = result.error.cause
      throw new TRPCError({
        code: (HTTP_TO_TRPC[cause.statusCode] ?? 'INTERNAL_SERVER_ERROR') as 'FORBIDDEN',
        message: cause.message,
        cause,
      })
    }
    return result
  })
  const base = t.procedure.use(auxxErrorMiddleware)
  return {
    isAuxxError,
    createTRPCRouter: t.router,
    capabilityProcedure: base,
    protectedProcedure: base,
    permissionProcedure: () => base,
    notDemo:
      () =>
      ({ next }: { next: () => unknown }) =>
        next(),
  }
})

const { ForbiddenError, NotFoundError } = await import('@auxx/lib/errors')
const { threadRouter } = await import('./thread')

const REFUSAL = 'You do not have full access to the selected threads.'

function caller() {
  return threadRouter.createCaller({
    db: {},
    headers: { get: () => null },
    session: { user: { id: USER_ID }, userId: USER_ID, organizationId: ORG_ID },
  } as never)
}

/** The tRPC error code the procedure actually surfaced. */
async function codeOf(run: () => Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await run()
  } catch (error) {
    const e = error as { code: string; message: string }
    return { code: e.code, message: e.message }
  }
  throw new Error('expected the procedure to reject')
}

beforeEach(() => {
  svc.setReadStatus.mockReset().mockResolvedValue(undefined)
  svc.threadUpdate.mockReset().mockResolvedValue({ id: THREAD_ID, success: true })
  svc.linkEntityToThread.mockReset().mockResolvedValue(undefined)
})

describe('thread.update — read-state refusal below `full` lens (§1.1)', () => {
  it('surfaces FORBIDDEN, not INTERNAL_SERVER_ERROR', async () => {
    svc.setReadStatus.mockRejectedValue(new ForbiddenError(REFUSAL))

    expect(
      await codeOf(() =>
        caller().update({
          recordId: `thread:${THREAD_ID}` as never,
          updates: { isUnread: false },
        })
      )
    ).toEqual({ code: 'FORBIDDEN', message: REFUSAL })
  })

  it('does not name a service that never ran', async () => {
    svc.setReadStatus.mockRejectedValue(new ForbiddenError(REFUSAL))
    const { message } = await codeOf(() =>
      caller().update({ recordId: `thread:${THREAD_ID}` as never, updates: { isUnread: false } })
    )

    // The throw came from UnreadService; `threadMutation.update` is never
    // reached when `isUnread` is the only field in the payload.
    expect(message).not.toContain('threadMutation.update')
    expect(svc.threadUpdate).not.toHaveBeenCalled()
  })

  it('passes a NotFoundError through as NOT_FOUND', async () => {
    svc.threadUpdate.mockRejectedValue(new NotFoundError('Thread not found'))

    expect(
      await codeOf(() =>
        caller().update({
          recordId: `thread:${THREAD_ID}` as never,
          updates: { status: 'ARCHIVED' },
        })
      )
    ).toEqual({ code: 'NOT_FOUND', message: 'Thread not found' })
  })

  it('still 500s on a genuinely unexpected error (negative control)', async () => {
    svc.setReadStatus.mockRejectedValue(new Error('connection reset'))

    expect(
      (
        await codeOf(() =>
          caller().update({
            recordId: `thread:${THREAD_ID}` as never,
            updates: { isUnread: false },
          })
        )
      ).code
    ).toBe('INTERNAL_SERVER_ERROR')
  })
})

/**
 * `linkToTicket`'s catch re-wraps with NO `cause`, so before the guard there
 * was nothing for the middleware to recover the status from — this is the shape
 * that genuinely produced a 403-wearing-a-500.
 */
describe('thread.linkToTicket — causeless re-wrap (§1.4)', () => {
  it('surfaces FORBIDDEN for an authorization refusal', async () => {
    svc.linkEntityToThread.mockRejectedValue(new ForbiddenError(REFUSAL))

    expect(
      await codeOf(() => caller().linkToTicket({ threadId: THREAD_ID, ticketId: TICKET_ID }))
    ).toEqual({ code: 'FORBIDDEN', message: REFUSAL })
  })

  it('keeps mapping a plain "not found" Error to NOT_FOUND', async () => {
    svc.linkEntityToThread.mockRejectedValue(new Error('Ticket not found'))

    expect(
      (await codeOf(() => caller().linkToTicket({ threadId: THREAD_ID, ticketId: TICKET_ID }))).code
    ).toBe('NOT_FOUND')
  })
})
