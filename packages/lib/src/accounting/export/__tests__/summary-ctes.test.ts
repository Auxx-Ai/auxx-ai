// packages/lib/src/accounting/export/__tests__/summary-ctes.test.ts

import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import type { ExportSettings } from '../../ledger/setup/export-settings'
import { bucketCtes, grainKeySql, type SummaryScope } from '../summary-ctes'

const dialect = new PgDialect()

const settings = {
  mode: 'summary',
  cutover: null,
  autoSend: {},
  summaryGrain: { receipt: 'payout', invoice: 'month' },
} as unknown as ExportSettings

const scope: SummaryScope = { from: '2026-01-01', to: '2026-12-31', settings, bookId: 'book_1' }

describe('summary CTEs - 91 D9 in SQL', () => {
  it('buckets a payout-grain avenue by payoutId, falling back to the day', () => {
    const { sql, params } = dialect.sqlToQuery(grainKeySql(settings))
    const receipt = params.indexOf('receipt') + 1
    expect(sql).toContain(
      `WHEN $${receipt} THEN coalesce(nullif(p."payoutId", ''), p."txnDate"::text)`
    )
    expect(sql).toContain(`to_char(p."txnDate", 'YYYY-MM')`)
  })

  it('keeps each account-and-side line unnetted when deciding a journal', () => {
    const { sql } = dialect.sqlToQuery(
      bucketCtes({ organizationId: 'org_1', held: 'include' }, scope)
    )
    expect(sql).toContain(`l."direction", sum(l."amountMinor") AS amount`)
    expect(sql).toContain('GROUP BY 1, 2, 3, 4, 5, 6, 7')
    expect(sql).toContain('WHERE amount <> 0')
    expect(sql).not.toContain('ELSE -l."amountMinor"')
  })
})
