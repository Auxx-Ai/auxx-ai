// packages/lib/src/data-connectors/removed-upstream.int.test.ts
// The "Gone upstream" reads and writes against a real database (v12.1 Phases 3c and
// 5). The point of this file is the one thing a query double cannot prove: that
// `requestArchiveCapOverride` leaves every OTHER key of the shared `DataConnector.state`
// jsonb (the sync cursor) untouched, and that `unbindItem` removes exactly one of two
// bindings on the same record.

import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { BadRequestError } from '../errors'
import {
  type BoundRecordFixture,
  bindThroughNewMapping,
  seedBoundRecord,
  testDb,
} from './__int-test-helpers'
import { findRemovedUpstreamItem, listRemovedUpstreamItems } from './removed-upstream'
import { requestArchiveCapOverride, unbindItem } from './removed-upstream-mutations'

const TRIPPED = {
  at: '2026-09-09T02:00:00.000Z',
  runId: 'run_9',
  orphans: 600,
  bound: 700,
  reason: 'more than 500 records vanished at once',
}

async function stateOf(connectorId: string): Promise<Record<string, unknown>> {
  const [row] = await testDb()
    .select({ state: schema.DataConnector.state })
    .from(schema.DataConnector)
    .where(eq(schema.DataConnector.id, connectorId))
  return row!.state
}

async function flag(itemId: string, at = new Date('2026-09-09T02:00:00.000Z')) {
  await testDb()
    .update(schema.DataConnectorItem)
    .set({ removedUpstreamAt: at, lastSeenRunId: 'run_9' })
    .where(eq(schema.DataConnectorItem.id, itemId))
}

let f: BoundRecordFixture
beforeEach(async () => {
  f = await seedBoundRecord()
})

describe('requestArchiveCapOverride', () => {
  it('merges the override next to the cursor and the stamp, touching neither', async () => {
    await testDb()
      .update(schema.DataConnector)
      .set({ state: { cursor: 'c1', archiveCapTripped: TRIPPED } })
      .where(eq(schema.DataConnector.id, f.connectorId))

    const result = await requestArchiveCapOverride(testDb(), f.orgId, f.connectorId, 'user_1')
    const override = result._unsafeUnwrap()

    expect(await stateOf(f.connectorId)).toEqual({
      cursor: 'c1',
      archiveCapTripped: TRIPPED,
      archiveCapOverride: override,
    })
  })

  it('refuses without a stamp and writes nothing', async () => {
    await testDb()
      .update(schema.DataConnector)
      .set({ state: { cursor: 'c1' } })
      .where(eq(schema.DataConnector.id, f.connectorId))

    const result = await requestArchiveCapOverride(testDb(), f.orgId, f.connectorId, 'user_1')
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    expect(await stateOf(f.connectorId)).toEqual({ cursor: 'c1' })
  })
})

describe('listRemovedUpstreamItems', () => {
  it('lists a flagged, live binding with its record name and skips an archived one', async () => {
    await flag(f.itemId)
    const other = await bindThroughNewMapping(testDb(), {
      orgId: f.orgId,
      connectorId: f.connectorId,
      defId: f.defId,
      instanceId: f.instanceId,
      streamKey: 'orders',
      fieldMappings: f.fieldMappings,
      managedFields: [f.descriptionRef],
      externalId: 'p1-via-order',
      archivedAt: new Date(),
    })
    await flag(other.itemId)

    const items = await listRemovedUpstreamItems(testDb(), f.orgId, f.connectorId)
    expect(items.map((i) => i.id)).toEqual([f.itemId])
    expect(items[0]).toMatchObject({
      externalId: 'p1',
      entityDefinitionId: f.defId,
      entityInstanceId: f.instanceId,
      lastSeenRunId: 'run_9',
      displayName: 'Widget',
    })
  })

  it('answers nothing for an unflagged binding, and nothing across connectors', async () => {
    expect(await listRemovedUpstreamItems(testDb(), f.orgId, f.connectorId)).toEqual([])
    await flag(f.itemId)
    expect(await listRemovedUpstreamItems(testDb(), f.orgId, 'dc_other')).toEqual([])
    const found = await findRemovedUpstreamItem(testDb(), f.orgId, 'dc_other', f.itemId)
    expect(found.isErr()).toBe(true)
  })
})

describe('unbindItem', () => {
  it('deletes only the one row when two bindings share the record', async () => {
    const other = await bindThroughNewMapping(testDb(), {
      orgId: f.orgId,
      connectorId: f.connectorId,
      defId: f.defId,
      instanceId: f.instanceId,
      streamKey: 'orders',
      fieldMappings: f.fieldMappings,
      managedFields: [f.descriptionRef],
      externalId: 'p1-via-order',
    })

    const result = await unbindItem(testDb(), f.orgId, f.itemId)
    expect(result.isOk()).toBe(true)

    const remaining = await testDb()
      .select({ id: schema.DataConnectorItem.id })
      .from(schema.DataConnectorItem)
      .where(eq(schema.DataConnectorItem.entityInstanceId, f.instanceId))
    expect(remaining.map((r) => r.id)).toEqual([other.itemId])

    const [instance] = await testDb()
      .select({ id: schema.EntityInstance.id })
      .from(schema.EntityInstance)
      .where(eq(schema.EntityInstance.id, f.instanceId))
    expect(instance?.id).toBe(f.instanceId)
  })
})
