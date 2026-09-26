// packages/lib/src/field-values/__tests__/inverse-sync-reads.int.test.ts
//
// A has_many inverse add reads only the pairs it adds and the target's last sortKey, never the
// target's whole list (plans/mrp/10-batched-build-writes.md, follow-ups).

import { type Database, schema } from '@auxx/database'
import { getTestDb } from '@auxx/test-utils'
import { nextKeyAfter } from '@auxx/utils/fractional-indexing'
import { and, asc, eq } from 'drizzle-orm'
import pg from 'pg'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getOrgCache } from '../../cache'
import {
  type BuildFixture,
  seedBuildOrg,
} from '../../inventory/builds/__tests__/support/build-fixture'
import { quietSession } from '../../resources/crud/write-origin'
import { runWithWriteSession } from '../../resources/crud/write-session-als'
import { type InverseFieldInfo, syncInverseRelationshipsBulk } from '../relationship-sync'

vi.mock('../../events/publisher', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  publisher: { publish: async () => {}, publishLater: async () => {} },
}))
vi.mock('../../dedup/enqueue-scan', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../dedup/enqueue-scan')>()),
  enqueueDuplicateScan: async () => {},
}))
vi.mock('../../realtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../realtime')>()),
  getRealtimeService: () => ({ publish: async () => true }),
}))

const db = () => getTestDb() as unknown as Database

let f: BuildFixture
let info: InverseFieldInfo

beforeEach(async () => {
  f = await seedBuildOrg({ components: 2 })
  const fields = await getOrgCache()
    .from(f.organizationId, 'customFields')
    .bySystemAttributes(['part_stock_movements', 'stock_movement_part'] as const)
  info = {
    inverseFieldId: fields.part_stock_movements!.id,
    inverseRelationshipType: 'has_many',
    sourceEntityDefinitionId: f.movementDefId,
    targetEntityDefinitionId: f.partDefId,
    sourceFieldId: fields.stock_movement_part!.id,
  }
})

/** Bare movement instances; the mirror rows below are all this test reads. */
async function movements(n: number): Promise<string[]> {
  const rows = await db()
    .insert(schema.EntityInstance)
    .values(
      Array.from({ length: n }, () => ({
        entityDefinitionId: f.movementDefId,
        organizationId: f.organizationId,
        updatedAt: new Date(),
      }))
    )
    .returning({ id: schema.EntityInstance.id })
  return rows.map((r) => r.id)
}

/** Give `partId` one mirror row per key, in the given (not necessarily sorted) order. */
async function holdLinks(partId: string, keys: string[]): Promise<string[]> {
  const ids = await movements(keys.length)
  await db()
    .insert(schema.FieldValue)
    .values(
      ids.map((id, index) => ({
        organizationId: f.organizationId,
        entityId: partId,
        entityDefinitionId: f.partDefId,
        fieldId: info.inverseFieldId,
        relatedEntityId: id,
        relatedEntityDefinitionId: f.movementDefId,
        sortKey: keys[index]!,
      }))
    )
  return ids
}

function keysFor(n: number): string[] {
  const keys: string[] = []
  let key: string | null = null
  for (let i = 0; i < n; i += 1) {
    key = nextKeyAfter(key)
    keys.push(key)
  }
  return keys
}

/** Rows each FieldValue read returned while `fn` ran. */
async function readRows(fn: () => Promise<unknown>): Promise<number[]> {
  const counts: number[] = []
  const original = pg.Client.prototype.query
  const spy = vi.spyOn(pg.Client.prototype, 'query').mockImplementation(function (
    this: pg.Client,
    ...args: unknown[]
  ) {
    const q = args[0]
    const text = (typeof q === 'string' ? q : ((q as { text?: string })?.text ?? '')).trim()
    const counted = /^(select|with)\b/i.test(text) && text.includes('"FieldValue"')
    const last = args.at(-1)
    // `Pool.query` hands the client a callback; a direct `client.query` returns a promise.
    if (counted && typeof last === 'function') {
      args[args.length - 1] = (error: unknown, r?: { rowCount: number | null }) => {
        if (!error) counts.push(r?.rowCount ?? 0)
        return (last as (...a: unknown[]) => unknown)(error, r)
      }
    }
    const result = (original as (...a: unknown[]) => unknown).apply(this, args) as
      | Promise<{ rowCount: number | null }>
      | undefined
    if (counted && result?.then) {
      void result.then((r) => {
        counts.push(r?.rowCount ?? 0)
      })
    }
    return result
  } as never)
  try {
    await fn()
  } finally {
    spy.mockRestore()
  }
  return counts
}

