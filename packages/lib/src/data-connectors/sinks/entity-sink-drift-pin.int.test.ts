// packages/lib/src/data-connectors/sinks/entity-sink-drift-pin.int.test.ts
// Drift detection against a real database (plans/money/tasks/40 section 6.2):
// a hand-edited `overwrite` cell (marker cleared) makes the record drifted and
// the content-hash skip falls through to a write; the same cell PINNED on the
// record is not drift, so the skip fires; unpinning puts the record back. The
// predicate is a jsonb `?` inside a parameterised query, so this must run
// against Postgres, not the chainable mock. It doubles as the sync, edit, pin,
// sync, unpin, sync end-to-end from section 9.
//
// The field-ref resolver and the org cache are the only doubles: the first
// passes concrete refs through, the second reads the cached rows straight from
// the test database (recipe from field-values/__tests__/set-reconcile.int.test.ts).

import { type Database, schema } from '@auxx/database'
import { getTestDb } from '@auxx/test-utils'
import { stableHash } from '@auxx/utils/hash'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type BoundRecordFixture,
  insertTextValue,
  seedBoundRecord,
  testDb,
} from '../__int-test-helpers'
import { makeSyncCtx } from '../__test-helpers'
import type { DecodedMapping } from '../service'
import type { ProjectedRecord, SyncCtx } from './types'

vi.mock('../../agents/bindings/resolve', () => ({
  resolveConnectorFieldRef: async (ref: string) => ref,
}))

vi.mock('../jobs/queues', () => ({
  getQueue: () => ({ removeJobScheduler: vi.fn().mockResolvedValue(undefined) }),
  Queues: { dataConnectorQueue: 'data-connector' },
}))

vi.mock('../../cache', () => {
  const tdb = () => getTestDb() as never as Database
  const { eq: eqOp, and: andOp } = require('drizzle-orm')

  const fieldsForDef = async (orgId: string, defId: string) =>
    await tdb()
      .select()
      .from(schema.CustomField)
      .where(
        andOp(
          eqOp(schema.CustomField.organizationId, orgId),
          eqOp(schema.CustomField.entityDefinitionId, defId)
        )
      )

  return {
    getCachedCustomFields: fieldsForDef,
    getCachedFieldMap: async (orgId: string, defId: string) =>
      new Map((await fieldsForDef(orgId, defId)).map((f) => [f.id, f])),
    getCachedResource: async () => null,
  }
})

import { setConnectorFieldPin } from '../mutations'
import { entitySink } from './entity-sink'

const SOURCE_DESCRIPTION = 'From the shop'
const SOURCE_TITLE = 'Widget'

function projected(f: BoundRecordFixture): ProjectedRecord {
  return {
    externalId: 'p1',
    displayName: 'Widget',
    fields: { [f.descriptionRef]: SOURCE_DESCRIPTION, [f.titleRef]: SOURCE_TITLE },
    identityCandidates: [],
    pendingRelations: [],
  }
}

function decoded(f: BoundRecordFixture): DecodedMapping {
  return {
    row: { id: f.mappingId },
    rootPath: '',
    linkMode: 'upsert',
    targetMode: 'contributing',
    entityDefinitionId: f.defId,
    parentMappingId: null,
    relationshipFieldKey: null,
    orphanBehavior: 'ignore',
    fieldMappings: f.fieldMappings,
  } as unknown as DecodedMapping
}

/** A fresh ctx per run: the drift set is memoised on the ctx for the slice. */
function runCtx(f: BoundRecordFixture, update: ReturnType<typeof vi.fn>): SyncCtx {
  return makeSyncCtx({
    db: testDb(),
    orgId: f.orgId,
    connector: { id: f.connectorId, credentialId: null } as never,
    runId: `run_${Date.now()}_${Math.random()}`,
    crud: { update, getFieldValues: vi.fn(async () => new Map()) } as never,
    ownedCrud: {} as never,
  })
}

async function markerOf(f: BoundRecordFixture, fieldId: string): Promise<string | null> {
  const [row] = await testDb()
    .select({ marker: schema.FieldValue.managedByConnectorId })
    .from(schema.FieldValue)
    .where(
      and(eq(schema.FieldValue.entityId, f.instanceId), eq(schema.FieldValue.fieldId, fieldId))
    )
  return row?.marker ?? null
}

const pin = (f: BoundRecordFixture, pinned: boolean) =>
  setConnectorFieldPin(testDb(), {
    organizationId: f.orgId,
    entityInstanceId: f.instanceId,
    fieldId: f.descriptionFieldId,
    connectorId: f.connectorId,
    pinned,
  })

let f: BoundRecordFixture
let update: ReturnType<typeof vi.fn>

beforeEach(async () => {
  update = vi.fn(async () => undefined)
  const rec = {
    fields: {} as Record<string, unknown>,
    displayName: 'Widget',
  }
  // Seed with the content hash the projected record will carry, so the source
  // looks unchanged and the drift query is what decides the write.
  const seeded = await seedBoundRecord({ contentHash: 'placeholder' })
  rec.fields = projected(seeded).fields
  await testDb()
    .update(schema.DataConnectorItem)
    .set({ contentHash: stableHash(rec) })
    .where(eq(schema.DataConnectorItem.id, seeded.itemId))
  f = seeded
  // Both cells were synced (stamped) in an earlier run.
  await insertTextValue(testDb(), f, f.descriptionFieldId, SOURCE_DESCRIPTION, f.connectorId)
  await insertTextValue(testDb(), f, f.titleFieldId, SOURCE_TITLE, f.connectorId)
})

