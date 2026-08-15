// packages/lib/src/messages/__tests__/message-sender.send-safety.test.ts
//
// §6 fix #3 (per-thread auto-reply alternation) and fix #4 (rate-limiter hoist),
// message-trigger-scoping-and-send-safety plan. Drives the real `sendMessage`
// pipeline (per HANDOFF-contract-drift.md's reachability limit — assert on the
// processor's behavior, not on the presence of a call site) with every
// collaborator service stubbed out except the guard logic under test.
//
// The composer is stubbed to throw a sentinel error once reached. Every test
// asserts EITHER a specific guard's `ForbiddenError` message (blocked) OR the
// sentinel (proceeded past every guard to composition) — there is no silent
// third outcome, so a guard that fires when it should not (or vice versa) shows
// up as the wrong rejection message rather than a passing test for the wrong
// reason.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutomatedSendLimitResult } from '../automated-send-guard'

const mocks = vi.hoisted(() => {
  const state = {
    integrationRow: { provider: 'google' } as { provider: string },
    messageRows: [] as { isInbound: boolean; isAutomatedSend: boolean }[],
    recipientEntityInstanceId: undefined as string | undefined,
  }
  const threadContext = {
    id: 'thread-1',
    organizationId: 'org-1',
    integrationId: 'int-1',
    externalId: 'ext-1',
    isPending: false,
  }
  return {
    state,
    threadContext,
    getOrCreateThreadForSending: vi.fn(async () => ({ ...threadContext })),
    isSuppressed: vi.fn(async () => false),
    checkAutomatedSendLimits: vi.fn<() => Promise<AutomatedSendLimitResult>>(async () => ({
      allowed: true,
    })),
    notifyAdminsOfSendBreakerTrip: vi.fn(async () => undefined),
    composeMessage: vi.fn(async () => {
      throw new Error('COMPOSE_REACHED')
    }),
  }
})

/**
 * Partial mock: the chainable proxy still backs every builder the module graph
 * touches at import time, and the schema proxy auto-vivifies every table (see
 * `src/test/database-mock.ts`). `select` is overridden with a tiny router keyed
 * on the table object passed to `.from(...)` — `schema.Integration` (for
 * `getCapabilitiesForIntegration`) and `schema.Message` (for the alternation
 * guard's own-thread lookup) are the only two tables `sendMessage` queries
 * directly; every other collaborator is stubbed out below.
 */
vi.mock('@auxx/database', async () => {
  const { createChainableDatabaseMock, createSchemaMock } = await import('../../test/database-mock')
  const schema = createSchemaMock()

  function makeSelectBuilder(): any {
    let fromTable: unknown
    const resolveRows = () =>
      fromTable === schema.Integration
        ? [mocks.state.integrationRow]
        : fromTable === schema.Message
          ? mocks.state.messageRows
          : []
    // A Proxy, not a fixed-shape object: other modules build prepared statements
    // off `.select()` at import time (`system-user-service.ts` does
    // `.select().from().where().limit().prepare(...)`), so `from`/`where`/
    // `orderBy`/`limit`/`then` are pinned for the two queries this suite drives
    // and everything else (e.g. `.prepare()`) falls through chainable, matching
    // `createChainableDatabaseMock`'s contract.
    const builder: any = new Proxy(() => builder, {
      get: (_target, prop) => {
        if (prop === 'from') {
          return (table: unknown) => {
            fromTable = table
            return builder
          }
        }
        if (prop === 'where' || prop === 'orderBy' || prop === 'limit') return () => builder
        if (prop === 'then') {
          return (onFulfilled: any, onRejected: any) =>
            Promise.resolve(resolveRows()).then(onFulfilled, onRejected)
        }
        return () => builder
      },
      apply: () => builder,
    })
    return builder
  }

  const database = new Proxy(createChainableDatabaseMock(), {
    get: (target: any, prop: string) => {
      if (prop === 'select') return () => makeSelectBuilder()
      return target[prop]
    },
  })

  return {
    database,
    schema,
    IntegrationProviderTypeValues: ['google', 'outlook', 'email', 'mailgun', 'imap'],
  }
})

vi.mock('../thread-manager.service', () => ({
  ThreadManagerService: class {
    getOrCreateThreadForSending = mocks.getOrCreateThreadForSending
    updateThreadMetadata = vi.fn(async () => undefined)
    updateThreadParticipantCount = vi.fn(async () => undefined)
    deletePendingThread = vi.fn(async () => undefined)
  },
}))

vi.mock('../../participants/participant-service', () => ({
  ParticipantService: class {
    findOrCreateParticipantForIntegration = vi.fn(async () => ({
      id: 'from-1',
      identifier: 'agent@auxx.ai',
      identifierType: 'EMAIL',
      name: 'Agent',
    }))
    findOrCreateParticipantForUser = vi.fn(async () => ({
      id: 'from-1',
      identifier: 'agent@auxx.ai',
      identifierType: 'EMAIL',
      name: 'Agent',
    }))
    findOrCreateParticipant = vi.fn(async (p: any) => ({
      id: `p-${p.identifier}`,
      identifier: p.identifier,
      identifierType: p.identifierType,
      name: p.name,
      entityInstanceId: mocks.state.recipientEntityInstanceId,
    }))
  },
}))

vi.mock('../message-composer.service', () => ({
  MessageComposerService: class {
    composeMessage = mocks.composeMessage
  },
}))

vi.mock('../message-reconciler.service', () => ({
  MessageReconcilerService: class {
    reconcileSentMessage = vi.fn(async () => undefined)
  },
}))

vi.mock('../../files/core/file-service', () => ({
  FileService: class {},
}))

