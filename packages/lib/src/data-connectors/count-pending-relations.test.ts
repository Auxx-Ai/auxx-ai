// packages/lib/src/data-connectors/count-pending-relations.test.ts
// `countPendingRelationsByTarget` (service.ts), plans/money/tasks/39 §3.6. The
// aggregate is one raw SQL statement, so the db is an `execute` stub: what is under
// test is the contract around it (one statement, org + connector bound, rows passed
// through in the order Postgres returned them, a thrown driver error as `err`). The
// SQL itself runs against Postgres in the dev database, not here.

import type { Database } from '@auxx/database'
import { is, Param, SQL } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { countPendingRelationsByTarget, type PendingRelationTargetCount } from './service'

/**
 * Every bound value in a drizzle `sql` tree, in order. The `sql` tag keeps a plain
 * interpolated value as-is in `queryChunks` (it becomes a `$n` parameter at build
 * time); an `eq()` wraps its value in `Param`. Accept both, skip `StringChunk`s.
 */
function paramValues(query: unknown): unknown[] {
  const out: unknown[] = []
  const walk = (chunk: unknown) => {
    if (is(chunk, SQL)) for (const c of chunk.queryChunks) walk(c)
    else if (is(chunk, Param)) out.push(chunk.value)
    else if (typeof chunk === 'string') out.push(chunk)
  }
  walk(query)
  return out
}

function makeDb(rows: PendingRelationTargetCount[] | Error) {
  const calls: unknown[] = []
  const db = {
    execute: async (query: unknown) => {
      calls.push(query)
      if (rows instanceof Error) throw rows
      return { rows }
    },
  } as unknown as Database
  return { db, calls }
}

const lineToPart: PendingRelationTargetCount = {
  sourceDef: 'def_line',
  sourceLabel: 'Line item',
  targetDef: 'def_part',
  apiSlug: 'part',
  label: 'Part',
  records: 563,
  edges: 563,
}
const catalogToPart: PendingRelationTargetCount = {
  sourceDef: 'def_catalog',
  sourceLabel: 'Catalog item',
  targetDef: 'def_part',
  apiSlug: 'part',
  label: 'Part',
  records: 47,
  edges: 47,
}

describe('countPendingRelationsByTarget', () => {
  it('runs one statement and returns the grouped rows as Postgres ordered them', async () => {
    const { db, calls } = makeDb([lineToPart, catalogToPart])

    const result = await countPendingRelationsByTarget(db, 'org1', 'dc1')

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual([lineToPart, catalogToPart])
    expect(calls).toHaveLength(1)
  })

  it('binds the org and the connector as parameters, never inlined', async () => {
    const { db, calls } = makeDb([])

    await countPendingRelationsByTarget(db, 'org_scope', 'dc_scope')

    // Under vitest the schema column refs interpolate as undefined (see the
    // orchestrator harness tests); the two strings are the only real bindings.
    expect(paramValues(calls[0]).filter((v) => v !== undefined)).toEqual(['org_scope', 'dc_scope'])
  })

  it('returns an empty list when nothing is pending', async () => {
    const { db } = makeDb([])
    const result = await countPendingRelationsByTarget(db, 'org1', 'dc1')
    expect(result._unsafeUnwrap()).toEqual([])
  })

  it('returns a driver failure as err instead of throwing into the status poll', async () => {
    const { db } = makeDb(new Error('relation does not exist'))
    const result = await countPendingRelationsByTarget(db, 'org1', 'dc1')
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toBe('relation does not exist')
  })
})
