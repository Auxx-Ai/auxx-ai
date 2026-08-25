// packages/lib/src/resources/record-existence.test.ts
//
// `findMissingRecordTargets` is the only thing allowed to say a relation target
// is gone. Everything downstream of it DELETES on its say-so, so the tests that
// matter are the refusals: which defs it will not judge, and why.

import { describe, expect, it, vi } from 'vitest'

const getCachedResources = vi.hoisted(() => vi.fn(async () => [] as unknown[]))

vi.mock('../cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../cache')>()
  return { ...actual, getCachedResources }
})

import type { RecordId } from '@auxx/types/resource'
import { findMissingRecordTargets } from './record-existence'

const ORG = 'org_1'
const WORK_ORDER_DEF = 'wodefwodefwodefwodef0001'
const CONTACT_DEF = 'ctdefctdefctdefctdef0001'

function customResource(overrides: {
  id: string
  apiSlug: string
  entityDefinitionId: string
  entityType?: string
}) {
  return { type: 'custom', ...overrides } as unknown
}

function resourcesFixture() {
  return [
    customResource({
      id: WORK_ORDER_DEF,
      apiSlug: 'work-orders',
      entityDefinitionId: WORK_ORDER_DEF,
      entityType: 'work_order',
    }),
    customResource({
      id: CONTACT_DEF,
      apiSlug: 'contacts',
      entityDefinitionId: CONTACT_DEF,
      entityType: 'contact',
    }),
    // `thread` IS in the resource cache, as a system resource. It must never be
    // judged even though it resolves.
    { type: 'system', id: 'thread', apiSlug: 'threads', entityDefinitionId: 'thread' } as unknown,
  ]
}

/**
 * A `db` whose single `select().from().where()` chain answers with the rows it
 * was seeded with, and records the fact that it ran at all — "did it query?" is
 * itself an assertion for the refusal cases.
 */
function fakeDb(presentIds: string[]) {
  let queried = false
  const db = {
    select: () => ({
      from: () => ({
        where: async () => {
          queried = true
          return presentIds.map((id) => ({ id }))
        },
      }),
    }),
  } as never
  return { db, didQuery: () => queried }
}

beforeEach(() => {
  getCachedResources.mockReset().mockResolvedValue(resourcesFixture() as never)
})

describe('findMissingRecordTargets', () => {
  it('reports an EntityInstance-backed target with no row', async () => {
    const alive = `${WORK_ORDER_DEF}:alive` as RecordId
    const dead = `${WORK_ORDER_DEF}:dead` as RecordId
    const { db } = fakeDb(['alive'])

    const result = await findMissingRecordTargets(db, {
      organizationId: ORG,
      recordIds: [alive, dead],
    })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual([dead])
  })

  it('resolves a def named by its entityType slug as well as its id', async () => {
    const dead = 'contact:gone' as RecordId
    const { db } = fakeDb([])

    const result = await findMissingRecordTargets(db, { organizationId: ORG, recordIds: [dead] })

    expect(result._unsafeUnwrap()).toEqual([dead])
  })

  it('NEVER judges a thread — every thread id resolves to nothing in hydration', async () => {
    // The whole reason the picker cannot drop on a hydration miss:
    // `getResourcesByIds` drops mail-lens ids from the batch for EVERY viewer,
    // so a live `tag_threads` link looks exactly like a deleted one. 1,253 such
    // links are healthy in the dev database.
    const thread = 'thread:live_thread_id' as RecordId
    const { db, didQuery } = fakeDb([])

    const result = await findMissingRecordTargets(db, { organizationId: ORG, recordIds: [thread] })

    expect(result._unsafeUnwrap()).toEqual([])
    expect(didQuery()).toBe(false)
  })

  it('NEVER judges a def missing from the resource cache', async () => {
    // `article`'s EntityDefinition row is filtered OUT of the resource cache
    // because its data lives in a dedicated table. "Not in the cache" is
    // ambiguity, not absence.
    const article = 'article:some_article_id' as RecordId
    const { db, didQuery } = fakeDb([])

    const result = await findMissingRecordTargets(db, { organizationId: ORG, recordIds: [article] })

    expect(result._unsafeUnwrap()).toEqual([])
    expect(didQuery()).toBe(false)
  })

  it('judges the judgeable half of a mixed batch and leaves the rest alone', async () => {
    const deadWorkOrder = `${WORK_ORDER_DEF}:dead_wo` as RecordId
    const thread = 'thread:live_thread' as RecordId
    const article = 'article:live_article' as RecordId
    const { db } = fakeDb([])

    const result = await findMissingRecordTargets(db, {
      organizationId: ORG,
      recordIds: [deadWorkOrder, thread, article],
    })

    expect(result._unsafeUnwrap()).toEqual([deadWorkOrder])
  })

  it('reports every spelling of a dead instance, not just the one queried', async () => {
    const bySlug = 'work_order:dead' as RecordId
    const byDefId = `${WORK_ORDER_DEF}:dead` as RecordId
    const { db } = fakeDb([])

    const result = await findMissingRecordTargets(db, {
      organizationId: ORG,
      recordIds: [bySlug, byDefId],
    })

    expect(result._unsafeUnwrap().sort()).toEqual([bySlug, byDefId].sort())
  })

  it('returns an error rather than a verdict when the query fails', async () => {
    // Fails CLOSED on the delete side: no ids reported missing, so no caller
    // removes anything.
    const db = {
      select: () => ({
        from: () => ({
          where: async () => {
            throw new Error('connection reset')
          },
        }),
      }),
    } as never

    const result = await findMissingRecordTargets(db, {
      organizationId: ORG,
      recordIds: [`${WORK_ORDER_DEF}:x` as RecordId],
    })

    expect(result.isErr()).toBe(true)
  })

  it('answers empty for an empty batch without touching the cache', async () => {
    const { db, didQuery } = fakeDb([])
    const result = await findMissingRecordTargets(db, { organizationId: ORG, recordIds: [] })
    expect(result._unsafeUnwrap()).toEqual([])
    expect(didQuery()).toBe(false)
    expect(getCachedResources).not.toHaveBeenCalled()
  })
})
