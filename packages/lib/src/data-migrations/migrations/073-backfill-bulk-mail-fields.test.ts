// packages/lib/src/data-migrations/migrations/073-backfill-bulk-mail-fields.test.ts

import type { Database } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import {
  type BulkMailCandidate,
  backfillBulkMailFields,
  migration073BackfillBulkMailFields,
  planBulkMailPatch,
} from './073-backfill-bulk-mail-fields'

/**
 * Like 071's test, the loop is the thing worth testing: what it derives, what it
 * steps over, and that a second run is a no-op.
 *
 * The DB is a tiny in-memory stand-in rather than a live Postgres. It models the
 * one property the loop depends on — the `isInbound AND senderDomain IS NULL` scan
 * predicate — so "a second run writes nothing" is a real assertion and not a
 * tautology. Drizzle conditions are opaque under vitest (columns are `undefined`),
 * so the stand-in locates the updated row by finding a known id inside the built
 * condition rather than by asserting on column identity.
 */

interface StoredMessage extends BulkMailCandidate {
  isInbound: boolean
  senderDomain: string | null
}

const message = (over: Partial<StoredMessage> = {}): StoredMessage => ({
  id: 'msg-1',
  metadata: null,
  fromEmail: 'news@mail.acme.com',
  isInbound: true,
  senderDomain: null,
  ...over,
})

/** Walk a built Drizzle condition for any of the ids we know about. */
function findRowId(condition: unknown, ids: string[], depth = 0): string | null {
  if (depth > 8 || condition === null || condition === undefined) return null
  if (typeof condition === 'string') return ids.includes(condition) ? condition : null
  if (typeof condition !== 'object') return null

  for (const value of Object.values(condition as Record<string, unknown>)) {
    const found = findRowId(value, ids, depth + 1)
    if (found) return found
  }
  return null
}

function createFakeDb(rows: StoredMessage[]) {
  const updates: Array<{ id: string | null; patch: Record<string, unknown> }> = []
  let cursor = ''

  const selectChain: Record<string, unknown> = {}
  for (const method of ['from', 'innerJoin', 'where', 'orderBy', 'limit']) {
    selectChain[method] = () => selectChain
  }
  // Mirrors the real statement: inbound rows with no senderDomain, keyset-ordered
  // past the cursor.
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable query-builder mock
  selectChain.then = (
    onOk: (v: BulkMailCandidate[]) => unknown,
    onErr: (e: unknown) => unknown
  ) => {
    const page = rows
      .filter((r) => r.id > cursor && r.isInbound && r.senderDomain === null)
      .sort((a, b) => a.id.localeCompare(b.id))
    if (page.length > 0) cursor = page[page.length - 1]!.id
    return Promise.resolve(
      page.map((r) => ({ id: r.id, metadata: r.metadata, fromEmail: r.fromEmail }))
    ).then(onOk, onErr)
  }

  const db = {
    select: () => selectChain,
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: async (condition: unknown) => {
          const id = findRowId(
            condition,
            rows.map((r) => r.id)
          )
          updates.push({ id, patch })
          const row = rows.find((r) => r.id === id)
          if (row) Object.assign(row, patch)
        },
      }),
    }),
  } as unknown as Database

  return { db, rows, updates, resetCursor: () => (cursor = '') }
}

/** A fresh run always starts its keyset scan from the top, as the runner does. */
function run(fake: ReturnType<typeof createFakeDb>) {
  fake.resetCursor()
  return backfillBulkMailFields(fake.db)
}

const gmailHeaders = {
  'list-id': 'Acme Weekly <news.acme.com>',
  'list-unsubscribe': '<https://acme.com/u/1>, <mailto:u@acme.com>',
  'list-unsubscribe-post': 'List-Unsubscribe=One-Click',
  'authentication-results': 'mx.google.com; dkim=pass; spf=pass; dmarc=pass header.from=acme.com',
}

