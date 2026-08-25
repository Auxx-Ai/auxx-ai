// packages/lib/src/entity-instances/__tests__/dangling-relation-sweep.int.test.ts
//
// DB-backed regression test (vitest.integration.config.ts → auxx_test) for the
// inbound half of a relation surviving the delete of the record it points at.
//
// A relation is TWO mirror `FieldValue` rows, one on each end, and
// `FieldValue.relatedEntityId` has no foreign key. `deleteEntityInstance` used to
// delete only `where entityId = id` — the dead record's own half — leaving the
// mirror row sitting on the still-living record at the other end, pointing at an
// id that no longer resolves. 1,619 such rows in the dev database, all of them on
// live records.
//
// WHY INTEGRATION. Every claim here is a claim about stored rows and about
// `EntityInstance.searchText`, which is a materialized column computed by a raw
// SQL expression that LEFT JOINs the related instance for its `displayName`. A
// mocked db can assert "the delete builder was called with this predicate"; only
// real SQL can assert that the holder's search corpus stopped containing the dead
// record's name.
//
// The org cache is mocked wholesale (same approach as
// `field-values/__tests__/write-idempotency-stamps.int.test.ts`) because
// `getCachedResources` is Redis-backed. The stub returns one resource whose
// PRIMARY display field is the relationship — which is what makes the dependent
// display-name cascade observable.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { updateSearchTextForInstances } from '../../field-values/search-text'
import { deleteEntityInstance } from '../delete-entity-instance'

const db = () => getTestDb() as never as Database

/**
 * Mutable so `seed()` can publish the field id the display config has to point
 * at — `checkDisplayField` matches `resource.display.primaryDisplayField.id`
 * against `resource.fields[].id`, both of which are real `CustomField` ids here.
 */
let resources: unknown[] = []

vi.mock('../../cache', () => ({
  getCachedResources: async () => resources,
}))

interface Fixture {
  orgId: string
  otherOrgId: string
  contactDefId: string
  workOrderDefId: string
  /** RELATIONSHIP field on work_order pointing at a contact. */
  woContactFieldId: string
  /** The mirror RELATIONSHIP field on contact. */
  contactWorkOrdersFieldId: string
  contactId: string
  workOrderId: string
}

const DEAD_NAME = 'Zebra Dead Contact'

async function definition(orgId: string, entityType: string, apiSlug: string): Promise<string> {
  const [def] = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId: orgId,
      entityType,
      apiSlug,
      singular: entityType,
      plural: apiSlug,
      updatedAt: new Date(),
    })
    .returning()
  return def!.id
}

async function relationshipField(
  orgId: string,
  defId: string,
  modelType: string,
  name: string,
  systemAttribute: string
): Promise<string> {
  const [field] = await db()
    .insert(schema.CustomField)
    .values({
      organizationId: orgId,
      entityDefinitionId: defId,
      modelType,
      name,
      type: 'RELATIONSHIP',
      systemAttribute,
      sortOrder: 'a1',
      isCustom: false,
      updatedAt: new Date(),
    })
    .returning()
  return field!.id
}

async function instance(
  orgId: string,
  defId: string,
  displayName: string,
  secondaryDisplayValue?: string
): Promise<string> {
  const [row] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId: orgId,
      entityDefinitionId: defId,
      displayName,
      secondaryDisplayValue: secondaryDisplayValue ?? null,
      updatedAt: new Date(),
    })
    .returning()
  return row!.id
}

async function relationValue(
  orgId: string,
  entityId: string,
  entityDefinitionId: string,
  fieldId: string,
  relatedEntityId: string,
  relatedEntityDefinitionId: string,
  /** Multi-value fields store one row per value; `(entityId, fieldId, sortKey)` is unique. */
  sortKey = 'a'
): Promise<void> {
  await db().insert(schema.FieldValue).values({
    organizationId: orgId,
    entityId,
    entityDefinitionId,
    fieldId,
    relatedEntityId,
    relatedEntityDefinitionId,
    sortKey,
    updatedAt: new Date(),
  })
}

