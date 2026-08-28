// packages/lib/src/records/__tests__/record-numbering.test.ts
//
// `SCOPE_DEFAULTS` is where a record kind's number FORMAT is decided, and the
// hook tests above it can only ever assert the scope string they were handed —
// they mock `recordNumbering` wholesale. So the claim "a build is numbered
// `B-0001`" (plans/products/build/01-build-plan.md section 1.1) is only actually
// pinned here: the prefix comes from this table, the `-` and the four digits come
// from the RecordSequence column defaults, and nothing asserts the three compose
// unless something exercises the real function.

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

const { recordNumbering } = await import('../record-numbering')

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
