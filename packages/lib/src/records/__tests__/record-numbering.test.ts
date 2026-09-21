// packages/lib/src/records/__tests__/record-numbering.test.ts
//
// `SCOPE_DEFAULTS` is where a record kind's number FORMAT is decided, and the
// hook tests above it can only ever assert the scope string they were handed —
// they mock `recordNumbering` wholesale. So the claim "a build is numbered
// `B-0001`" (plans/products/build/01-build-plan.md section 1.1) is only actually
// pinned here: the prefix comes from this table, the `-` and the four digits come
// from the RecordSequence column defaults, and nothing asserts the three compose
// unless something exercises the real function.

import type { Database } from '@auxx/database'
import { describe, expect, it, vi } from 'vitest'

interface FakeRow {
  organizationId: string
  scope: string
  currentNumber: number
  prefix: string | null
  paddingLength: number
  usePrefix: boolean
  useDateInPrefix: boolean
  useSuffix: boolean
  suffix: string | null
  separator: string
}

const h = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  // The key the INSERT named. `recordNumbering.create` always issues its UPDATE
  // against the same organization+scope as the INSERT immediately before it in the
  // same call, so pairing them this way lets the fake answer `where(...)` without
  // interpreting a Drizzle condition tree.
  target: { key: '' },
}))

vi.mock('@auxx/database', () => ({
  schema: {
    RecordSequence: {
      organizationId: 'organizationId',
      scope: 'scope',
      currentNumber: 'currentNumber',
    },
  },
  database: {
    insert: () => ({
      values: (row: { organizationId: string; scope: string }) => ({
        onConflictDoNothing: async () => {
          const key = `${row.organizationId}:${row.scope}`
          h.target.key = key
          if (h.rows.has(key)) return
          // The columns `create` does NOT name, filled from the table defaults in
          // packages/database/src/db/schema/record-sequence.ts — `separator` defaults
          // to '-', which is what makes the number `B-0001` rather than `B0001`.
          h.rows.set(key, {
            useDateInPrefix: false,
            useSuffix: false,
            suffix: null,
            separator: '-',
            ...row,
          })
        },
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => {
            const row = h.rows.get(h.target.key) as FakeRow | undefined
            if (!row) return []
            row.currentNumber += 1
            return [row]
          },
        }),
      }),
    }),
  },
}))

const { recordNumbering, validateAccountingSequence } = await import('../record-numbering')
const { UnprocessableEntityError } = await import('../../errors')

describe('recordNumbering — the `build` scope', () => {
  it('numbers the first build B-0001 and the next B-0002', async () => {
    const first = await recordNumbering.create('org-1', 'build')
    expect(first).toEqual({ recordNumber: 'B-0001', sequenceNumber: 1 })

    const second = await recordNumbering.create('org-1', 'build')
    expect(second).toEqual({ recordNumber: 'B-0002', sequenceNumber: 2 })
  })

  it('counts separately from the vendor bill, whose prefix it would otherwise be read as', async () => {
    const bill = await recordNumbering.create('org-1', 'vendor_bill')
    expect(bill.recordNumber).toBe('BILL-0001')

    const build = await recordNumbering.create('org-1', 'build')
    expect(build.recordNumber).toBe('B-0003')
  })

  it('counts separately per organization', async () => {
    const other = await recordNumbering.create('org-2', 'build')
    expect(other).toEqual({ recordNumber: 'B-0001', sequenceNumber: 1 })
  })
})

// The validator behind the sequence settings write (plans/accounting/tasks/80
// §4.6): once a ledger posting copies the record number verbatim, two accounting
// scopes rendering the same prefix in one org collide on the docNumber unique.
describe('validateAccountingSequence', () => {
  type OrgRow = { scope: string; prefix: string | null; usePrefix: boolean }
  const dbWith = (rows: OrgRow[]) =>
    ({ query: { RecordSequence: { findMany: async () => rows } } }) as unknown as Database

  const refusal = async (result: Awaited<ReturnType<typeof validateAccountingSequence>>) => {
    expect(result.isErr()).toBe(true)
    const error = result._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    return error.message
  }

  it('refuses a prefix another accounting scope in the org already renders', async () => {
    const db = dbWith([{ scope: 'credit_memo', prefix: 'INV', usePrefix: true }])
    const result = await validateAccountingSequence(db, {
      organizationId: 'org-1',
      scope: 'invoice',
      format: { prefix: 'INV' },
    })
    expect(await refusal(result)).toContain('credit_memo')
  })

  it('refuses the default prefix of an accounting scope that has no row yet', async () => {
    const result = await validateAccountingSequence(dbWith([]), {
      organizationId: 'org-1',
      scope: 'invoice',
      format: { prefix: 'CM' },
    })
    expect(await refusal(result)).toContain('credit_memo')
  })

  it('lets a non-accounting scope share a prefix', async () => {
    const db = dbWith([{ scope: 'invoice', prefix: 'INV', usePrefix: true }])
    const result = await validateAccountingSequence(db, {
      organizationId: 'org-1',
      scope: 'ticket',
      format: { prefix: 'INV' },
    })
    expect(result.isOk()).toBe(true)
  })

  it('refuses a suffix that renders as -R1 or -G2', async () => {
    const dashed = await validateAccountingSequence(dbWith([]), {
      organizationId: 'org-1',
      scope: 'invoice',
      format: { prefix: 'INV', useSuffix: true, suffix: 'R1', separator: '-' },
    })
    expect(await refusal(dashed)).toContain('-R1')

    const bare = await validateAccountingSequence(dbWith([]), {
      organizationId: 'org-1',
      scope: 'invoice',
      format: { prefix: 'INV', useSuffix: true, suffix: '-G2', separator: '' },
    })
    expect(await refusal(bare)).toContain('-G2')
  })

  it('passes a prefix nobody else in the org renders', async () => {
    const db = dbWith([
      { scope: 'credit_memo', prefix: 'CM', usePrefix: true },
      // Switched off, so this row renders no prefix and `INV` is free.
      { scope: 'vendor_bill', prefix: 'INV', usePrefix: false },
    ])
    const result = await validateAccountingSequence(db, {
      organizationId: 'org-1',
      scope: 'invoice',
      format: { prefix: 'INV', useSuffix: true, suffix: 'A', separator: '-' },
    })
    expect(result.isOk()).toBe(true)
  })
})
