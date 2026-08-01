// packages/lib/src/messages/__tests__/message-sender.retry.test.ts

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const messageFindFirst = vi.fn()
  /**
   * Self-returning `select()` builder that resolves to no rows.
   *
   * It has to accept ANY builder method, not just the ones this suite drives:
   * modules across `packages/lib` build prepared statements at import time
   * (`users/system-user-service.ts` does `.select().from().where().limit().prepare()`
   * at module scope), so a fixed-shape stub dies at collection.
   */
  const selectChain: any = new Proxy(() => selectChain, {
    get: (_target, prop) => {
      if (prop === 'then') {
        return (onFulfilled: any, onRejected: any) =>
          Promise.resolve([]).then(onFulfilled, onRejected)
      }
      return () => selectChain
    },
    apply: () => selectChain,
  })
  return {
    messageFindFirst,
    selectChain,
    query: {
      Message: { findFirst: messageFindFirst, findMany: vi.fn(async () => []) },
      MediaAsset: { findMany: vi.fn(async () => []) },
    },
  }
})

// Partial mock: the chainable proxy still backs every builder the module graph
// touches at import time and the schema proxy auto-vivifies every table (see
// `src/test/database-mock.ts`). Only `query` and `select` are pinned, so this
// suite can assert on them without the rest of the graph dying at collection.
vi.mock('@auxx/database', async () => {
  const { createChainableDatabaseMock, createSchemaMock } = await import('../../test/database-mock')
  const database = new Proxy(createChainableDatabaseMock(), {
    get: (target: any, prop: string) => {
      if (prop === 'query') return mocks.query
      if (prop === 'select') return () => mocks.selectChain
      return target[prop]
    },
  })
  return {
    database,
    schema: createSchemaMock(),
    IntegrationProviderTypeValues: ['google', 'outlook'],
  }
})

import { MessageSenderService } from '../message-sender.service'

/**
 * Relation names Drizzle actually knows about for `Message`, parsed out of the
 * schema package at test time.
 *
 * The point of this suite is a relation that does NOT exist: `Message.signature`
 * was removed along with the `Signature` table, but `loadFailedMessage` kept
 * asking for it, and Drizzle answers a missing relation with
 * `Cannot read properties of undefined (reading 'referencedTable')` — which took
 * down retry for every provider. A hand-written list of relation names would rot
 * exactly the way the `with` clause did, so read the real one.
 */
function loadMessageRelationNames(): Set<string> {
  const source = readFileSync(
    path.resolve(__dirname, '../../../../database/src/db/relations/messaging.ts'),
    'utf8'
  )
  const block = source.split('export const messageRelations')[1]?.split('\nexport const')[0] ?? ''
  const names = new Set<string>()
  for (const line of block.split('\n')) {
    if (line.trim().startsWith('//')) continue
    const match = line.match(/^ {2}(\w+): (?:one|many)\(/)
    if (match?.[1]) names.add(match[1])
  }
  return names
}

const MESSAGE_RELATIONS = loadMessageRelationNames()

/** Reproduces Drizzle's failure mode for a `with` key that names no relation. */
function assertRelationsExist(withClause: Record<string, unknown>): void {
  for (const key of Object.keys(withClause)) {
    if (!MESSAGE_RELATIONS.has(key)) {
      throw new TypeError("Cannot read properties of undefined (reading 'referencedTable')")
    }
  }
}

const failedMessageRow = {
  id: 'msg-1',
  organizationId: 'org-1',
  threadId: 'thread-1',
  sendStatus: 'FAILED',
  attempts: 1,
  subject: 'Re: Hello',
  textHtml: '<p>hi</p>',
  textPlain: 'hi',
  messageId: '<abc@auxx.ai>',
  references: null,
  inReplyTo: null,
  thread: { id: 'thread-1', organizationId: 'org-1', integrationId: 'int-1', externalId: 'ext-1' },
  from: { id: 'p-1', identifier: 'agent@auxx.ai' },
  participants: [],
}

/** Private surface — the retry entry point is not reachable without a provider. */
function createService(): any {
  return new MessageSenderService('org-1')
}

beforeEach(() => {
  mocks.messageFindFirst.mockReset()
  mocks.messageFindFirst.mockImplementation(async (args: any) => {
    assertRelationsExist(args?.with ?? {})
    return failedMessageRow
  })
})

describe('loadFailedMessage', () => {
  it('loads a failed message without asking for a relation Drizzle does not have', async () => {
    const row = await createService().loadFailedMessage('msg-1')

    expect(row.id).toBe('msg-1')
    expect(mocks.messageFindFirst).toHaveBeenCalledTimes(1)
  })

  it('never requests the removed `signature` relation', async () => {
    await createService().loadFailedMessage('msg-1')

    const requested = Object.keys(mocks.messageFindFirst.mock.calls[0]?.[0]?.with ?? {})
    expect(requested.length).toBeGreaterThan(0)
    expect(requested).not.toContain('signature')
    expect(MESSAGE_RELATIONS.has('signature')).toBe(false)
    for (const relation of requested) {
      expect([...MESSAGE_RELATIONS]).toContain(relation)
    }
  })

  it('throws a plain not-found error when the message is missing', async () => {
    mocks.messageFindFirst.mockResolvedValueOnce(undefined)

    await expect(createService().loadFailedMessage('nope')).rejects.toThrow(
      'Message nope not found'
    )
  })
})

describe('validateRetryEligibility', () => {
  it('accepts a FAILED message in the caller organization', () => {
    expect(() => createService().validateRetryEligibility(failedMessageRow, 'org-1')).not.toThrow()
  })

  it('rejects a message that is not FAILED', () => {
    expect(() =>
      createService().validateRetryEligibility({ ...failedMessageRow, sendStatus: 'SENT' }, 'org-1')
    ).toThrow('Only FAILED messages can be retried')
  })

  it('rejects a message that belongs to another organization', () => {
    expect(() => createService().validateRetryEligibility(failedMessageRow, 'org-2')).toThrow(
      'Unauthorized'
    )
  })

  it('rejects a message that exhausted its retries', () => {
    expect(() =>
      createService().validateRetryEligibility({ ...failedMessageRow, attempts: 5 }, 'org-1')
    ).toThrow('Maximum retry attempts')
  })
})
