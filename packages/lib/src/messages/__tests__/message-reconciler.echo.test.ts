// packages/lib/src/messages/__tests__/message-reconciler.echo.test.ts

import type { Database } from '@auxx/database'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessageData } from '../../ingest/types'
import { MessageReconcilerService } from '../message-reconciler.service'
import type { ThreadManagerService } from '../thread-manager.service'

/**
 * Strategy 0 of `reconcileIncomingSync` — exact correlation by the echoed
 * `Message.id`.
 *
 * We stamp `X-AuxxAi-Message-Id: <our Message.id>` on outbound mail. Graph strips
 * every transport header from the Sent Items copy but preserves custom `x-` names,
 * so the provider can read ours back into `MessageData.echoedMessageId`. That makes
 * the copy correlate by primary key instead of by the subject + time heuristic, and
 * it must run FIRST because it is exact.
 *
 * The header is attacker-controllable input, so the lookup is scoped to the
 * ingesting organization and requires `sendToken IS NOT NULL` (i.e. the row is one
 * WE sent). These tests assert both guards, and that any miss falls through to the
 * old strategies rather than throwing.
 *
 * Same harness as `message-reconciler.window.test.ts`: the fake `db` invokes the
 * `where` / `orderBy` callbacks the service passes and evaluates them against
 * in-memory rows, honouring `columns` strictly — so a wrong predicate fails here
 * the same way it fails in Postgres.
 */

type Row = Record<string, any>
type Predicate = (row: Row) => boolean

/** `messages.organizationId` → `'organizationId'`, so predicates close over column names. */
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
const OTHER_ORG_ID = 'org-2'
const INTEGRATION_ID = 'int-1'
const SUBJECT = 'Re: Hello'
const SENT_AT = new Date('2026-08-01T06:28:02.744Z')

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

const THREADS = [
  { id: 'thread-1', externalId: 'ext-real' },
  { id: 'thread-other', externalId: 'ext-other' },
]

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

