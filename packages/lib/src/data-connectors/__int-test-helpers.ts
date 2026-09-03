// packages/lib/src/data-connectors/__int-test-helpers.ts
//
// DB-backed fixture for the data-connector integration tests (`*.int.test.ts`,
// run through vitest.integration.config.ts against auxx_test): one org, one
// contributing product def with two scalar TEXT fields, one product record, and
// one connector whose stream carries a contributing mapping bound to that record.
// Every row goes in through Drizzle so the fixture cannot drift from the schema.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { toResourceFieldId } from '@auxx/types/field'
import type { FieldMapping } from './types'

export const testDb = () => getTestDb() as never as Database

export interface BoundRecordFixture {
  orgId: string
  defId: string
  /** `Description`, a custom TEXT field (write key is the uuid). */
  descriptionFieldId: string
  descriptionRef: string
  /** `Title`, a second custom TEXT field. */
  titleFieldId: string
  titleRef: string
  instanceId: string
  connectorId: string
  streamId: string
  mappingId: string
  /** The live item binding the record through `mappingId`. */
  itemId: string
  fieldMappings: FieldMapping[]
}

/**
 * Seed the fixture. `mergeStrategy` applies to both bindings; unset means the
 * default (`overwrite`). `contentHash` is stamped on the item so a test can make
 * the source look unchanged and exercise the content-hash skip + drift path.
 */
export async function seedBoundRecord(
  options: { mergeStrategy?: FieldMapping['mergeStrategy']; contentHash?: string } = {}
): Promise<BoundRecordFixture> {
  const db = testDb()
  const org = await createTestOrganization()

  const [def] = await db
    .insert(schema.EntityDefinition)
    .values({
      organizationId: org.id,
      entityType: 'product',
      apiSlug: 'products',
      singular: 'product',
      plural: 'products',
      updatedAt: new Date(),
    })
    .returning()

  const field = async (name: string, sortOrder: string) => {
    const [row] = await db
      .insert(schema.CustomField)
      .values({
        organizationId: org.id,
        entityDefinitionId: def!.id,
        modelType: 'product',
        name,
        type: 'TEXT',
        options: {},
        sortOrder,
        isCustom: true,
        updatedAt: new Date(),
      })
      .returning()
    return row!
  }
  const description = await field('Description', 'a1')
  const title = await field('Title', 'a2')

  const [inst] = await db
    .insert(schema.EntityInstance)
    .values({
      organizationId: org.id,
      entityDefinitionId: def!.id,
      displayName: 'Widget',
      updatedAt: new Date(),
    })
    .returning()

  const [connector] = await db
    .insert(schema.DataConnector)
    .values({ organizationId: org.id, type: 'generic-rest', name: 'Shop' })
    .returning()

  const descriptionRef = toResourceFieldId(def!.id, description.id)
  const titleRef = toResourceFieldId(def!.id, title.id)
  const strategy = options.mergeStrategy ? { mergeStrategy: options.mergeStrategy } : {}
  const fieldMappings: FieldMapping[] = [
    {
      id: 'fm_desc',
      targetFieldRef: descriptionRef,
      expression: '{description}',
      sourceFields: { description: 'description' },
      ...strategy,
    },
    {
      id: 'fm_title',
      targetFieldRef: titleRef,
      expression: '{title}',
      sourceFields: { title: 'title' },
      ...strategy,
    },
  ]

  const { streamId, mappingId, itemId } = await bindThroughNewMapping(db, {
    orgId: org.id,
    connectorId: connector!.id,
    defId: def!.id,
    instanceId: inst!.id,
    streamKey: 'product',
    fieldMappings,
    managedFields: [descriptionRef, titleRef],
    contentHash: options.contentHash ?? null,
  })

  return {
    orgId: org.id,
    defId: def!.id,
    descriptionFieldId: description.id,
    descriptionRef,
    titleFieldId: title.id,
    titleRef,
    instanceId: inst!.id,
    connectorId: connector!.id,
    streamId,
    mappingId,
    itemId,
    fieldMappings,
  }
}

/**
 * Add a stream + contributing mapping to `connectorId` and bind `instanceId`
 * through it with a live item. A second call on the same fixture models a contact
 * bound from both the `customer` stream and `order.customer` (two items, one
 * instance, one connector).
 */
export async function bindThroughNewMapping(
  db: Database,
  input: {
    orgId: string
    connectorId: string
    defId: string
    instanceId: string
    streamKey: string
    fieldMappings: FieldMapping[]
    managedFields: string[]
    contentHash?: string | null
    externalId?: string
    archivedAt?: Date | null
  }
): Promise<{ streamId: string; mappingId: string; itemId: string }> {
  const [stream] = await db
    .insert(schema.DataConnectorStream)
    .values({
      dataConnectorId: input.connectorId,
      organizationId: input.orgId,
      streamKey: input.streamKey,
    })
    .returning()
  const [mapping] = await db
    .insert(schema.DataConnectorMapping)
    .values({
      dataConnectorStreamId: stream!.id,
      organizationId: input.orgId,
      targetMode: 'contributing',
      entityDefinitionId: input.defId,
      fieldMappings: input.fieldMappings,
    })
    .returning()
  const [item] = await db
    .insert(schema.DataConnectorItem)
    .values({
      dataConnectorId: input.connectorId,
      organizationId: input.orgId,
      mappingId: mapping!.id,
      externalId: input.externalId ?? 'p1',
      entityDefinitionId: input.defId,
      entityInstanceId: input.instanceId,
      contentHash: input.contentHash ?? null,
      managedFields: input.managedFields,
      archivedAt: input.archivedAt ?? null,
    })
    .returning()
  return { streamId: stream!.id, mappingId: mapping!.id, itemId: item!.id }
}

/** Write one scalar TEXT row for a field on the fixture record. */
export async function insertTextValue(
  db: Database,
  f: Pick<BoundRecordFixture, 'orgId' | 'defId' | 'instanceId'>,
  fieldId: string,
  valueText: string,
  managedByConnectorId: string | null
): Promise<void> {
  await db.insert(schema.FieldValue).values({
    organizationId: f.orgId,
    fieldId,
    entityId: f.instanceId,
    entityDefinitionId: f.defId,
    valueText,
    managedByConnectorId,
  })
}
