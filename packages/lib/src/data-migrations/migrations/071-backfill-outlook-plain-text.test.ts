// packages/lib/src/data-migrations/migrations/071-backfill-outlook-plain-text.test.ts

import type { Database } from '@auxx/database'
import { describe, expect, it, vi } from 'vitest'
import {
  backfillOutlookPlainText,
  type OutlookTextCandidate,
  planMessageTextPatch,
  type StoredBodyReaderFactory,
} from './071-backfill-outlook-plain-text'

/**
 * The migration is not a single statement (most Outlook bodies live in object
 * storage), so unlike 068–070 its loop is the thing worth testing: what it
 * recovers, what it steps over, and what it refuses to overwrite.
 *
 * The DB is a tiny in-memory stand-in rather than a live Postgres. It models the
 * one property the loop depends on — the `textPlain IS NULL OR = ''` predicate —
 * so "a second run writes nothing" is a real assertion and not a tautology.
 * Drizzle conditions are opaque under vitest (columns are `undefined`), so the
 * stand-in locates the updated row by finding a known id inside the built
 * condition rather than by asserting on column identity.
 */

interface StoredMessage extends OutlookTextCandidate {
  textPlain: string | null
}

const message = (over: Partial<StoredMessage> = {}): StoredMessage => ({
  id: 'msg-1',
  organizationId: 'org-1',
  textHtml: null,
  textPlain: null,
  snippet: null,
  htmlBodyStorageLocationId: null,
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
  // Mirrors the real statement: still-empty rows only, keyset-ordered past the cursor.
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable query-builder mock
  selectChain.then = (
    onOk: (v: OutlookTextCandidate[]) => unknown,
    onErr: (e: unknown) => unknown
  ) => {
    const page = rows
      .filter((r) => r.id > cursor && (r.textPlain === null || r.textPlain === ''))
      .sort((a, b) => a.id.localeCompare(b.id))
    if (page.length > 0) cursor = page[page.length - 1]!.id
    return Promise.resolve(page.map((r) => ({ ...r }))).then(onOk, onErr)
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

const readerFor = (html: string) => {
  const getContent = vi.fn().mockResolvedValue(Buffer.from(html, 'utf-8'))
  const factory: StoredBodyReaderFactory = vi.fn(() => ({ getContent }))
  return { getContent, factory: factory as StoredBodyReaderFactory & ReturnType<typeof vi.fn> }
}

/** A fresh run always starts its keyset scan from the top, as the runner does. */
function run(fake: ReturnType<typeof createFakeDb>, factory: StoredBodyReaderFactory) {
  fake.resetCursor()
  return backfillOutlookPlainText(fake.db, factory)
}

describe('planMessageTextPatch', () => {
  it('derives text and a snippet for a row that has neither', () => {
    expect(planMessageTextPatch({ snippet: null }, '<p>Hello there</p>')).toEqual({
      textPlain: 'Hello there',
      snippet: 'Hello there',
    })
  })

  it('keeps a snippet that is already populated', () => {
    expect(planMessageTextPatch({ snippet: 'Sender preview' }, '<p>Hello there</p>')).toEqual({
      textPlain: 'Hello there',
    })
  })

  it('treats a blank snippet as absent', () => {
    expect(planMessageTextPatch({ snippet: '   ' }, '<p>Hello</p>')).toMatchObject({
      snippet: 'Hello',
    })
  })

  it('writes nothing when there is no HTML at all', () => {
    expect(planMessageTextPatch({ snippet: null }, null)).toBeNull()
  })

  // Writing '' would leave the row matching the predicate anyway — a write that
  // buys nothing and makes the next run look like it had work to do.
  it('writes nothing when the HTML renders to an empty string', () => {
    expect(planMessageTextPatch({ snippet: null }, '<style>a{color:red}</style>')).toBeNull()
  })

  it('never returns textHtml or the storage id', () => {
    const patch = planMessageTextPatch({ snippet: null }, '<p>Hi</p>')
    expect(Object.keys(patch ?? {}).sort()).toEqual(['snippet', 'textPlain'])
  })
})

describe('backfillOutlookPlainText', () => {
  it('derives textPlain from the inline column without touching storage', async () => {
    const fake = createFakeDb([message({ textHtml: '<p>Inline body</p>' })])
    const { getContent, factory } = readerFor('unused')

    const counts = await run(fake, factory)

    expect(getContent).not.toHaveBeenCalled()
    expect(counts).toEqual({ scanned: 1, updated: 1, skipped: 0, failed: 0 })
    expect(fake.updates).toHaveLength(1)
    expect(fake.updates[0]).toMatchObject({
      id: 'msg-1',
      patch: { textPlain: 'Inline body', snippet: 'Inline body' },
    })
  })

  it('fetches an object-backed body and derives textPlain from it', async () => {
    const fake = createFakeDb([message({ htmlBodyStorageLocationId: 'loc-9' })])
    const { getContent, factory } = readerFor('<p>Body from S3</p>')

    const counts = await run(fake, factory)

    // The storage manager is per-org, so the loop asks for one per org group.
    expect(factory).toHaveBeenCalledWith('org-1')
    expect(getContent).toHaveBeenCalledWith('loc-9')
    expect(counts).toEqual({ scanned: 1, updated: 1, skipped: 0, failed: 0 })
    expect(fake.updates[0]?.patch).toEqual({
      textPlain: 'Body from S3',
      snippet: 'Body from S3',
    })
  })

  it('skips a row with neither an inline body nor a storage location — not a failure', async () => {
    const fake = createFakeDb([message()])
    const { factory } = readerFor('unused')

    const counts = await run(fake, factory)

    expect(counts).toEqual({ scanned: 1, updated: 0, skipped: 1, failed: 0 })
    expect(fake.updates).toEqual([])
  })

  it('counts an unreadable blob as failed and still resolves', async () => {
    const fake = createFakeDb([message({ htmlBodyStorageLocationId: 'loc-pruned' })])
    const getContent = vi.fn().mockRejectedValue(new Error('storage location not found'))
    const factory: StoredBodyReaderFactory = () => ({ getContent })

    const counts = await run(fake, factory)

    expect(counts).toEqual({ scanned: 1, updated: 0, skipped: 0, failed: 1 })
    expect(fake.updates).toEqual([])
  })

  it('carries on with the rest of the batch after one body fails', async () => {
    const fake = createFakeDb([
      message({ id: 'msg-1', htmlBodyStorageLocationId: 'loc-pruned' }),
      message({ id: 'msg-2', textHtml: '<p>Still fine</p>' }),
      message({ id: 'msg-3' }),
    ])
    const getContent = vi.fn().mockRejectedValue(new Error('404'))
    const factory: StoredBodyReaderFactory = () => ({ getContent })

    const counts = await run(fake, factory)

    expect(counts).toEqual({ scanned: 3, updated: 1, skipped: 1, failed: 1 })
    expect(fake.updates.map((u) => u.id)).toEqual(['msg-2'])
  })

  it('leaves an existing snippet alone while writing textPlain', async () => {
    const fake = createFakeDb([
      message({ textHtml: '<p>New body text</p>', snippet: 'Graph bodyPreview' }),
    ])
    const { factory } = readerFor('unused')

    await run(fake, factory)

    expect(fake.updates[0]?.patch).toEqual({ textPlain: 'New body text' })
    expect(fake.rows[0]?.snippet).toBe('Graph bodyPreview')
  })

  it('never writes textHtml or htmlBodyStorageLocationId', async () => {
    const fake = createFakeDb([message({ htmlBodyStorageLocationId: 'loc-9' })])
    const { factory } = readerFor('<p>Body</p>')

    await run(fake, factory)

    for (const update of fake.updates) {
      expect(update.patch).not.toHaveProperty('textHtml')
      expect(update.patch).not.toHaveProperty('htmlBodyStorageLocationId')
    }
    expect(fake.rows[0]?.htmlBodyStorageLocationId).toBe('loc-9')
    expect(fake.rows[0]?.textHtml).toBeNull()
  })

  it('groups by organization so each org gets its own storage manager', async () => {
    const fake = createFakeDb([
      message({ id: 'msg-1', organizationId: 'org-a', htmlBodyStorageLocationId: 'loc-a' }),
      message({ id: 'msg-2', organizationId: 'org-b', htmlBodyStorageLocationId: 'loc-b' }),
      message({ id: 'msg-3', organizationId: 'org-a', htmlBodyStorageLocationId: 'loc-c' }),
    ])
    const { factory } = readerFor('<p>Body</p>')

    await run(fake, factory)

    expect(factory).toHaveBeenCalledTimes(2)
    expect((factory as ReturnType<typeof vi.fn>).mock.calls.map(([org]) => org)).toEqual([
      'org-a',
      'org-b',
    ])
  })

  it('is idempotent — a second run over populated rows writes nothing', async () => {
    const fake = createFakeDb([
      message({ id: 'msg-1', textHtml: '<p>One</p>' }),
      message({ id: 'msg-2', htmlBodyStorageLocationId: 'loc-2' }),
    ])
    const { factory } = readerFor('<p>Two</p>')

    const first = await run(fake, factory)
    expect(first).toEqual({ scanned: 2, updated: 2, skipped: 0, failed: 0 })

    fake.updates.length = 0
    const second = await run(fake, factory)

    expect(second).toEqual({ scanned: 0, updated: 0, skipped: 0, failed: 0 })
    expect(fake.updates).toEqual([])
    expect(fake.rows.map((r) => r.textPlain)).toEqual(['One', 'Two'])
  })

  // The runner restarts a failed migration from the top, so a row that was still
  // empty when the previous attempt died has to be picked up again.
  it('re-attempts a row a previous run left empty', async () => {
    const fake = createFakeDb([message({ id: 'msg-1', htmlBodyStorageLocationId: 'loc-1' })])
    const failing: StoredBodyReaderFactory = () => ({
      getContent: vi.fn().mockRejectedValue(new Error('404')),
    })

    expect(await run(fake, failing)).toMatchObject({ failed: 1, updated: 0 })

    const { factory } = readerFor('<p>Recovered</p>')
    expect(await run(fake, factory)).toMatchObject({ failed: 0, updated: 1 })
    expect(fake.rows[0]?.textPlain).toBe('Recovered')
  })

  it('does nothing at all when no Outlook message is missing text', async () => {
    const fake = createFakeDb([message({ textPlain: 'already here' })])
    const { factory } = readerFor('unused')

    expect(await run(fake, factory)).toEqual({ scanned: 0, updated: 0, skipped: 0, failed: 0 })
    expect(fake.updates).toEqual([])
  })
})