async function handEdit(fieldId: string, text: string): Promise<void> {
  await testDb()
    .update(schema.FieldValue)
    .set({ valueText: text, managedByConnectorId: null })
    .where(
      and(eq(schema.FieldValue.entityId, f.instanceId), eq(schema.FieldValue.fieldId, fieldId))
    )
}

describe('computeDriftedInstances with a pinned field', () => {
  it('an untouched record is skipped by the content hash (the control)', async () => {
    const ctx = runCtx(f, update)

    await entitySink.upsertRecord(ctx, decoded(f), projected(f))

    expect(update).not.toHaveBeenCalled()
    expect(ctx.counters.skipped).toBe(1)
  })

  it('a hand-edited overwrite cell is drift: the source value is re-asserted and re-stamped', async () => {
    await handEdit(f.descriptionFieldId, 'my own words')
    const ctx = runCtx(f, update)

    await entitySink.upsertRecord(ctx, decoded(f), projected(f))

    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0]?.[1]).toEqual({
      [f.descriptionFieldId]: SOURCE_DESCRIPTION,
      [f.titleFieldId]: SOURCE_TITLE,
    })
    expect(ctx.counters.updated).toBe(1)
    // The stamp UPDATE ran against the real FieldValue row.
    expect(await markerOf(f, f.descriptionFieldId)).toBe(f.connectorId)
  })

  it('the same edit on a PINNED field is not drift: the record is skipped and the cell kept', async () => {
    await handEdit(f.descriptionFieldId, 'my own words')
    expect((await pin(f, true)).isOk()).toBe(true)
    const ctx = runCtx(f, update)

    await entitySink.upsertRecord(ctx, decoded(f), projected(f))

    expect(update).not.toHaveBeenCalled()
    expect(ctx.counters.skipped).toBe(1)
    expect(await markerOf(f, f.descriptionFieldId)).toBeNull()
  })

  it('unpinning puts the record back in the drifted set, and the next run heals only that cell', async () => {
    await handEdit(f.descriptionFieldId, 'my own words')
    await pin(f, true)
    await entitySink.upsertRecord(runCtx(f, update), decoded(f), projected(f))
    expect(update).not.toHaveBeenCalled()

    expect((await pin(f, false)).isOk()).toBe(true)
    const ctx = runCtx(f, update)
    await entitySink.upsertRecord(ctx, decoded(f), projected(f))

    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0]?.[1]).toEqual({
      [f.descriptionFieldId]: SOURCE_DESCRIPTION,
      [f.titleFieldId]: SOURCE_TITLE,
    })
    expect(await markerOf(f, f.descriptionFieldId)).toBe(f.connectorId)
  })

  it('a pinned cell beside an unpinned drifted one: the record heals, but the pinned cell stays out of the write', async () => {
    await handEdit(f.descriptionFieldId, 'my own words')
    await handEdit(f.titleFieldId, 'my own title')
    await pin(f, true)
    const ctx = runCtx(f, update)

    await entitySink.upsertRecord(ctx, decoded(f), projected(f))

    // Title drifted (unpinned), so the record is written; description is pinned,
    // so it is neither in the write set nor re-stamped.
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0]?.[1]).toEqual({ [f.titleFieldId]: SOURCE_TITLE })
    expect(await markerOf(f, f.descriptionFieldId)).toBeNull()
    expect(await markerOf(f, f.titleFieldId)).toBe(f.connectorId)
  })
})

// Task 42 §3: `overwrite` means overwrite, so a cell the user CLEARED (row
// deleted, not edited) is drift like any other and the next run puts the value
// back. Before this the drift query inner-joined `FieldValue`, so a cleared cell
// was invisible and the content-hash skip left it empty until the SOURCE changed.
describe('computeDriftedInstances with a cleared cell', () => {
  const clear = (fieldId: string) =>
    testDb()
      .delete(schema.FieldValue)
      .where(
        and(eq(schema.FieldValue.entityId, f.instanceId), eq(schema.FieldValue.fieldId, fieldId))
      )

  it('a cleared overwrite cell is drift: the source value is re-asserted and re-stamped', async () => {
    await clear(f.descriptionFieldId)
    const ctx = runCtx(f, update)

    await entitySink.upsertRecord(ctx, decoded(f), projected(f))

    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0]?.[1]).toEqual({
      [f.descriptionFieldId]: SOURCE_DESCRIPTION,
      [f.titleFieldId]: SOURCE_TITLE,
    })
    // No marker assertion here: `crud.update` is a double, so the row the write
    // would recreate never exists for the stamp UPDATE to find.
  })

  it('a cleared cell that is PINNED is not drift: the record is skipped and the cell stays empty', async () => {
    await clear(f.descriptionFieldId)
    expect((await pin(f, true)).isOk()).toBe(true)
    const ctx = runCtx(f, update)

    await entitySink.upsertRecord(ctx, decoded(f), projected(f))

    expect(update).not.toHaveBeenCalled()
    expect(ctx.counters.skipped).toBe(1)
    expect(await markerOf(f, f.descriptionFieldId)).toBeNull()
  })

  it('a cleared cell the connector never managed is not drift: nothing to put back', async () => {
    // `managedFields` is the connector's record of what it has written here. A
    // field the source has never carried must not strand the record in a
    // never-skip loop.
    await clear(f.descriptionFieldId)
    await testDb()
      .update(schema.DataConnectorItem)
      .set({ managedFields: [f.titleRef] })
      .where(eq(schema.DataConnectorItem.id, f.itemId))
    const ctx = runCtx(f, update)

    await entitySink.upsertRecord(ctx, decoded(f), projected(f))

    expect(update).not.toHaveBeenCalled()
    expect(ctx.counters.skipped).toBe(1)
  })
})
