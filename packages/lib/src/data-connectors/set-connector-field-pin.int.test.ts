// packages/lib/src/data-connectors/set-connector-field-pin.int.test.ts
// `setConnectorFieldPin` against a real database (plans/money/tasks/40 section
// 6.4): one UPDATE ... RETURNING over every live item of the connector on the
// instance, idempotent in both directions, NotFound when nothing is bound. The
// jsonb operators (`?`, `||`, `-`) are the point, so this is not mockable.

import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotFoundError } from '../errors'
import {
  type BoundRecordFixture,
  bindThroughNewMapping,
  insertTextValue,
  seedBoundRecord,
  testDb,
} from './__int-test-helpers'

// `mutations.ts` pulls the scheduler in, which reaches BullMQ through `getQueue`.
// Nothing here calls it; keep the import graph off Redis.
vi.mock('../jobs/queues', () => ({
  getQueue: () => ({ removeJobScheduler: vi.fn().mockResolvedValue(undefined) }),
  Queues: { dataConnectorQueue: 'data-connector' },
}))

import { setConnectorFieldPin } from './mutations'

async function pinnedFieldsOf(itemId: string): Promise<string[]> {
  const [row] = await testDb()
    .select({ pinnedFields: schema.DataConnectorItem.pinnedFields })
    .from(schema.DataConnectorItem)
    .where(eq(schema.DataConnectorItem.id, itemId))
  return row!.pinnedFields
}

let f: BoundRecordFixture
beforeEach(async () => {
  f = await seedBoundRecord()
})

const pin = (pinned: boolean, over: Partial<Parameters<typeof setConnectorFieldPin>[1]> = {}) =>
  setConnectorFieldPin(testDb(), {
    organizationId: f.orgId,
    entityInstanceId: f.instanceId,
    fieldId: f.descriptionFieldId,
    connectorId: f.connectorId,
    pinned,
    ...over,
  })

describe('setConnectorFieldPin', () => {
  it('pins a field and returns the new list', async () => {
    const result = await pin(true)

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().pinnedFields).toEqual([f.descriptionFieldId])
    expect(await pinnedFieldsOf(f.itemId)).toEqual([f.descriptionFieldId])
  })

  it('pinning twice is idempotent: the list holds the id once', async () => {
    await pin(true)
    const result = await pin(true)

    expect(result._unsafeUnwrap().pinnedFields).toEqual([f.descriptionFieldId])
    expect(await pinnedFieldsOf(f.itemId)).toEqual([f.descriptionFieldId])
  })

  it('appends a second field beside the first', async () => {
    await pin(true)
    const result = await pin(true, { fieldId: f.titleFieldId })

    expect(result._unsafeUnwrap().pinnedFields).toEqual([f.descriptionFieldId, f.titleFieldId])
  })

  it('unpins and leaves the other pins alone', async () => {
    await pin(true)
    await pin(true, { fieldId: f.titleFieldId })

    const result = await pin(false)

    expect(result._unsafeUnwrap().pinnedFields).toEqual([f.titleFieldId])
    expect(await pinnedFieldsOf(f.itemId)).toEqual([f.titleFieldId])
  })

  it('unpinning a field that is not pinned is a no-op, not an error', async () => {
    const result = await pin(false)

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().pinnedFields).toEqual([])
  })

  it('fails with NotFoundError when the record is not bound to this connector', async () => {
    const [other] = await testDb()
      .insert(schema.DataConnector)
      .values({ organizationId: f.orgId, type: 'generic-rest', name: 'Other' })
      .returning()

    const result = await pin(true, { connectorId: other!.id })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
    expect(await pinnedFieldsOf(f.itemId)).toEqual([])
  })

  it('ignores an archived binding: only live items count as bound', async () => {
    await testDb()
      .update(schema.DataConnectorItem)
      .set({ archivedAt: new Date() })
      .where(eq(schema.DataConnectorItem.id, f.itemId))

    const result = await pin(true)

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
    expect(await pinnedFieldsOf(f.itemId)).toEqual([])
  })

  it('pins every live item of the connector on the instance, and none of an archived one', async () => {
    // The contact-bound-twice case: `customer` stream + `order.customer`.
    const second = await bindThroughNewMapping(testDb(), {
      orgId: f.orgId,
      connectorId: f.connectorId,
      defId: f.defId,
      instanceId: f.instanceId,
      streamKey: 'order',
      fieldMappings: f.fieldMappings,
      managedFields: [f.descriptionRef],
      externalId: 'o1-customer',
    })
    const archived = await bindThroughNewMapping(testDb(), {
      orgId: f.orgId,
      connectorId: f.connectorId,
      defId: f.defId,
      instanceId: f.instanceId,
      streamKey: 'legacy',
      fieldMappings: f.fieldMappings,
      managedFields: [],
      externalId: 'legacy-1',
      archivedAt: new Date(),
    })

    const result = await pin(true)

    expect(result._unsafeUnwrap().pinnedFields).toEqual([f.descriptionFieldId])
    expect(await pinnedFieldsOf(f.itemId)).toEqual([f.descriptionFieldId])
    expect(await pinnedFieldsOf(second.itemId)).toEqual([f.descriptionFieldId])
    expect(await pinnedFieldsOf(archived.itemId)).toEqual([])

    const unpinned = await pin(false)
    expect(unpinned._unsafeUnwrap().pinnedFields).toEqual([])
    expect(await pinnedFieldsOf(second.itemId)).toEqual([])
  })

  it('is scoped to the organization', async () => {
    const result = await pin(true, { organizationId: 'org_someone_else' })

    expect(result.isErr()).toBe(true)
    expect(await pinnedFieldsOf(f.itemId)).toEqual([])
  })
})