/** Link `sources` to `partId` as a covered quiet writer (the build lane: no announcement read). */
function link(partId: string, sources: string[], createdIds?: ReadonlySet<string>) {
  return runWithWriteSession(quietSession('inverse-sync-reads test', { coveredBy: 'test' }), () =>
    syncInverseRelationshipsBulk(
      { db: db(), organizationId: f.organizationId },
      {
        updates: sources.map((entityId) => ({
          entityId,
          oldRelatedIds: [],
          newRelatedIds: [partId],
        })),
        inverseInfo: info,
        createdIds,
      }
    )
  )
}

async function mirror(partId: string) {
  return db()
    .select({
      relatedEntityId: schema.FieldValue.relatedEntityId,
      sortKey: schema.FieldValue.sortKey,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.entityId, partId),
        eq(schema.FieldValue.fieldId, info.inverseFieldId)
      )
    )
    .orderBy(asc(schema.FieldValue.sortKey))
}

describe('has_many inverse add', () => {
  it('reads rows that do not grow with the links the target already holds', async () => {
    const [small, large] = f.componentPartIds as [string, string]
    await holdLinks(small, keysFor(5))
    await holdLinks(large, keysFor(500))

    const [a, b] = await movements(2)
    const smallReads = await readRows(() => link(small, [a!]))
    const largeReads = await readRows(() => link(large, [b!]))
    expect(largeReads).toEqual(smallReads)
    // One last-sortKey row; the pair check finds nothing.
    expect(largeReads.reduce((sum, n) => sum + n, 0)).toBe(1)

    const [c] = await movements(1)
    const freshReads = await readRows(() => link(large, [c!], new Set([c!])))
    expect(freshReads).toEqual([1])
    expect(await mirror(large)).toHaveLength(502)
  })

  it('announces a long list from a capped read', async () => {
    const [part] = f.componentPartIds as [string]
    await holdLinks(part, keysFor(500))
    const [a] = await movements(1)
    const reads = await readRows(() =>
      syncInverseRelationshipsBulk(
        { db: db(), organizationId: f.organizationId },
        {
          updates: [{ entityId: a!, oldRelatedIds: [], newRelatedIds: [part] }],
          inverseInfo: info,
        }
      )
    )
    expect(Math.max(...reads)).toBe(201)
  })

  it('still skips pairs already stored', async () => {
    const [part] = f.componentPartIds as [string]
    const held = await holdLinks(part, keysFor(3))
    const [fresh] = await movements(1)
    await link(part, [held[1]!, fresh!])

    const rows = await mirror(part)
    expect(rows.map((r) => r.relatedEntityId)).toEqual([...held, fresh])
  })

  it('appends after the highest key, in order, as MAX did', async () => {
    const [part, other] = f.componentPartIds as [string, string]
    // Stored out of key order: the max is the second row, not the last.
    await holdLinks(part, ['a1', 'a7', 'a3'])
    const added = await movements(3)
    await link(part, added)
    await link(other, added.slice(0, 1))

    const stored = await mirror(part)
    const k1 = nextKeyAfter('a7')
    const k2 = nextKeyAfter(k1)
    const k3 = nextKeyAfter(k2)
    expect(stored.slice(3)).toEqual([
      { relatedEntityId: added[0], sortKey: k1 },
      { relatedEntityId: added[1], sortKey: k2 },
      { relatedEntityId: added[2], sortKey: k3 },
    ])
    expect(await mirror(other)).toEqual([
      { relatedEntityId: added[0], sortKey: nextKeyAfter(null) },
    ])
  })
})
