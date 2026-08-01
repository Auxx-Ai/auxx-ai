// packages/lib/src/messages/__tests__/message-reconciler.window.test.ts

import type { Database } from '@auxx/database'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessageData } from '../../ingest/types'
import { MessageReconcilerService } from '../message-reconciler.service'
import type { ThreadManagerService } from '../thread-manager.service'

/**
 * Strategy 2 of `reconcileIncomingSync` — subject + time window — is the only
 * thing that stops an Outlook Sent-Items echo from becoming a second copy of a
 * message we just sent, in a forked thread. It used to compare the echo's
 * `sentAt` against `new Date()` (the moment of INGEST) rather than against the
 * candidate row's `createdAt`, so it only ever fired when the provider happened
 * to poll within 60s of the send. Outlook polls every ~3 minutes.
 *
 * These tests drive the real relational-query predicate: the fake `db` below
 * invokes the `where` / `orderBy` callbacks the service passes and evaluates
 * them against in-memory rows, so a wrong predicate fails here the same way it
 * fails in Postgres. It also honours `columns` strictly — a projection that
 * forgets `createdAt` yields a row without it, exactly as Drizzle would.
 */

type Row = Record<string, any>
type Predicate = (row: Row) => boolean

/** `messages.createdAt` → `'createdAt'`, so predicates close over column names. */
const columnRefs = new Proxy({} as Record<string, string>, {
  get: (_target, key: string) => key,
})

/** Dates compare by epoch; everything else by value. */
function comparable(value: unknown): unknown {
  return value instanceof Date ? value.getTime() : value
}

const whereOperators = {
  eq:
    (col: string, value: unknown): Predicate =>
    (row) =>
      comparable(row[col]) === comparable(value),
  ne:
    (col: string, value: unknown): Predicate =>
    (row) =>
      comparable(row[col]) !== comparable(value),
  gt:
    (col: string, value: unknown): Predicate =>
    (row) =>
      (comparable(row[col]) as number) > (comparable(value) as number),
  gte:
    (col: string, value: unknown): Predicate =>
    (row) =>
      (comparable(row[col]) as number) >= (comparable(value) as number),
  lt:
    (col: string, value: unknown): Predicate =>
    (row) =>
      (comparable(row[col]) as number) < (comparable(value) as number),
  lte:
    (col: string, value: unknown): Predicate =>
    (row) =>
      (comparable(row[col]) as number) <= (comparable(value) as number),
  inArray:
    (col: string, values: unknown[]): Predicate =>
    (row) =>
      values.includes(row[col]),
  notInArray:
    (col: string, values: unknown[]): Predicate =>
    (row) =>
      !values.includes(row[col]),
  isNull:
    (col: string): Predicate =>
    (row) =>
      row[col] === null || row[col] === undefined,
  isNotNull:
    (col: string): Predicate =>
    (row) =>
      row[col] !== null && row[col] !== undefined,
  and:
    (...predicates: (Predicate | undefined)[]): Predicate =>
    (row) =>
      predicates.every((predicate) => (predicate ? predicate(row) : true)),
  or:
    (...predicates: (Predicate | undefined)[]): Predicate =>
    (row) =>
      predicates.some((predicate) => (predicate ? predicate(row) : false)),
  not:
    (predicate: Predicate): Predicate =>
    (row) =>
      !predicate(row),
}

type OrderSpec = { col: string; direction: 1 | -1 }
const orderOperators = {
  asc: (col: string): OrderSpec => ({ col, direction: 1 }),
  desc: (col: string): OrderSpec => ({ col, direction: -1 }),
}

function project(row: Row, columns?: Record<string, boolean>): Row {
  if (!columns) return { ...row }
  const out: Row = {}
  for (const [key, wanted] of Object.entries(columns)) {
    if (wanted) out[key] = row[key]
  }
  return out
}