async function seed(): Promise<Fixture> {
  const org = await createTestOrganization()
  const otherOrg = await createTestOrganization()

  const contactDefId = await definition(org.id, 'contact', 'contacts')
  const workOrderDefId = await definition(org.id, 'work_order', 'work-orders')

  const woContactFieldId = await relationshipField(
    org.id,
    workOrderDefId,
    'work_order',
    'Contact',
    'work_order_contact'
  )
  const contactWorkOrdersFieldId = await relationshipField(
    org.id,
    contactDefId,
    'contact',
    'Work Orders',
    'contact_work_orders'
  )

  const contactId = await instance(org.id, contactDefId, DEAD_NAME)
  // The work order's PRIMARY display value is projected from the contact — the
  // same denormalization the display cascade maintains on rename.
  const workOrderId = await instance(org.id, workOrderDefId, DEAD_NAME, 'WO-1')

  // Both halves of the one relation.
  await relationValue(
    org.id,
    workOrderId,
    workOrderDefId,
    woContactFieldId,
    contactId,
    contactDefId
  )
  await relationValue(
    org.id,
    contactId,
    contactDefId,
    contactWorkOrdersFieldId,
    workOrderId,
    workOrderDefId
  )

  resources = [
    {
      id: workOrderDefId,
      entityType: 'work_order',
      fields: [
        {
          id: woContactFieldId,
          systemAttribute: 'work_order_contact',
          relationshipConfig: { relatedEntityType: 'contact' },
        },
      ],
      display: {
        primaryDisplayField: { id: woContactFieldId, type: 'RELATIONSHIP' },
        secondaryDisplayField: null,
      },
    },
  ]

  await updateSearchTextForInstances(db(), org.id, [workOrderId, contactId])

  return {
    orgId: org.id,
    otherOrgId: otherOrg.id,
    contactDefId,
    workOrderDefId,
    woContactFieldId,
    contactWorkOrdersFieldId,
    contactId,
    workOrderId,
  }
}

async function valuesPointingAt(id: string) {
  return await db()
    .select()
    .from(schema.FieldValue)
    .where(eq(schema.FieldValue.relatedEntityId, id))
}

async function valuesOwnedBy(id: string) {
  return await db().select().from(schema.FieldValue).where(eq(schema.FieldValue.entityId, id))
}

async function instanceRow(id: string) {
  const [row] = await db()
    .select()
    .from(schema.EntityInstance)
    .where(eq(schema.EntityInstance.id, id))
  return row ?? null
}

let f: Fixture
beforeEach(async () => {
  vi.clearAllMocks()
  resources = []
  f = await seed()
})

describe('deleteEntityInstance — relation sweep', () => {
  it('leaves NO row pointing at the deleted record, on either end', async () => {
    // Precondition: the mirror row exists and the holder carries the dead name.
    expect(await valuesPointingAt(f.contactId)).toHaveLength(1)
    expect((await instanceRow(f.workOrderId))!.searchText).toContain('Zebra')

    const result = await deleteEntityInstance({ id: f.contactId, organizationId: f.orgId })
    expect(result.isOk()).toBe(true)

    // The mirror half on the surviving work order — this is the whole bug.
    expect(await valuesPointingAt(f.contactId)).toHaveLength(0)
    // The dead record's own half.
    expect(await valuesOwnedBy(f.contactId)).toHaveLength(0)
    expect(await instanceRow(f.contactId)).toBeNull()
  })

  it('drops the dead name from the holder searchText and its projected displayName', async () => {
    await deleteEntityInstance({ id: f.contactId, organizationId: f.orgId })

    const workOrder = await instanceRow(f.workOrderId)
    expect(workOrder).not.toBeNull()
    // The record itself survives — only its references to the dead one are gone.
    expect(workOrder!.searchText).not.toContain('Zebra')
    expect(workOrder!.searchText).toContain('WO-1')
    // The projected display column no longer advertises a record that is gone.
    expect(workOrder!.displayName).toBeNull()
  })

  it('is org-scoped in BOTH directions — a mismatched org strips nothing', async () => {
    // Defect B: the outbound delete used to run first and unscoped, so a
    // mismatched organizationId emptied a record it then failed to delete, and
    // still reported success.
    const result = await deleteEntityInstance({
      id: f.contactId,
      organizationId: f.otherOrgId,
    })
    expect(result.isOk()).toBe(true)

    expect(await instanceRow(f.contactId)).not.toBeNull()
    expect(await valuesOwnedBy(f.contactId)).toHaveLength(1)
    expect(await valuesPointingAt(f.contactId)).toHaveLength(1)
  })

  it('does not touch relations between two surviving records', async () => {
    const otherContactId = await instance(f.orgId, f.contactDefId, 'Untouched Contact')
    await relationValue(
      f.orgId,
      f.workOrderId,
      f.workOrderDefId,
      f.woContactFieldId,
      otherContactId,
      f.contactDefId,
      'b'
    )

    await deleteEntityInstance({ id: f.contactId, organizationId: f.orgId })

    const survivors = await db()
      .select()
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.entityId, f.workOrderId),
          eq(schema.FieldValue.relatedEntityId, otherContactId)
        )
      )
    expect(survivors).toHaveLength(1)
    expect(await instanceRow(otherContactId)).not.toBeNull()
  })
})
