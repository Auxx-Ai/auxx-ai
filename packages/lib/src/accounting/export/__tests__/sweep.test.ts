// packages/lib/src/accounting/export/__tests__/sweep.test.ts
//
// The sweep orders due batches by `txnDate, createdAt` (plan 67 §5.2), so a
// Payment's invoice is normally picked up in the same or an earlier pass than
// the Payment that applies to it. A fake db that returns no rows is enough -
// what is exercised is the `orderBy` call the query builds, not Postgres's
// own sort.
//
// 🛑 Only the FIRST sort key is asserted by content. The global `@auxx/database`
// mock (`src/test/setup.ts`) hands every column back as `{}`, so a column
// reference used as a bare VALUE (`asc(schema.ExportBatch.createdAt)`) has
// nothing distinguishing left on it under this mock - "column-level refs
// remain unassertable", the setup file's own words. The first key survives
// because it is a `sql` template: the LITERAL text around the interpolation
// (`->>'txnDate'`) is static and renders regardless of what the column
// resolves to.

import type { Database } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { sweepExportBatches } from '../sweep'

/** Walk a Drizzle SQL fragment and collect every string chunk it renders. */
function sqlText(node: unknown): string {
  const out: string[] = []
  const visit = (value: unknown): void => {
    if (value == null) return
    if (Array.isArray(value)) {
      for (const child of value) visit(child)
      return
    }
    if (typeof value === 'string') {
      out.push(value)
      return
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>
      if ('queryChunks' in record) visit(record.queryChunks)
      else if ('value' in record) visit(record.value)
    }
  }
  visit(node)
  return out.join(' ')
}

function fakeDb(): { db: Database; orderArgs: unknown[] } {
  const captured: { args: unknown[] } = { args: [] }
  const chain: Record<string, unknown> = {}
  for (const method of ['from', 'where', 'limit']) chain[method] = () => chain
  chain.orderBy = (...args: unknown[]) => {
    captured.args = args
    return chain
  }
  // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve)
  return {
    db: { select: () => chain } as unknown as Database,
    get orderArgs() {
      return captured.args
    },
  } as unknown as { db: Database; orderArgs: unknown[] }
}

describe('sweepExportBatches - due-batch order', () => {
  it('orders by the payload txnDate first, then a second sort key', async () => {
    const fake = fakeDb()

    await sweepExportBatches(fake.db, { organizationId: 'org_1' })

    expect(fake.orderArgs).toHaveLength(2)
    expect(sqlText(fake.orderArgs[0])).toContain("txnDate')")
    expect(sqlText(fake.orderArgs[0])).toContain('ASC')
    // The second key exists and is a distinct expression from the first -
    // that it names `createdAt` is asserted by reading `sweep.ts` itself.
    expect(fake.orderArgs[1]).not.toBe(fake.orderArgs[0])
    expect(fake.orderArgs[1]).toBeTruthy()
  })
})