vi.mock('../../files/core/media-asset-service', () => ({
  MediaAssetService: class {},
}))

vi.mock('../../usage/create-usage-guard', () => ({
  createUsageGuard: vi.fn(async () => null),
}))

vi.mock('../automated-send-guard', () => ({
  checkAutomatedSendLimits: mocks.checkAutomatedSendLimits,
  notifyAdminsOfSendBreakerTrip: mocks.notifyAdminsOfSendBreakerTrip,
}))

vi.mock('../../sequences/suppression', () => ({
  isSuppressed: mocks.isSuppressed,
}))

import { MessageSenderService } from '../message-sender.service'

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user-1',
    organizationId: 'org-1',
    integrationId: 'int-1',
    subject: 'Hello',
    textPlain: 'hi',
    to: [{ identifier: 'customer@example.com', identifierType: 'EMAIL' }],
    ...overrides,
  } as any
}

/** Automated sender — no viewer, so `!this.viewer` makes `isAutomatedSend` true. */
function createAutomatedService(): MessageSenderService {
  return new MessageSenderService('org-1')
}

/** Human/interactive sender — a real (non-system, non-automation) viewer. */
function createHumanService(): MessageSenderService {
  return new MessageSenderService('org-1', undefined, undefined, undefined, {} as any)
}

beforeEach(() => {
  mocks.state.integrationRow = { provider: 'google' }
  mocks.state.messageRows = []
  mocks.state.recipientEntityInstanceId = undefined
  mocks.threadContext.isPending = false
  mocks.getOrCreateThreadForSending.mockReset()
  mocks.getOrCreateThreadForSending.mockImplementation(async () => ({ ...mocks.threadContext }))
  mocks.isSuppressed.mockReset()
  mocks.isSuppressed.mockResolvedValue(false)
  mocks.checkAutomatedSendLimits.mockReset()
  mocks.checkAutomatedSendLimits.mockResolvedValue({ allowed: true })
  mocks.notifyAdminsOfSendBreakerTrip.mockReset()
  mocks.notifyAdminsOfSendBreakerTrip.mockResolvedValue(undefined)
  mocks.composeMessage.mockReset()
  mocks.composeMessage.mockImplementation(async () => {
    throw new Error('COMPOSE_REACHED')
  })
})

describe('per-thread auto-reply alternation (§6 fix #3)', () => {
  it('blocks the second consecutive automated send on a thread', async () => {
    mocks.state.messageRows = [{ isInbound: false, isAutomatedSend: true }]
    await expect(createAutomatedService().sendMessage(baseInput())).rejects.toThrow(
      /alternation guard/i
    )
  })

  it('allows the automated send once an inbound message intervened', async () => {
    mocks.state.messageRows = [{ isInbound: true, isAutomatedSend: false }]
    await expect(createAutomatedService().sendMessage(baseInput())).rejects.toThrow(
      'COMPOSE_REACHED'
    )
  })

  it('allows the automated send when the last outbound message was a human send', async () => {
    mocks.state.messageRows = [{ isInbound: false, isAutomatedSend: false }]
    await expect(createAutomatedService().sendMessage(baseInput())).rejects.toThrow(
      'COMPOSE_REACHED'
    )
  })

  it('never blocks a human send, even with a blocking history', async () => {
    mocks.state.messageRows = [{ isInbound: false, isAutomatedSend: true }]
    await expect(createHumanService().sendMessage(baseInput())).rejects.toThrow('COMPOSE_REACHED')
  })

  it('always passes on a brand-new (pending) thread without consulting message history', async () => {
    mocks.threadContext.isPending = true
    // Would block if the guard incorrectly queried history on a pending thread.
    mocks.state.messageRows = [{ isInbound: false, isAutomatedSend: true }]
    await expect(createAutomatedService().sendMessage(baseInput())).rejects.toThrow(
      'COMPOSE_REACHED'
    )
  })
})

describe('rate limiter hoist (§6 fix #4)', () => {
  it('fires for an automated send to a recipient with no linked contact', async () => {
    mocks.state.recipientEntityInstanceId = undefined
    mocks.checkAutomatedSendLimits.mockResolvedValue({
      allowed: false,
      scope: 'recipient',
      limit: 2,
      count: 3,
      firstTrip: true,
    })
    await expect(createAutomatedService().sendMessage(baseInput())).rejects.toThrow(
      /possible loop/i
    )
    expect(mocks.checkAutomatedSendLimits).toHaveBeenCalledWith(
      expect.objectContaining({ recipientEmail: 'customer@example.com' })
    )
  })

  it('never rate-limits a human send', async () => {
    mocks.checkAutomatedSendLimits.mockResolvedValue({
      allowed: false,
      scope: 'recipient',
      limit: 2,
      count: 3,
      firstTrip: true,
    })
    await expect(createHumanService().sendMessage(baseInput())).rejects.toThrow('COMPOSE_REACHED')
    expect(mocks.checkAutomatedSendLimits).not.toHaveBeenCalled()
  })

  it('suppression is skipped entirely for an unlinked recipient (still contact-scoped)', async () => {
    mocks.state.recipientEntityInstanceId = undefined
    await expect(createAutomatedService().sendMessage(baseInput())).rejects.toThrow(
      'COMPOSE_REACHED'
    )
    expect(mocks.isSuppressed).not.toHaveBeenCalled()
  })

  it('suppression still fires for a linked contact', async () => {
    mocks.state.recipientEntityInstanceId = 'contact-1'
    mocks.isSuppressed.mockResolvedValue(true)
    await expect(createAutomatedService().sendMessage(baseInput())).rejects.toThrow(
      /unsubscribed or bounced/i
    )
  })
})
