// packages/lib/src/postings/reports/__tests__/dimension-breakdown.test.ts
//
// The acceptance in brief 13 §5.5: the P&L can still split revenue by channel,
// now by grouping on `GlPostingLine.dimensions` instead of reading a second
// account. This is the read half only - no screen in this pass.

import type { Database } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { AuxxError } from '../../../errors'
import { readDimensionBreakdown } from '../dimension-breakdown'

const ORG = 'org_1'
const ACCOUNT = 'gla_4000'

/** One `readDimensionBreakdown` query: a single `.groupBy()` read. */
function stubDb(rows: unknown[]): Database {
  const chain: Record<string, unknown> = {}
  const passthrough = () => chain
  for (const method of ['from', 'innerJoin', 'where', 'groupBy']) chain[method] = passthrough
  // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve, reject)
  return { select: () => chain } as unknown as Database
}

function row(value: string | null, debitMinor: number, creditMinor: number) {
  return { value, debitMinor: String(debitMinor), creditMinor: String(creditMinor) }
}

describe('readDimensionBreakdown', () => {
  it('returns one row per dimension value, with a raw (not natural-signed) balance', async () => {
    const db = stubDb([row('dtc', 0, 80_000), row('dealer', 0, 20_000)])

    const result = await readDimensionBreakdown(db, {
      organizationId: ORG,
      glAccountId: ACCOUNT,
      dimension: 'channel',
    })

    expect(result.isOk()).toBe(true)
    const rows = result._unsafeUnwrap()
    expect(rows).toEqual(
      expect.arrayContaining([
        { value: 'dtc', debitMinor: 0, creditMinor: 80_000, balanceMinor: -80_000 },
        { value: 'dealer', debitMinor: 0, creditMinor: 20_000, balanceMinor: -20_000 },
      ])
    )
  })

  it('carries a null bucket for lines with no such dimension at all', async () => {
    const db = stubDb([row('dtc', 0, 80_000), row(null, 0, 5_000)])

    const rows = (
      await readDimensionBreakdown(db, {
        organizationId: ORG,
        glAccountId: ACCOUNT,
        dimension: 'channel',
      })
    )._unsafeUnwrap()

    expect(rows.find((r) => r.value === null)).toEqual({
      value: null,
      debitMinor: 0,
      creditMinor: 5_000,
      balanceMinor: -5_000,
    })
  })

  it('sorts named values alphabetically, with the null bucket last', async () => {
    const db = stubDb([row(null, 0, 1), row('dtc', 0, 1), row('dealer', 0, 1)])

    const rows = (
      await readDimensionBreakdown(db, {
        organizationId: ORG,
        glAccountId: ACCOUNT,
        dimension: 'channel',
      })
    )._unsafeUnwrap()

    expect(rows.map((r) => r.value)).toEqual(['dealer', 'dtc', null])
  })

  it('coerces numeric string aggregates the driver may hand back', async () => {
    const db = stubDb([{ value: 'dtc', debitMinor: '12345', creditMinor: '0' }])

    const rows = (
      await readDimensionBreakdown(db, {
        organizationId: ORG,
        glAccountId: ACCOUNT,
        dimension: 'channel',
      })
    )._unsafeUnwrap()

    expect(rows[0]).toEqual({
      value: 'dtc',
      debitMinor: 12_345,
      creditMinor: 0,
      balanceMinor: 12_345,
    })
  })

  it('never throws - a driver failure becomes an AuxxError result', async () => {
    const db = {
      select: () => {
        throw new Error('connection terminated')
      },
    } as unknown as Database

    const result = await readDimensionBreakdown(db, {
      organizationId: ORG,
      glAccountId: ACCOUNT,
      dimension: 'channel',
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(AuxxError)
  })
})