function createTable(rows: Row[]) {
  const select = (args: any): Row[] => {
    const predicate: Predicate | undefined = args?.where?.(columnRefs, whereOperators)
    let matched = predicate ? rows.filter(predicate) : [...rows]

    const ordering = args?.orderBy?.(columnRefs, orderOperators)
    if (ordering) {
      const specs: OrderSpec[] = Array.isArray(ordering) ? ordering : [ordering]
      matched = [...matched].sort((a, b) => {
        for (const spec of specs) {
          const left = comparable(a[spec.col]) as number
          const right = comparable(b[spec.col]) as number
          if (left !== right) return (left < right ? -1 : 1) * spec.direction
        }
        return 0
      })
    }

    return matched.map((row) => project(row, args?.columns))
  }

  return {
    findFirst: vi.fn(async (args: any) => select(args)[0]),
    findMany: vi.fn(async (args: any) => select(args)),
  }
}

function createDb(messageRows: Row[], threadRows: Row[]) {
  const updateWhere = vi.fn(async () => undefined)
  const updateSet = vi.fn(() => ({ where: updateWhere }))
  const update = vi.fn(() => ({ set: updateSet }))
  const deleteWhere = vi.fn(async () => undefined)

  return {
    update,
    updateSet,
    updateWhere,
    delete: vi.fn(() => ({ where: deleteWhere })),
    query: {
      Message: createTable(messageRows),
      Thread: createTable(threadRows),
    },
  }
}

const ORG_ID = 'org-1'
const INTEGRATION_ID = 'int-1'
const SUBJECT = 'Re: Hello'
/** The send in the bug report: 2026-08-01 05:40:33. */
const SENT_AT = new Date('2026-08-01T05:40:33.000Z')

function localSentRow(overrides: Row = {}): Row {
  return {
    id: 'msg-local',
    organizationId: ORG_ID,
    integrationId: INTEGRATION_ID,
    subject: SUBJECT,
    sendStatus: 'PENDING',
    sendToken: 'send-token-1',
    internetMessageId: '<auxx.1785562832447.af29126a@localhost>',
    threadId: 'thread-1',
    createdAt: SENT_AT,
    textPlain: 'hello',
    textHtml: '<p>hello</p>',
    snippet: 'hello',
    ...overrides,
  }
}

/** The Sent-Items copy Graph hands back: new externalId, no shared Message-ID. */
function sentItemsEcho(overrides: Partial<MessageData> = {}): MessageData {
  return {
    externalId: 'AAMkAGE1M2_echo',
    externalThreadId: 'ofcUygcDWUy-bMGbiGNRrA==',
    integrationId: INTEGRATION_ID,
    organizationId: ORG_ID,
    isInbound: false,
    subject: SUBJECT,
    createdTime: SENT_AT,
    sentAt: SENT_AT,
    receivedAt: SENT_AT,
    from: { identifier: 'auxx-shopify@outlook.com' } as any,
    to: [],
    hasAttachments: false,
    internetMessageId: '<SA1PR19MB7062B22F6EB06B5FEE53F48A97D72@outlook.com>',
    ...overrides,
  } as MessageData
}

function createService(db: ReturnType<typeof createDb>) {
  const threadManager = {
    updateThreadMetadata: vi.fn(async () => undefined),
    reconcileThread: vi.fn(async () => undefined),
  } as unknown as ThreadManagerService

  return new MessageReconcilerService(ORG_ID, threadManager, db as unknown as Database)
}

/** Simulates the echo being ingested `seconds` after the send. */
function ingestAt(seconds: number): void {
  vi.setSystemTime(new Date(SENT_AT.getTime() + seconds * 1000))
}