describe('planBulkMailPatch', () => {
  it('derives all four columns from Gmail-shaped history', () => {
    expect(
      planBulkMailPatch({
        id: 'm',
        metadata: { headers: gmailHeaders },
        fromEmail: 'news@mail.acme.com',
      })
    ).toEqual({
      listId: 'news.acme.com',
      senderDomain: 'acme.com',
      unsubscribeMeta: {
        httpUrl: 'https://acme.com/u/1',
        mailto: 'mailto:u@acme.com',
        oneClick: true,
      },
      senderAuthenticated: true,
    })
  })

  // §2.3: Outlook/IMAP history has list-id and list-unsubscribe allowlisted but
  // never carried list-unsubscribe-post or authentication-results.
  it('degrades gracefully on Outlook/IMAP history', () => {
    const patch = planBulkMailPatch({
      id: 'm',
      metadata: {
        headers: { 'list-id': '<news.acme.com>', 'list-unsubscribe': '<https://acme.com/u/1>' },
      },
      fromEmail: 'news@mail.acme.com',
    })

    expect(patch).toEqual({
      listId: 'news.acme.com',
      senderDomain: 'acme.com',
      unsubscribeMeta: { httpUrl: 'https://acme.com/u/1', oneClick: false },
    })
    // Invariant 3: unknown stays unknown — the column is never written to false
    // or true, so the read side keeps taking the conservative branch.
    expect(patch).not.toHaveProperty('senderAuthenticated')
  })

  it('derives senderDomain alone for a message with no bulk headers', () => {
    expect(planBulkMailPatch({ id: 'm', metadata: null, fromEmail: 'ann@acme.com' })).toEqual({
      senderDomain: 'acme.com',
    })
  })

  it('writes nothing when nothing could be derived', () => {
    expect(planBulkMailPatch({ id: 'm', metadata: null, fromEmail: null })).toBeNull()
    expect(planBulkMailPatch({ id: 'm', metadata: {}, fromEmail: 'chat-user-1' })).toBeNull()
  })

  it('tolerates metadata that is not an object with headers', () => {
    expect(planBulkMailPatch({ id: 'm', metadata: 'garbage', fromEmail: null })).toBeNull()
    expect(planBulkMailPatch({ id: 'm', metadata: { headers: 7 }, fromEmail: null })).toBeNull()
  })
})

describe('backfillBulkMailFields', () => {
  it('fills all four columns for a bulk message', async () => {
    const fake = createFakeDb([message({ metadata: { headers: gmailHeaders } })])

    const counts = await run(fake)

    expect(counts).toEqual({ scanned: 1, updated: 1, skipped: 0 })
    expect(fake.updates).toHaveLength(1)
    expect(fake.updates[0]).toMatchObject({
      id: 'msg-1',
      patch: { listId: 'news.acme.com', senderDomain: 'acme.com', senderAuthenticated: true },
    })
  })

  it('skips a row it can derive nothing for, without failing the run', async () => {
    const fake = createFakeDb([message({ fromEmail: 'chat:visitor-1', metadata: null })])

    expect(await run(fake)).toEqual({ scanned: 1, updated: 0, skipped: 1 })
    expect(fake.updates).toEqual([])
  })

  it('carries on with the rest of the batch past a row it cannot derive', async () => {
    const fake = createFakeDb([
      message({ id: 'msg-1', fromEmail: 'chat:visitor-1' }),
      message({ id: 'msg-2', metadata: { headers: gmailHeaders } }),
      message({ id: 'msg-3', fromEmail: 'ann@acme.com' }),
    ])

    expect(await run(fake)).toEqual({ scanned: 3, updated: 2, skipped: 1 })
    expect(fake.updates.map((u) => u.id)).toEqual(['msg-2', 'msg-3'])
  })

  it('never writes an explicit null over an unknown verdict', async () => {
    const fake = createFakeDb([
      message({ metadata: { headers: { 'list-id': '<news.acme.com>' } } }),
    ])

    await run(fake)

    expect(fake.updates[0]?.patch).not.toHaveProperty('senderAuthenticated')
    expect(fake.rows[0]?.senderDomain).toBe('acme.com')
  })

  it('is idempotent — a second run writes nothing', async () => {
    const fake = createFakeDb([
      message({ id: 'msg-1', metadata: { headers: gmailHeaders } }),
      message({ id: 'msg-2', fromEmail: 'ann@acme.com' }),
    ])

    expect(await run(fake)).toEqual({ scanned: 2, updated: 2, skipped: 0 })

    fake.updates.length = 0
    expect(await run(fake)).toEqual({ scanned: 0, updated: 0, skipped: 0 })
    expect(fake.updates).toEqual([])
  })

  // The runner restarts a failed migration from the top.
  it('re-derives a row a previous run left empty', async () => {
    const fake = createFakeDb([message({ id: 'msg-1', fromEmail: null })])

    expect(await run(fake)).toEqual({ scanned: 1, updated: 0, skipped: 1 })

    fake.rows[0]!.fromEmail = 'news@mail.acme.com'
    expect(await run(fake)).toEqual({ scanned: 1, updated: 1, skipped: 0 })
    expect(fake.rows[0]?.senderDomain).toBe('acme.com')
  })

  it('leaves outbound messages alone', async () => {
    const fake = createFakeDb([
      message({ id: 'msg-1', isInbound: false }),
      message({ id: 'msg-2', isInbound: true }),
    ])

    expect(await run(fake)).toEqual({ scanned: 1, updated: 1, skipped: 0 })
    expect(fake.updates.map((u) => u.id)).toEqual(['msg-2'])
  })

  it('does nothing at all when every inbound row is already derived', async () => {
    const fake = createFakeDb([message({ senderDomain: 'acme.com' })])

    expect(await run(fake)).toEqual({ scanned: 0, updated: 0, skipped: 0 })
    expect(fake.updates).toEqual([])
  })

  it('exposes the migration under the id the ledger reserved', () => {
    expect(migration073BackfillBulkMailFields.id).toBe('073-backfill-bulk-mail-fields')
  })
})