describe('reconcileIncomingSync — Strategy 0, echoed X-AuxxAi-Message-Id', () => {
  it('reconciles onto exactly the row named by `echoedMessageId`', async () => {
    const db = createDb([localSentRow()], THREADS)
    // Far outside every heuristic window, to prove the match is the header alone.
    ingestAt(3 * 60 * 60)

    const result = await createService(db).reconcileIncomingSync(
      sentItemsEcho({ echoedMessageId: 'msg-local' })
    )

    expect(result).toEqual({ isReconciled: true, existingMessageId: 'msg-local' })
  })

  it('wins over a different row that the subject/time heuristic would have matched', async () => {
    // `msg-decoy` is newer, so `orderBy desc(createdAt)` in Strategy 2 would pick it.
    const decoy = localSentRow({
      id: 'msg-decoy',
      sendToken: 'send-token-decoy',
      internetMessageId: '<auxx.decoy@localhost>',
      threadId: 'thread-other',
      createdAt: new Date(SENT_AT.getTime() + 10_000),
    })
    const db = createDb([localSentRow(), decoy], THREADS)
    ingestAt(77)

    const result = await createService(db).reconcileIncomingSync(
      sentItemsEcho({ echoedMessageId: 'msg-local' })
    )

    expect(result).toEqual({ isReconciled: true, existingMessageId: 'msg-local' })
  })

  it('runs before Strategy 1, so it beats an `internetMessageId` match on another row', async () => {
    const byMessageId = localSentRow({
      id: 'msg-by-message-id',
      sendToken: 'send-token-mid',
      internetMessageId: '<shared-id@auxx.ai>',
      threadId: 'thread-other',
    })
    const db = createDb([byMessageId, localSentRow()], THREADS)
    ingestAt(77)

    const result = await createService(db).reconcileIncomingSync(
      sentItemsEcho({
        echoedMessageId: 'msg-local',
        internetMessageId: '<shared-id@auxx.ai>',
      })
    )

    expect(result).toEqual({ isReconciled: true, existingMessageId: 'msg-local' })
  })

  it('does not reconcile onto a row in another organization (security guard)', async () => {
    // Same id, different tenant: a header lifted across orgs must not resolve. The
    // subject heuristic cannot rescue it either, because it is org-scoped too.
    const foreign = localSentRow({ organizationId: OTHER_ORG_ID })
    const db = createDb([foreign], THREADS)
    ingestAt(77)

    const result = await createService(db).reconcileIncomingSync(
      sentItemsEcho({ echoedMessageId: 'msg-local' })
    )

    expect(result).toEqual({ isReconciled: false })
  })

  it('does not reconcile onto a row on another integration (security guard)', async () => {
    // Same org, different channel. An echo always arrives on the integration that
    // sent it, so a header naming a message from another mailbox is either forged
    // or wrong — and merging across channels crosses an inbox permission boundary,
    // the same hazard the thread-resolution ladder is scoped against.
    const otherChannel = localSentRow({ integrationId: 'int-other' })
    const db = createDb([otherChannel], THREADS)
    ingestAt(77)

    const result = await createService(db).reconcileIncomingSync(
      sentItemsEcho({ echoedMessageId: 'msg-local', internetMessageId: null })
    )

    expect(result).toEqual({ isReconciled: false })
  })

  it('does not reconcile onto a row with a null `sendToken` (spoof guard)', async () => {
    // A spoofed header must not be able to graft an inbound message onto a row we
    // never sent. Everything else about this row matches.
    const notSentByUs = localSentRow({ sendToken: null })
    const db = createDb([notSentByUs], THREADS)
    ingestAt(77)

    const result = await createService(db).reconcileIncomingSync(
      sentItemsEcho({ echoedMessageId: 'msg-local', internetMessageId: null })
    )

    expect(result).toEqual({ isReconciled: false })
  })

  it('falls through to the existing strategies when the id does not exist', async () => {
    const db = createDb([localSentRow()], THREADS)
    ingestAt(77)

    const result = await createService(db).reconcileIncomingSync(
      sentItemsEcho({ echoedMessageId: 'msg-does-not-exist' })
    )

    // Strategy 2 still matches by subject + time — no throw, no lost reconciliation.
    expect(result).toEqual({ isReconciled: true, existingMessageId: 'msg-local' })
  })

  it('falls through to Strategy 1 when the id does not exist', async () => {
    const byMessageId = localSentRow({
      id: 'msg-by-message-id',
      subject: 'Something else entirely',
      sendToken: null,
      internetMessageId: '<shared-id@auxx.ai>',
      threadId: 'thread-other',
    })
    const db = createDb([byMessageId], THREADS)
    ingestAt(77)

    const result = await createService(db).reconcileIncomingSync(
      sentItemsEcho({
        echoedMessageId: 'msg-does-not-exist',
        internetMessageId: '<shared-id@auxx.ai>',
      })
    )

    expect(result).toEqual({ isReconciled: true, existingMessageId: 'msg-by-message-id' })
  })

  it('issues no Strategy 0 query at all when `echoedMessageId` is absent', async () => {
    const db = createDb([localSentRow()], THREADS)
    ingestAt(77)

    const result = await createService(db).reconcileIncomingSync(sentItemsEcho())

    expect(result).toEqual({ isReconciled: true, existingMessageId: 'msg-local' })

    // The first lookup must be Strategy 1's `internetMessageId` predicate, not an id
    // lookup: a row whose `id` matches but whose `internetMessageId` does not is
    // rejected by it.
    const firstPredicate = db.query.Message.findFirst.mock.calls[0]?.[0]?.where?.(
      columnRefs,
      whereOperators
    )
    expect(firstPredicate(localSentRow({ internetMessageId: '<not-the-echo@localhost>' }))).toBe(
      false
    )
    expect(
      firstPredicate(localSentRow({ internetMessageId: sentItemsEcho().internetMessageId }))
    ).toBe(true)
  })

  it('behaves exactly as today when `echoedMessageId` is null', async () => {
    const db = createDb([localSentRow()], THREADS)
    ingestAt(6 * 60 + 47)

    const result = await createService(db).reconcileIncomingSync(
      sentItemsEcho({ echoedMessageId: null })
    )

    expect(result).toEqual({ isReconciled: true, existingMessageId: 'msg-local' })
  })

  it('does not reconcile an unrelated inbound message that carries no echo header', async () => {
    const db = createDb([localSentRow()], THREADS)
    ingestAt(77)

    const result = await createService(db).reconcileIncomingSync(
      sentItemsEcho({
        subject: 'A completely different subject',
        internetMessageId: '<inbound-from-a-stranger@example.com>',
        isInbound: true,
      })
    )

    expect(result).toEqual({ isReconciled: false })
  })
})
