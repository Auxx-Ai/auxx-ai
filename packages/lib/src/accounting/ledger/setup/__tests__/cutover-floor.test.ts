// packages/lib/src/accounting/ledger/setup/__tests__/cutover-floor.test.ts
//
// The floor's reads are SQL, so the fake db answers per kind and the tests pin the predicates
// that decide "after the cutover" and "not posted" on the rendered query.

import type { Database } from '@auxx/database'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readCutoverFloor } from '../cutover-floor'
import { resolveSetupReadiness } from '../setup-readiness'

vi.mock('../../../../resources/system-records', () => ({
  systemFieldMap: async (_db: unknown, _org: string, attributes: readonly string[]) =>
    Object.fromEntries(attributes.map((attribute) => [attribute, { id: `fld_${attribute}` }])),
}))

const dialect = new PgDialect()
const h = vi.hoisted(() => ({
  queries: [] as Array<{ sql: string; params: unknown[] }>,
  /** What the db answers for a query over this date field. */
  answers: {} as Record<string, { count: number; earliest: string | null; latest: string | null }>,
}))

const db = {
  execute: async (query: SQL) => {
    const rendered = dialect.sqlToQuery(query)
    h.queries.push(rendered)
    const field = rendered.params.find(
      (param) => typeof param === 'string' && param.startsWith('fld_') && param in h.answers
    ) as string | undefined
    return { rows: [field ? h.answers[field] : { count: 0, earliest: null, latest: null }] }
  },
} as unknown as Database

const input = { organizationId: 'org_1', cutoffPeriod: '2026-07', bookTimeZone: 'America/Chicago' }

function billQuery() {
  const query = h.queries.find((q) => q.params.includes('fld_vendor_bill_billed_at'))
  if (!query) throw new Error('no vendor bill query')
  return query
}

beforeEach(() => {
  h.queries = []
  h.answers = {}
})

describe('readCutoverFloor', () => {
  it('reports a post-cutover unposted vendor bill by kind, count and earliest date', async () => {
    h.answers.fld_vendor_bill_billed_at = { count: 3, earliest: '2026-08-03', latest: '2026-09-10' }

    const findings = (await readCutoverFloor(db, input))._unsafeUnwrap()
    expect(findings).toEqual([
      { kind: 'vendor_bill', count: 3, earliest: '2026-08-03', latest: '2026-09-10' },
    ])

    const readiness = resolveSetupReadiness(
      {
        'accounting.cutoffPeriod': '2026-07',
        'accounting.bookTimeZone': 'America/Chicago',
        'accounting.openingFromNothing': true,
      },
      { cutoverFloor: findings }
    )
    expect(readiness.requirements.at(-1)).toEqual({
      key: 'cutover-floor',
      met: false,
      reason:
        '3 vendor bills dated after 2026-07 are not posted (earliest 2026-08-03). Move the ' +
        'cutover to 2026-09 or later so the opening balances carry them.',
    })
    expect(readiness.settingsReady).toBe(false)
  })

  it('counts only documents after the cutover month', async () => {
    await readCutoverFloor(db, input)
    const query = billQuery()
    expect(query.sql).toContain(`to_char(docs.day, 'YYYY-MM') >`)
    expect(query.params).toContain('2026-07')
    // A bill dated in or before the cutover month is the opening balance's: the db answers none.
    expect((await readCutoverFloor(db, input))._unsafeUnwrap()).toEqual([])
  })

  it('excludes a bill whose entry holds its subject claim', async () => {
    await readCutoverFloor(db, input)
    const query = billQuery()
    expect(query.sql).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM "GlPostingSource" link/)
    expect(query.sql).toContain(`link."linkRole" = 'subject'`)
    expect(query.params).toEqual(expect.arrayContaining(['vendor_bill', 'original', 'posted']))
  })

  it('claims a write-off by its attempt occurrence and dates it in the book zone', async () => {
    await readCutoverFloor(db, input)
    const query = h.queries.find((q) => q.params.includes('write_off:%'))
    expect(query?.sql).toContain('link."occurrence" LIKE')
    expect(query?.params).toContain('America/Chicago')
  })

  it('emits no row when nothing is stranded, and none when the caller passes no floor', async () => {
    const settings = {
      'accounting.cutoffPeriod': '2026-07',
      'accounting.bookTimeZone': 'America/Chicago',
    }
    const met = resolveSetupReadiness(settings, { cutoverFloor: [] })
    expect(met.requirements.find((r) => r.key === 'cutover-floor')).toEqual({
      key: 'cutover-floor',
      met: true,
      reason: undefined,
    })
    expect(resolveSetupReadiness(settings).requirements.map((r) => r.key)).not.toContain(
      'cutover-floor'
    )
  })
})
