// packages/lib/src/mail-filters/runs.test.ts
// The claim protocol (plan §3, invariant 4). What matters here is the CONTRACT,
// not the log: `claimMailFilterRun` returns null when the unique
// `(filterId, messageId, source)` index already holds a row, and callers must
// bail — that null is the only thing standing between a gate retry and a second
// agent reply to the same customer.

import { describe, expect, it, vi } from 'vitest'
import { createChainableDatabaseMock } from '../test/database-mock'
import { claimMailFilterRun, markMailFilterRunUndone } from './runs'

// Partial mocks only — a full replacement of `@auxx/database` / `drizzle-orm`
// kills the file at COLLECTION as the import graph grows. The nested schema
// proxy yields printable column tokens (Drizzle columns are `undefined` under
// vitest), so the conflict target is inspectable.
vi.mock('@auxx/database', () => ({
  database: createChainableDatabaseMock(),
  schema: new Proxy(
    {},
    {
      get: (_t, table) => new Proxy({}, { get: (_c, col) => `${String(table)}.${String(col)}` }),
    }
  ),
}))

interface InsertCapture {
  values?: Record<string, unknown>
  conflict?: { target?: unknown[] }
}

/** `insert().values().onConflictDoNothing().returning()` resolving to `rows`. */
function fakeInsertDb(rows: { id: string }[]) {
  const captured: InsertCapture = {}
  const db = {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        captured.values = values
        return {
          onConflictDoNothing: (conflict: { target?: unknown[] }) => {
            captured.conflict = conflict
            return { returning: async () => rows }
          },
        }
      },
    }),
  } as never
  return { db, captured }
}

const claim = {
  organizationId: 'org_1',
  filterId: 'flt_1',
  threadId: 'thr_1',
  messageId: 'msg_1',
  source: 'live' as const,
}

describe('claimMailFilterRun', () => {
  it('returns the new run id when the claim wins', async () => {
    const { db } = fakeInsertDb([{ id: 'run_1' }])
    await expect(claimMailFilterRun(db, claim)).resolves.toBe('run_1')
  })

  it('returns null when the row already exists — the caller MUST NOT execute', async () => {
    const { db } = fakeInsertDb([])
    await expect(claimMailFilterRun(db, claim)).resolves.toBeNull()
  })

  it('claims on all three columns of the idempotency key', async () => {
    const { db, captured } = fakeInsertDb([{ id: 'run_1' }])
    await claimMailFilterRun(db, claim)

    expect(captured.conflict?.target).toEqual([
      'MailFilterRun.filterId',
      'MailFilterRun.messageId',
      'MailFilterRun.source',
    ])
  })

  it('claims as failed — a process that dies mid-run must not read as a success', async () => {
    const { db, captured } = fakeInsertDb([{ id: 'run_1' }])
    await claimMailFilterRun(db, claim)

    expect(captured.values?.status).toBe('failed')
    expect(captured.values?.outcomes).toEqual([])
    // `undo` is intentionally absent: the pre-action state has not been captured
    // yet at claim time — it is written by `completeMailFilterRun`.
    expect(captured.values?.undo).toBeUndefined()
  })
})

describe('markMailFilterRunUndone', () => {
  const fakeUpdateDb = (rows: { id: string }[]) =>
    ({
      update: () => ({ set: () => ({ where: () => ({ returning: async () => rows }) }) }),
    }) as never

  it('reports true when it stamped the run', async () => {
    await expect(
      markMailFilterRunUndone(fakeUpdateDb([{ id: 'run_1' }]), 'org_1', 'run_1')
    ).resolves.toBe(true)
  })

  it('reports false when the run was already undone (no re-stamp)', async () => {
    await expect(markMailFilterRunUndone(fakeUpdateDb([]), 'org_1', 'run_1')).resolves.toBe(false)
  })
})
