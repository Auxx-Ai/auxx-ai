// packages/lib/src/threads/__tests__/threads-for-record.test.ts

import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it } from 'vitest'
import { threadsForRecord } from '../threads-for-record'

const h = { wheres: [] as unknown[], script: [] as unknown[][] }

/** One query stage: chainable and awaitable, resolving to `rows` — the same
 * shape `banking/__tests__/reads-archived.test.ts` builds. */
function stage(rows: unknown[]): unknown {
  const chain: Record<string, unknown> = {}
  chain.from = () => stage(rows)
  chain.innerJoin = () => stage(rows)
  chain.where = (fragment: unknown) => {
    h.wheres.push(fragment)
    return stage(rows)
  }
  return Object.assign(Promise.resolve(rows), chain)
}

/** A db double that answers `h.script` in order: call 0 is the primary-thread
 * query, call 1 is the `ThreadEntityLink` join. */
function fakeDb() {
  let call = 0
  return { select: () => stage(h.script[call++] ?? []) } as never
}

/** The SQL a drizzle fragment renders to, so the `isNull` arm can be asserted
 * without a real column (rendered outside a query builder, so the reference
 * itself comes back blank — only the shape is pinned). */
function render(fragment: unknown): string {
  return new PgDialect().sqlToQuery(fragment as never).sql
}

beforeEach(() => {
  h.wheres.length = 0
  h.script.length = 0
})

describe('threadsForRecord', () => {
  it('dedupes a thread that is both primary and secondary, keeping the primary subject', async () => {
    h.script.push([{ id: 'thread_1', subject: 'Primary subject' }])
    h.script.push([
      { id: 'thread_1', subject: 'Secondary subject' },
      { id: 'thread_2', subject: 'Only secondary' },
    ])

    const result = await threadsForRecord(fakeDb(), 'org_1', 'rec_1')

    expect(result).toEqual([
      { id: 'thread_1', subject: 'Primary subject' },
      { id: 'thread_2', subject: 'Only secondary' },
    ])
  })

  it('filters the ThreadEntityLink join on unlinkedAt being null', async () => {
    h.script.push([])
    h.script.push([{ id: 'thread_3', subject: 'Still linked' }])

    await threadsForRecord(fakeDb(), 'org_1', 'rec_2')

    // wheres[0] is the primary query, wheres[1] is the secondary join — the
    // `isNull(ThreadEntityLink.unlinkedAt)` arm lives only in the second.
    expect(render(h.wheres[1])).toContain('is null')
  })
})