beforeEach(() => {
  // Only `Date` is faked — faking timers wholesale would stall unrelated async
  // work in the module graph.
  vi.useFakeTimers({ toFake: ['Date'] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('reconcileIncomingSync — Strategy 2 time window', () => {
  it('reconciles an echo ingested 77 seconds after the send (the observed failure)', async () => {
    const db = createDb([localSentRow()], [{ id: 'thread-1', externalId: 'ext-real' }])
    ingestAt(77)

    const result = await createService(db).reconcileIncomingSync(sentItemsEcho())

    expect(result).toEqual({ isReconciled: true, existingMessageId: 'msg-local' })
  })

  it('selects `createdAt`, so the window is measured against the candidate row', async () => {
    const db = createDb([localSentRow()], [{ id: 'thread-1', externalId: 'ext-real' }])
    ingestAt(77)

    await createService(db).reconcileIncomingSync(sentItemsEcho())

    const strategyTwoArgs = db.query.Message.findFirst.mock.calls[1]?.[0]
    expect(strategyTwoArgs?.columns?.createdAt).toBe(true)
  })

  it('reconciles an echo ingested 4 minutes after the send', async () => {
    const db = createDb([localSentRow()], [{ id: 'thread-1', externalId: 'ext-real' }])
    ingestAt(240)

    const result = await createService(db).reconcileIncomingSync(sentItemsEcho())

    expect(result).toEqual({ isReconciled: true, existingMessageId: 'msg-local' })
  })

  it('does not reconcile an echo ingested 10 minutes later (outside the SQL window)', async () => {
    const db = createDb([localSentRow()], [])
    ingestAt(600)

    const result = await createService(db).reconcileIncomingSync(sentItemsEcho())

    expect(result).toEqual({ isReconciled: false })
  })

  it('does not reconcile when the echo `sentAt` is 10 minutes off the candidate', async () => {
    const db = createDb([localSentRow()], [])
    ingestAt(30)

    const result = await createService(db).reconcileIncomingSync(
      sentItemsEcho({ sentAt: new Date(SENT_AT.getTime() + 600_000) })
    )

    expect(result).toEqual({ isReconciled: false })
  })

  it('does not reconcile a message with no `sentAt`', async () => {
    const db = createDb([localSentRow()], [])
    ingestAt(30)

    const result = await createService(db).reconcileIncomingSync(
      sentItemsEcho({ sentAt: undefined as unknown as Date })
    )

    expect(result).toEqual({ isReconciled: false })
  })
})

describe('reconcileIncomingSync — Strategy 2 candidate selectivity', () => {
  it('does not reconcile a same-subject message on a different integration', async () => {
    const db = createDb([localSentRow({ integrationId: 'int-other' })], [])
    ingestAt(77)

    const result = await createService(db).reconcileIncomingSync(sentItemsEcho())

    expect(result).toEqual({ isReconciled: false })
  })

  it('does not reconcile a same-subject message with a null `sendToken`', async () => {
    const db = createDb([localSentRow({ sendToken: null })], [])
    ingestAt(77)

    const result = await createService(db).reconcileIncomingSync(sentItemsEcho())

    expect(result).toEqual({ isReconciled: false })
  })

  it('picks the nearest candidate by `createdAt` when two same-subject sends are in the window', async () => {
    const older = localSentRow({
      id: 'msg-older',
      sendToken: 'send-token-older',
      internetMessageId: '<auxx.older@localhost>',
      threadId: 'thread-older',
      createdAt: new Date(SENT_AT.getTime() - 30_000),
    })
    const newer = localSentRow({ id: 'msg-newer' })
    // Insertion order deliberately favours the older row, so an unordered
    // `findFirst` would return the wrong one.
    const db = createDb(
      [older, newer],
      [
        { id: 'thread-1', externalId: 'ext-real' },
        { id: 'thread-older', externalId: 'ext-older' },
      ]
    )
    ingestAt(77)

    const result = await createService(db).reconcileIncomingSync(sentItemsEcho())

    expect(result).toEqual({ isReconciled: true, existingMessageId: 'msg-newer' })
  })
})

describe('reconcileIncomingSync — Strategy 1 still wins', () => {
  it('reconciles by `internetMessageId` in preference to the subject heuristic', async () => {
    const byMessageId = localSentRow({
      id: 'msg-by-message-id',
      subject: 'Something else entirely',
      sendToken: null,
      internetMessageId: '<shared-id@auxx.ai>',
      threadId: 'thread-mid',
      createdAt: new Date(SENT_AT.getTime() - 4 * 60_000),
    })
    const db = createDb(
      [byMessageId, localSentRow()],
      [
        { id: 'thread-mid', externalId: 'ext-mid' },
        { id: 'thread-1', externalId: 'ext-real' },
      ]
    )
    ingestAt(77)

    const result = await createService(db).reconcileIncomingSync(
      sentItemsEcho({ internetMessageId: '<shared-id@auxx.ai>' })
    )

    expect(result).toEqual({ isReconciled: true, existingMessageId: 'msg-by-message-id' })
  })
})
