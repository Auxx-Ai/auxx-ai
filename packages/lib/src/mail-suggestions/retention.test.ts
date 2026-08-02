// packages/lib/src/mail-suggestions/retention.test.ts
// The sweep bounds UNDECIDED cards only. A `dismissed` row that got swept would
// be re-proposed by the very next weekly run (invariant 7), so the status
// predicate is the whole test.

import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SUGGESTION_RETENTION_DAYS, sweepStaleMailSuggestions } from './retention'

const execute = vi.fn()
const db = { execute } as never

beforeEach(() => vi.clearAllMocks())

describe('sweepStaleMailSuggestions', () => {
  it('loops batched deletes until a pass returns fewer than the batch size', async () => {
    execute
      .mockResolvedValueOnce({ rowCount: 5000 })
      .mockResolvedValueOnce({ rowCount: 5000 })
      .mockResolvedValueOnce({ rowCount: 42 })

    const result = await sweepStaleMailSuggestions(db)

    expect(execute).toHaveBeenCalledTimes(3)
    expect(result._unsafeUnwrap()).toBe(10_042)
  })

  it('stops after a single pass when there is nothing to prune', async () => {
    execute.mockResolvedValueOnce({ rowCount: 0 })
    await sweepStaleMailSuggestions(db)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('deletes ONLY `new` rows — dismissed rows are the suppression list', async () => {
    execute.mockResolvedValueOnce({ rowCount: 0 })
    await sweepStaleMailSuggestions(db)

    const { sql } = new PgDialect().sqlToQuery(execute.mock.calls[0]?.[0])
    expect(sql).toContain(`"status" = 'new'`)
    expect(sql).not.toContain('dismissed')
    expect(sql).not.toContain('accepted')
  })

  it('defaults to the 90-day window the miner uses', async () => {
    execute.mockResolvedValueOnce({ rowCount: 0 })
    await sweepStaleMailSuggestions(db)
    const { params } = new PgDialect().sqlToQuery(execute.mock.calls[0]?.[0])
    expect(SUGGESTION_RETENTION_DAYS).toBe(90)
    expect(params).toContain(90)
  })
})
