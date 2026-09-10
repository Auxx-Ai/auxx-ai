// packages/lib/src/data-connectors/orphan-state.int.test.ts
// The archive-cap keys against a real database (v12.1 Phase 3). `DataConnector.state`
// is shared with the sync cursor and the backfill latch, so the point of these tests
// is what a fake cannot prove: an unrelated key survives every write, and the one-shot
// override can be taken exactly once even under a race. Run through
// vitest.integration.config.ts.

import { schema } from '@auxx/database'
import { createTestOrganization } from '@auxx/test-utils'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { bindThroughNewMapping, seedBoundRecord, testDb } from './__int-test-helpers'
import {
  clearArchiveCapTripped,
  listMintedInstanceIds,
  setArchiveCapTripped,
  takeArchiveCapOverride,
} from './orphan-state'

const CURSOR = { cursor: { products: 'page-7' }, backfillStreamsRemaining: 2 }

async function newConnector(state: Record<string, unknown> = CURSOR): Promise<string> {
  const org = await createTestOrganization()
  const [row] = await testDb()
    .insert(schema.DataConnector)
    .values({ organizationId: org.id, type: 'generic-rest', name: 'Shop', state })
    .returning({ id: schema.DataConnector.id })
  return row!.id
}

async function stateOf(id: string): Promise<Record<string, unknown>> {
  const row = await testDb().query.DataConnector.findFirst({
    where: eq(schema.DataConnector.id, id),
    columns: { state: true },
  })
  return row!.state
}

const STAMP = {
  at: '2026-09-09T01:02:03.000Z',
  runId: 'run-1',
  orphans: 30,
  bound: 100,
  reason: '30 of 100 bound records (30%) vanished from the crawl',
}

describe('archiveCapTripped on DataConnector.state', () => {
  let id: string
  beforeEach(async () => {
    id = await newConnector()
  })

  it('stamps the key next to the cursor and latch, leaving both intact', async () => {
    await setArchiveCapTripped(testDb(), id, STAMP)
    expect(await stateOf(id)).toEqual({ ...CURSOR, archiveCapTripped: STAMP })
  })

  it('overwrites an earlier stamp with the newest refusal', async () => {
    await setArchiveCapTripped(testDb(), id, STAMP)
    await setArchiveCapTripped(testDb(), id, { ...STAMP, runId: 'run-2', orphans: 31 })
    expect((await stateOf(id)).archiveCapTripped).toEqual({ ...STAMP, runId: 'run-2', orphans: 31 })
  })

  it('clears only that key', async () => {
    await setArchiveCapTripped(testDb(), id, STAMP)
    await clearArchiveCapTripped(testDb(), id)
    expect(await stateOf(id)).toEqual(CURSOR)
  })

  it('clearing a connector that was never tripped is a no-op that leaves state alone', async () => {
    await clearArchiveCapTripped(testDb(), id)
    expect(await stateOf(id)).toEqual(CURSOR)
  })

  it('works from a NULL-free empty state too', async () => {
    const fresh = await newConnector({})
    await setArchiveCapTripped(testDb(), fresh, STAMP)
    expect(await stateOf(fresh)).toEqual({ archiveCapTripped: STAMP })
  })
})