// The badge repaints the ONE cell it acted on from this answer instead of
// dropping the record's whole field-value cache (task 42 §0), so the state it
// gets back has to be the same one the batch read would have produced.
describe('setConnectorFieldPin, the returned cell sync state', () => {
  it('pinning answers paused, and names the connector that holds the pin', async () => {
    await insertTextValue(testDb(), f, f.descriptionFieldId, 'From the shop', f.connectorId)

    const result = await pin(true)

    expect(result._unsafeUnwrap().sync).toEqual({
      connectorId: f.connectorId,
      state: 'paused',
      willOverwrite: true,
    })
  })

  it('resuming a still-stamped cell answers synced', async () => {
    await insertTextValue(testDb(), f, f.descriptionFieldId, 'From the shop', f.connectorId)
    await pin(true)

    const result = await pin(false)

    expect(result._unsafeUnwrap().sync).toEqual({
      connectorId: f.connectorId,
      state: 'synced',
      willOverwrite: true,
    })
  })

  it('resuming a hand-edited cell answers edited, not nothing', async () => {
    await insertTextValue(testDb(), f, f.descriptionFieldId, 'my own words', null)
    await pin(true)

    const result = await pin(false)

    expect(result._unsafeUnwrap().sync).toEqual({
      connectorId: f.connectorId,
      state: 'edited',
      willOverwrite: true,
    })
  })

  it('resuming a CLEARED cell answers edited: the next run re-fills it', async () => {
    // No FieldValue row at all — the case that used to leave the cell with no
    // badge, because the batch read only emits a row-less cell when it is paused.
    await pin(true)

    const result = await pin(false)

    expect(result._unsafeUnwrap().sync).toEqual({
      connectorId: f.connectorId,
      state: 'edited',
      willOverwrite: true,
    })
  })

  it('a field the mapping does not bind answers null', async () => {
    // Not pinned, no marker, not in `managedFields`: nothing binds this cell.
    const [unbound] = await testDb()
      .insert(schema.CustomField)
      .values({
        organizationId: f.orgId,
        entityDefinitionId: f.defId,
        modelType: 'product',
        name: 'Internal note',
        type: 'TEXT',
        options: {},
        sortOrder: 'a3',
        isCustom: true,
        updatedAt: new Date(),
      })
      .returning()

    const result = await pin(false, { fieldId: unbound!.id })

    expect(result._unsafeUnwrap().sync).toBeNull()
  })
})
