// packages/lib/src/data-migrations/run-pending-data-migrations.test.ts

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataMigrationDef } from './types'

// The real registry imports ~90 migration modules; the advisory lock talks to pg.
// Both are replaced so this file tests only what the runner records on failure.
const registry: DataMigrationDef[] = []

vi.mock('./registry', () => ({
  get ALL_DATA_MIGRATIONS() {
    return registry
  },
}))

vi.mock('./advisory-lock', () => ({
  DATA_MIGRATION_LOCK_KEY: 1,
  withAdvisoryLock: async <T>(_db: unknown, _key: number, fn: () => Promise<T>): Promise<T> => fn(),
}))

const { runPendingDataMigrations } = await import('./run-pending-data-migrations')

/** Minimal ledger stand-in: empty on read, capturing on write. */
function createLedgerDb(): { db: Database; writes: Record<string, unknown>[] } {
  const writes: Record<string, unknown>[] = []
  const db = {
    select: () => ({ from: async () => [] }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: async () => {
          writes.push(values)
        },
      }),
    }),
  }
  return { db: db as unknown as Database, writes }
}

beforeEach(() => {
  registry.length = 0
})

describe('runPendingDataMigrations failure recording', () => {
  it('records the unwrapped pg cause, not just the Drizzle wrapper message', async () => {
    const pg = Object.assign(new Error('column "searchText" does not exist'), {
      name: 'error',
      code: '42703',
      table: 'Thread',
      column: 'searchText',
    })
    const drizzle = Object.assign(
      new Error('Failed query: update "Thread" set "searchText" = $1\nparams: secret@example.com'),
      {
        name: 'DrizzleQueryError',
        query: 'update "Thread" set "searchText" = $1',
        params: ['secret@example.com'],
        cause: pg,
      }
    )

    registry.push({
      id: '069-backfill-thread-search-text',
      description: 'backfill',
      run: async () => {
        throw new Error('backfill failed', { cause: drizzle })
      },
    })

    const { db, writes } = createLedgerDb()
    const summary = await runPendingDataMigrations(db)

    expect(summary).toEqual({ applied: [], skipped: [], failed: '069-backfill-thread-search-text' })
    expect(writes).toHaveLength(1)

    const recorded = writes[0]!
    expect(recorded.status).toBe('failed')
    const error = recorded.error as string
    expect(error).toContain('backfill failed')
    expect(error).toContain('code=42703')
    expect(error).toContain('table=Thread column=searchText')
    expect(error).toContain('column "searchText" does not exist')
    // Bound parameters never reach the ledger.
    expect(error).not.toContain('secret@example.com')
    expect(error.length).toBeLessThanOrEqual(2_000)
  })

  it('still records applied migrations with a null error', async () => {
    registry.push({ id: '070-noop', description: 'noop', run: async () => {} })

    const { db, writes } = createLedgerDb()
    const summary = await runPendingDataMigrations(db)

    expect(summary).toEqual({ applied: ['070-noop'], skipped: [] })
    expect(writes[0]).toMatchObject({ id: '070-noop', status: 'applied', error: null })
  })
})