describe('takeArchiveCapOverride', () => {
  const OVERRIDE = { at: '2026-09-09T02:00:00.000Z', byUserId: 'user-1' }

  it('returns the override and removes only that key', async () => {
    const id = await newConnector({ ...CURSOR, archiveCapOverride: OVERRIDE })
    expect(await takeArchiveCapOverride(testDb(), id)).toEqual(OVERRIDE)
    expect(await stateOf(id)).toEqual(CURSOR)
  })

  it('returns null when nothing is pending, without touching the row', async () => {
    const id = await newConnector()
    expect(await takeArchiveCapOverride(testDb(), id)).toBeNull()
    expect(await stateOf(id)).toEqual(CURSOR)
  })

  it('is one-shot: a second take gets nothing', async () => {
    const id = await newConnector({ ...CURSOR, archiveCapOverride: OVERRIDE })
    expect(await takeArchiveCapOverride(testDb(), id)).toEqual(OVERRIDE)
    expect(await takeArchiveCapOverride(testDb(), id)).toBeNull()
  })

  // Two finalizes racing on one connector: the row lock serializes the UPDATEs and the
  // loser's WHERE is re-evaluated against the winner's committed row, so exactly one
  // of them gets the value.
  it('hands the override to exactly one of two concurrent takers', async () => {
    const id = await newConnector({ ...CURSOR, archiveCapOverride: OVERRIDE })
    const results = await Promise.all([
      takeArchiveCapOverride(testDb(), id),
      takeArchiveCapOverride(testDb(), id),
      takeArchiveCapOverride(testDb(), id),
    ])
    expect(results.filter((r) => r !== null)).toEqual([OVERRIDE])
    expect(await stateOf(id)).toEqual(CURSOR)
  })

  it('leaves a tripped stamp in place: the pass that runs under the override clears it', async () => {
    const id = await newConnector({
      ...CURSOR,
      archiveCapTripped: STAMP,
      archiveCapOverride: OVERRIDE,
    })
    await takeArchiveCapOverride(testDb(), id)
    expect(await stateOf(id)).toEqual({ ...CURSOR, archiveCapTripped: STAMP })
  })
})

describe('listMintedInstanceIds', () => {
  it('answers per instance across every binding of the connector, and only this connector', async () => {
    const db = testDb()
    const f = await seedBoundRecord()
    // The seeded item is the minting binding.
    await db
      .update(schema.DataConnectorItem)
      .set({ mintedInstance: true })
      .where(eq(schema.DataConnectorItem.id, f.itemId))
    // A def-keyed sibling bound to the SAME instance, not minted on its own row.
    await bindThroughNewMapping(db, {
      orgId: f.orgId,
      connectorId: f.connectorId,
      defId: f.defId,
      instanceId: f.instanceId,
      streamKey: 'order.product',
      fieldMappings: f.fieldMappings,
      managedFields: [],
      externalId: 'p1-embedded',
    })
    // A second instance this connector merely enriched.
    const [enriched] = await db
      .insert(schema.EntityInstance)
      .values({
        organizationId: f.orgId,
        entityDefinitionId: f.defId,
        displayName: 'Gadget',
        updatedAt: new Date(),
      })
      .returning({ id: schema.EntityInstance.id })
    await bindThroughNewMapping(db, {
      orgId: f.orgId,
      connectorId: f.connectorId,
      defId: f.defId,
      instanceId: enriched!.id,
      streamKey: 'gadgets',
      fieldMappings: f.fieldMappings,
      managedFields: [],
      externalId: 'g1',
    })
    // A third instance minted by a DIFFERENT connector of the same org.
    const [other] = await db
      .insert(schema.DataConnector)
      .values({ organizationId: f.orgId, type: 'generic-rest', name: 'Other' })
      .returning({ id: schema.DataConnector.id })
    const [foreign] = await db
      .insert(schema.EntityInstance)
      .values({
        organizationId: f.orgId,
        entityDefinitionId: f.defId,
        displayName: 'Foreign',
        updatedAt: new Date(),
      })
      .returning({ id: schema.EntityInstance.id })
    const bound = await bindThroughNewMapping(db, {
      orgId: f.orgId,
      connectorId: other!.id,
      defId: f.defId,
      instanceId: foreign!.id,
      streamKey: 'foreign',
      fieldMappings: f.fieldMappings,
      managedFields: [],
      externalId: 'x1',
    })
    await db
      .update(schema.DataConnectorItem)
      .set({ mintedInstance: true })
      .where(eq(schema.DataConnectorItem.id, bound.itemId))

    const minted = await listMintedInstanceIds(db, f.connectorId, [
      f.instanceId,
      enriched!.id,
      foreign!.id,
    ])
    expect(minted).toEqual(new Set([f.instanceId]))
  })

  it('counts a mint the binding remembers in mintedInstanceId after a rebind cleared it', async () => {
    const db = testDb()
    const f = await seedBoundRecord()
    await db
      .update(schema.DataConnectorItem)
      .set({ entityInstanceId: null, mintedInstance: false, mintedInstanceId: f.instanceId })
      .where(eq(schema.DataConnectorItem.id, f.itemId))
    expect(await listMintedInstanceIds(db, f.connectorId, [f.instanceId])).toEqual(
      new Set([f.instanceId])
    )
  })
})
