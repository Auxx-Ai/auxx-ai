// packages/lib/src/data-migrations/migrations/099-imap-backfill-stamps.test.ts
//
// Pre-fix IMAP channels carry neither backfill stamp, and the consume side now
// fails CLOSED (#1721) — so without this migration every existing IMAP channel
// would open a fresh suppression window at its next poll. The planner is the
// decision worth testing: already-backfilled channels get a CLOSED window
// (both stamps — leaving `initialBackfillCompletedAt` unset would suppress
// `message:received` forever), never-synced channels get an OPEN one (cutoff
// alone), and any row already carrying a stamp is untouched (insert-only — a
// migration re-run must never reopen a closed window).

import type { Database } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { migration099ImapBackfillStamps, planImapBackfillStamps } from './099-imap-backfill-stamps'

interface StoredIntegration {
  id: string
  metadata: unknown
  lastSuccessfulSync: Date | null
}

const integration = (over: Partial<StoredIntegration> = {}): StoredIntegration => ({
  id: 'int-1',
  metadata: { email: 'ops@example.com' },
  lastSuccessfulSync: new Date('2026-08-01T00:00:00.000Z'),
  ...over,
})

/** Walk a built Drizzle condition / SQL object for any of the ids we know about. */
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

/** Collect every literal string inside a Drizzle SQL object (template chunks). */
function sqlText(node: unknown, out: string[] = [], depth = 0): string {
  if (depth > 10 || node === null || node === undefined) return out.join(' ')
  if (typeof node === 'string') {
    out.push(node)
    return out.join(' ')
  }
  if (typeof node === 'object') {
    for (const value of Object.values(node as Record<string, unknown>)) {
      sqlText(value, out, depth + 1)
    }
  }
  return out.join(' ')
}

function createFakeDb(rows: StoredIntegration[]) {
  const updates: Array<{ id: string | null; patch: Record<string, unknown> }> = []

  const selectChain: Record<string, unknown> = {}
  for (const method of ['from', 'where', 'limit', 'orderBy']) {
    selectChain[method] = () => selectChain
  }
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable query-builder mock
  selectChain.then = (onOk: (v: StoredIntegration[]) => unknown, onErr: (e: unknown) => unknown) =>
    Promise.resolve(rows.map((r) => ({ ...r }))).then(onOk, onErr)

  const db = {
    select: () => selectChain,
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: async (condition: unknown) => {
          updates.push({
            id: findRowId(
              condition,
              rows.map((r) => r.id)
            ),
            patch,
          })
        },
      }),
    }),
  } as unknown as Database

  return { db, updates }
}

describe('planImapBackfillStamps', () => {
  it('closes the window for a channel that already completed a sync', () => {
    expect(planImapBackfillStamps(integration())).toBe('both')
  })

  it('opens a window (cutoff only) for a channel that never synced', () => {
    expect(planImapBackfillStamps(integration({ lastSuccessfulSync: null }))).toBe('cutoff-only')
  })

  it('never rewrites an existing stamp (insert-only)', () => {
    expect(
      planImapBackfillStamps(
        integration({ metadata: { backfillCutoffAt: '2026-08-20T10:00:00.000Z' } })
      )
    ).toBe('skip')
    expect(
      planImapBackfillStamps(
        integration({ metadata: { initialBackfillCompletedAt: '2026-08-20T10:00:00.000Z' } })
      )
    ).toBe('skip')
  })

  it('tolerates malformed metadata', () => {
    expect(planImapBackfillStamps(integration({ metadata: null }))).toBe('both')
    expect(planImapBackfillStamps(integration({ metadata: 'garbage' }))).toBe('both')
    expect(
      planImapBackfillStamps(integration({ metadata: ['array'], lastSuccessfulSync: null }))
    ).toBe('cutoff-only')
  })
})

describe('migration 099 run', () => {
  it('stamps both fields for a synced channel and only the cutoff for a never-synced one', async () => {
    const fake = createFakeDb([
      integration({ id: 'int-synced' }),
      integration({ id: 'int-fresh', lastSuccessfulSync: null }),
      integration({
        id: 'int-stamped',
        metadata: { backfillCutoffAt: '2026-08-20T10:00:00.000Z' },
      }),
    ])

    await migration099ImapBackfillStamps.run(fake.db)

    expect(fake.updates.map((u) => u.id)).toEqual(['int-synced', 'int-fresh'])

    const synced = sqlText(fake.updates[0]!.patch.metadata)
    expect(synced).toContain('backfillCutoffAt')
    expect(synced).toContain('initialBackfillCompletedAt')

    const fresh = sqlText(fake.updates[1]!.patch.metadata)
    expect(fresh).toContain('backfillCutoffAt')
    expect(fresh).not.toContain('initialBackfillCompletedAt')
  })

  it('is a no-op when every row already carries a stamp', async () => {
    const fake = createFakeDb([
      integration({ id: 'int-1', metadata: { initialBackfillCompletedAt: '2026-08-20' } }),
    ])

    await migration099ImapBackfillStamps.run(fake.db)

    expect(fake.updates).toEqual([])
  })

  it('exposes the migration under the id the ledger reserved', () => {
    expect(migration099ImapBackfillStamps.id).toBe('099-imap-backfill-stamps')
  })
})
