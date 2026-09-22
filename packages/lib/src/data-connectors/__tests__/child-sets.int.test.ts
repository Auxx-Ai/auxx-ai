// packages/lib/src/data-connectors/__tests__/child-sets.int.test.ts

import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type BoundRecordFixture, seedBoundRecord, testDb } from '../__int-test-helpers'
import { replaceChildSets } from '../child-sets'
import type { ChildSet } from '../map-record'
import type { DecodedMapping } from '../service'
import { entitySink } from '../sinks/entity-sink'
import type { SyncCtx } from '../sinks/types'

let f: BoundRecordFixture
let archive: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  f = await seedBoundRecord()
  archive = vi.spyOn(entitySink, 'archiveRecord').mockResolvedValue()
})
afterEach(() => archive.mockRestore())

const ctx = () => ({ db: testDb(), connector: { id: f.connectorId } }) as unknown as SyncCtx

const mapping = (orphanBehavior: DecodedMapping['orphanBehavior'] = 'archive') =>
  ({ row: { id: f.mappingId }, orphanBehavior }) as DecodedMapping

/** A live child item under this fixture's mapping, with its own instance. */
async function child(
  externalId: string,
  over: Partial<typeof schema.DataConnectorItem.$inferInsert> = {}
) {
  const [inst] = await testDb()
    .insert(schema.EntityInstance)
    .values({ organizationId: f.orgId, entityDefinitionId: f.defId, updatedAt: new Date() })
    .returning()
  const [item] = await testDb()
    .insert(schema.DataConnectorItem)
    .values({
      dataConnectorId: f.connectorId,
      organizationId: f.orgId,
      mappingId: f.mappingId,
      externalId,
      entityDefinitionId: f.defId,
      entityInstanceId: inst!.id,
      mintedInstance: true,
      ...over,
    })
    .returning()
  return item!
}

function set(parentExternalId: string, externalIds: string[], m = mapping()): ChildSet {
  return {
    mapping: m,
    parentExternalId,
    externalIds,
    root: { mappingId: f.mappingId, externalId: 'p1', upstreamUpdatedAt: undefined },
  }
}

const archivedIds = (): [string, unknown][] =>
  archive.mock.calls.map((c: unknown[]) => [(c[1] as { id: string }).id, c[2]])

describe('replaceChildSets', () => {
  it('stamps present children and retires the parent’s absent ones', async () => {
    const kept = await child('o1:WA:0.065')
    const stale = await child('o1:WA', { parentExternalId: 'o1' })
    const otherOrder = await child('o2:WA', { parentExternalId: 'o2' })

    await replaceChildSets(ctx(), [set('o1', ['o1:WA:0.065'])])

    expect(archivedIds()).toEqual([[stale.id, 'archive']])
    const [row] = await testDb()
      .select({ parent: schema.DataConnectorItem.parentExternalId })
      .from(schema.DataConnectorItem)
      .where(eq(schema.DataConnectorItem.id, kept.id))
    expect(row?.parent).toBe('o1')
    expect(archivedIds().some(([id]) => id === otherOrder.id)).toBe(false)
  })

  it('retires every child for an empty set and skips archived ones', async () => {
    const live = await child('o1:A', { parentExternalId: 'o1' })
    await child('o1:B', { parentExternalId: 'o1', archivedAt: new Date() })

    await replaceChildSets(ctx(), [set('o1', [])])

    expect(archivedIds()).toEqual([[live.id, 'archive']])
  })

  it('degrades to mark_deleted for a record it did not mint, and never re-flags', async () => {
    const enriched = await child('o1:A', { parentExternalId: 'o1', mintedInstance: false })
    await child('o1:B', {
      parentExternalId: 'o1',
      mintedInstance: false,
      removedUpstreamAt: new Date(),
    })

    await replaceChildSets(ctx(), [set('o1', [])])

    expect(archivedIds()).toEqual([[enriched.id, 'mark_deleted']])
  })

  it('does nothing when the root write was older than what the binding holds', async () => {
    await testDb()
      .update(schema.DataConnectorItem)
      .set({ upstreamUpdatedAt: new Date('2026-09-02T00:00:00Z') })
      .where(eq(schema.DataConnectorItem.id, f.itemId))
    await child('o1:A', { parentExternalId: 'o1' })
    const stale = set('o1', [])
    stale.root.upstreamUpdatedAt = new Date('2026-09-01T00:00:00Z')

    await replaceChildSets(ctx(), [stale])

    expect(archive).not.toHaveBeenCalled()
  })
})
