// packages/lib/src/data-connectors/item-bindings.test.ts
// The one query behind the per-cell sync badge. Beyond grouping by instance, it now
// carries `removedUpstreamAt` (v12.1 Phase 5a) as an ISO string, so the batch
// field-value read can show "Removed upstream" on a record's bound cells without a
// second query.

import type { Database } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { listItemBindingsForInstances } from './item-bindings'

type Row = {
  entityInstanceId: string | null
  connectorId: string
  managedFields: string[] | null
  pinnedFields: string[] | null
  removedUpstreamAt: Date | null
  fieldMappings: Array<{ targetFieldRef: string | null; mergeStrategy?: string }> | null
}

/** A `select().from().innerJoin().where()` chain resolving to `rows`. */
function fakeDb(rows: Row[]): Database {
  return {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => Promise.resolve(rows),
        }),
      }),
    }),
  } as unknown as Database
}

function row(over: Partial<Row> = {}): Row {
  return {
    entityInstanceId: 'inst_1',
    connectorId: 'dc_shopify',
    managedFields: ['def_p:f_desc'],
    pinnedFields: [],
    removedUpstreamAt: null,
    fieldMappings: [{ targetFieldRef: 'def_p:f_desc', mergeStrategy: 'overwrite' }],
    ...over,
  }
}

describe('listItemBindingsForInstances', () => {
  it('returns an empty map without querying when there are no instances', async () => {
    const db = { select: () => throwIfCalled() } as unknown as Database
    expect(await listItemBindingsForInstances(db, 'org_1', [])).toEqual(new Map())
  })

  it('groups live items by instance and carries the flag as an ISO string', async () => {
    const flaggedAt = new Date('2026-09-09T02:00:00.000Z')
    const db = fakeDb([
      row(),
      row({ entityInstanceId: 'inst_2', removedUpstreamAt: flaggedAt, pinnedFields: ['f_desc'] }),
    ])
    const out = await listItemBindingsForInstances(db, 'org_1', ['inst_1', 'inst_2'])

    expect(out.get('inst_1')).toEqual([
      {
        connectorId: 'dc_shopify',
        managedFields: ['def_p:f_desc'],
        pinnedFields: [],
        removedUpstreamAt: null,
        bindings: [
          { targetFieldRef: 'def_p:f_desc', mergeStrategy: 'overwrite', identityRole: undefined },
        ],
      },
    ])
    expect(out.get('inst_2')?.[0]).toMatchObject({
      removedUpstreamAt: '2026-09-09T02:00:00.000Z',
      pinnedFields: ['f_desc'],
    })
  })

  it('tolerates null jsonb columns and skips a row with no bound instance', async () => {
    const db = fakeDb([
      row({ managedFields: null, pinnedFields: null, fieldMappings: null }),
      row({ entityInstanceId: null }),
    ])
    const out = await listItemBindingsForInstances(db, 'org_1', ['inst_1'])
    expect([...out.keys()]).toEqual(['inst_1'])
    expect(out.get('inst_1')).toEqual([
      {
        connectorId: 'dc_shopify',
        managedFields: [],
        pinnedFields: [],
        removedUpstreamAt: null,
        bindings: [],
      },
    ])
  })
})

function throwIfCalled(): never {
  throw new Error('query must not run for an empty instance list')
}
