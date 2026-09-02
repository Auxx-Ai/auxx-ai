// packages/lib/src/data-connectors/managed-fields.test.ts
//
// `isFieldConnectorManaged` is the read the totals stand-down (money plan 37 §6) calls once
// per record before writing a document's or a line's totals. What matters here is the exact
// shape `entity-sink.ts`'s `connector_owned_only` strategy already relies on: `managedFields`
// is an array of raw target-ref strings (a bare systemAttribute for a system-field target),
// archived items never count, and a record bound to more than one live item is answered by
// ANY of them naming the field — not just the first row returned.

import type { Database } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { isFieldConnectorManaged } from './managed-fields'

/** A `db.select().from().where()` chain that resolves to `rows`, nothing else touched. */
function fakeDb(rows: Array<{ managedFields: string[] | null }>): Database {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(rows),
      }),
    }),
  } as unknown as Database
}

describe('isFieldConnectorManaged', () => {
  it('returns true when a live item lists the field', async () => {
    const db = fakeDb([{ managedFields: ['order_total', 'order_subtotal'] }])
    expect(await isFieldConnectorManaged(db, 'org_1', 'inst_1', 'order_total')).toBe(true)
  })

  it('returns false when no item lists the field', async () => {
    const db = fakeDb([{ managedFields: ['order_subtotal'] }])
    expect(await isFieldConnectorManaged(db, 'org_1', 'inst_1', 'order_total')).toBe(false)
  })

  it('returns false when the instance has no live DataConnectorItem at all', async () => {
    const db = fakeDb([])
    expect(await isFieldConnectorManaged(db, 'org_1', 'inst_1', 'order_total')).toBe(false)
  })

  it('answers true if ANY of several live items names the field, not just the first', async () => {
    const db = fakeDb([{ managedFields: [] }, { managedFields: ['order_total'] }])
    expect(await isFieldConnectorManaged(db, 'org_1', 'inst_1', 'order_total')).toBe(true)
  })

  it('tolerates a null managedFields column', async () => {
    const db = fakeDb([{ managedFields: null }])
    expect(await isFieldConnectorManaged(db, 'org_1', 'inst_1', 'order_total')).toBe(false)
  })

  it('matches the line-total attribute the same way it matches a document total', async () => {
    const db = fakeDb([{ managedFields: ['line_item_line_total'] }])
    expect(await isFieldConnectorManaged(db, 'org_1', 'line_1', 'line_item_line_total')).toBe(true)
  })
})
