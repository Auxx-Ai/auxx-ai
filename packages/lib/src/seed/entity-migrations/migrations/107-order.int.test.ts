// packages/lib/src/seed/entity-migrations/migrations/107-order.int.test.ts
//
// DB-backed behavior tests (vitest.integration.config.ts → auxx_test) for the
// one hand-written half of migration 107: the §3.2 rename-aside.
//
// These have to hit real SQL. Every claim worth making is about persisted rows —
// "the incumbent kept `entityType: NULL`", "the system def got `orders`, not
// `orders-2`", "the incumbent's fields and records are untouched", "the inbound
// `Orders` inverse was renamed and nothing else was" — and none of them survives
// a mocked database. The registry wiring is pinned separately in
// `107-order.test.ts`, which runs under the default (mocked) config.
//
// Run: pnpm --filter @auxx/lib test:integration

import { type Database, schema } from '@auxx/database'
import { FieldType } from '@auxx/database/enums'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { ORDER_FIELDS } from '../../../resources/registry/resources/order-fields'
import { ENTITY_INSTANCE_COLUMNS } from '../../entity-seeder/constants'
import { shouldCreateField } from '../../entity-seeder/utils'
import { migration107Order } from './107-order'

const db = () => getTestDb() as unknown as Database

/** The ORDER_FIELDS that actually become `CustomField` rows. */
const EXPECTED_ORDER_ATTRS = Object.values(ORDER_FIELDS)
  .filter((f) => shouldCreateField(f, ENTITY_INSTANCE_COLUMNS))
  .map((f) => f.systemAttribute as string)
  .sort()

/**
 * An org that migration 107 can run against end to end. `ensureFieldViews`
 * resolves the org's system user, which `createTestOrganization` does not set.
 */
async function createMigratableOrg() {
  const org = await createTestOrganization()
  const systemUser = await createTestUser({ name: 'System' })
  await db()
    .update(schema.Organization)
    .set({ systemUserId: systemUser.id })
    .where(eq(schema.Organization.id, org.id))
  return org
}

/** A user-created (or template-installed) entity definition — `entityType` stays NULL. */
async function seedCustomDef(
  orgId: string,
  apiSlug: string,
  singular: string,
  plural: string
): Promise<string> {
  const [def] = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId: orgId,
      entityType: null,
      apiSlug,
      singular,
      plural,
      icon: 'shopping-cart',
      color: 'blue',
      isVisible: true,
      updatedAt: new Date(),
    })
    .returning()
  if (!def) throw new Error(`failed to seed custom def ${apiSlug}`)
  return def.id
}

/** A system entity definition, so `ensureCustomFields` runs against it. */
async function seedSystemDef(
  orgId: string,
  entityType: string,
  apiSlug: string,
  singular: string,
  plural: string
): Promise<string> {
  const [def] = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId: orgId,
      entityType,
      apiSlug,
      singular,
      plural,
      icon: 'building-2',
      color: 'blue',
      isVisible: true,
      updatedAt: new Date(),
    })
    .returning()
  if (!def) throw new Error(`failed to seed system def ${entityType}`)
  return def.id
}

/**
 * A custom field on `defId`, optionally an inverse pointing at `pointsAt`.
 *
 * `modelType` matters: `CustomField_name_org_model_entity_key` is unique on
 * `(name, organizationId, modelType, entityDefinitionId) WHERE
 * appInstallationId IS NULL`, so two same-named fields need different defs.
 */
async function seedCustomField(
  orgId: string,
  defId: string,
  name: string,
  pointsAt?: { defId: string; fieldId: string },
  modelType = 'entity'
): Promise<string> {
  const [field] = await db()
    .insert(schema.CustomField)
    .values({
      organizationId: orgId,
      entityDefinitionId: defId,
      modelType,
      name,
      type: pointsAt ? FieldType.RELATIONSHIP : FieldType.TEXT,
      sortOrder: 'a0',
      isCustom: true,
      updatedAt: new Date(),
      options: pointsAt
        ? {
            isCustom: true,
            relationship: {
              isInverse: false,
              relationshipType: 'belongs_to',
              inverseResourceFieldId: `${pointsAt.defId}:${pointsAt.fieldId}`,
            },
          }
        : { isCustom: true },
    })
    .returning()
  if (!field) throw new Error(`failed to seed custom field ${name}`)
  return field.id
}

async function defByType(orgId: string, entityType: string) {
  const [def] = await db()
    .select()
    .from(schema.EntityDefinition)
    .where(
      and(
        eq(schema.EntityDefinition.organizationId, orgId),
        eq(schema.EntityDefinition.entityType, entityType)
      )
    )
  return def
}

async function defById(defId: string) {
  const [def] = await db()
    .select()
    .from(schema.EntityDefinition)
    .where(eq(schema.EntityDefinition.id, defId))
  return def!
}

async function fieldById(fieldId: string) {
  const [field] = await db()
    .select()
    .from(schema.CustomField)
    .where(eq(schema.CustomField.id, fieldId))
  return field!
}

async function fieldsOn(defId: string) {
  return db()
    .select({
      id: schema.CustomField.id,
      name: schema.CustomField.name,
      systemAttribute: schema.CustomField.systemAttribute,
      options: schema.CustomField.options,
    })
    .from(schema.CustomField)
    .where(eq(schema.CustomField.entityDefinitionId, defId))
}

let orgId: string

beforeEach(async () => {
  const org = await createMigratableOrg()
  orgId = org.id
})

describe('migration 107 — fresh org', () => {
  it('creates the order def at `orders` with every ORDER_FIELDS attribute', async () => {
    const result = await migration107Order.up(db(), orgId)

    expect(result.alreadyUpToDate).toBe(false)
    expect(result.entityDefsCreated).toBe(1)

    const def = await defByType(orgId, 'order')
    expect(def).toBeDefined()
    expect(def!.apiSlug).toBe('orders')
    expect(def!.singular).toBe('Order')
    expect(def!.plural).toBe('Orders')
    expect(def!.icon).toBe('shopping-bag')
    expect(def!.color).toBe('amber')
    expect(def!.isVisible).toBe(true)

    const attrs = (await fieldsOn(def!.id)).map((f) => f.systemAttribute as string).sort()
    expect(attrs).toEqual(EXPECTED_ORDER_ATTRS)
  })

  it('links the display field', async () => {
    await migration107Order.up(db(), orgId)

    const def = await defByType(orgId, 'order')
    const number = (await fieldsOn(def!.id)).find((f) => f.systemAttribute === 'order_number')
    expect(def!.primaryDisplayFieldId).toBe(number!.id)
  })

  it('is idempotent — a second up() creates nothing', async () => {
    await migration107Order.up(db(), orgId)
    const second = await migration107Order.up(db(), orgId)

    expect(second).toEqual({
      entityDefsCreated: 0,
      fieldsCreated: 0,
      relationshipsLinked: 0,
      alreadyUpToDate: true,
    })
  })
})

describe('migration 107 — §3.2 rename-aside', () => {
  it('renames a template `orders` def to `custom-orders` and takes `orders` itself', async () => {
    const incumbentId = await seedCustomDef(orgId, 'orders', 'Order', 'Orders')

    await migration107Order.up(db(), orgId)

    const incumbent = await defById(incumbentId)
    expect(incumbent.apiSlug).toBe('custom-orders')
    expect(incumbent.singular).toBe('Custom Order')
    expect(incumbent.plural).toBe('Custom Orders')
    // It stays the user's own custom entity.
    expect(incumbent.entityType).toBeNull()

    const systemDef = await defByType(orgId, 'order')
    expect(systemDef!.apiSlug).toBe('orders')
    expect(systemDef!.id).not.toBe(incumbentId)
  })

  it("leaves the incumbent's fields and records untouched", async () => {
    const incumbentId = await seedCustomDef(orgId, 'orders', 'Order', 'Orders')
    const plainFieldId = await seedCustomField(orgId, incumbentId, 'Order Number')
    const [record] = await db()
      .insert(schema.EntityInstance)
      .values({
        organizationId: orgId,
        entityDefinitionId: incumbentId,
        displayName: '#1001',
        updatedAt: new Date(),
      })
      .returning()

    const fieldBefore = await fieldById(plainFieldId)

    await migration107Order.up(db(), orgId)

    expect(await fieldById(plainFieldId)).toEqual(fieldBefore)

    const [recordAfter] = await db()
      .select()
      .from(schema.EntityInstance)
      .where(eq(schema.EntityInstance.id, record!.id))
    expect(recordAfter).toEqual(record)
    expect(recordAfter!.entityDefinitionId).toBe(incumbentId)
  })

  it('keeps inbound relationships resolving — they are cuid-keyed, not slug-keyed', async () => {
    const incumbentId = await seedCustomDef(orgId, 'orders', 'Order', 'Orders')
    const targetFieldId = await seedCustomField(orgId, incumbentId, 'Shipments')

    const shipmentDefId = await seedCustomDef(orgId, 'shipments', 'Shipment', 'Shipments')
    const inboundId = await seedCustomField(orgId, shipmentDefId, 'Order', {
      defId: incumbentId,
      fieldId: targetFieldId,
    })

    await migration107Order.up(db(), orgId)

    const inbound = await fieldById(inboundId)
    const rel = (inbound.options as { relationship?: { inverseResourceFieldId?: string } })
      ?.relationship
    expect(rel?.inverseResourceFieldId).toBe(`${incumbentId}:${targetFieldId}`)
    // The def kept its id through the rename, so the edge still resolves.
    expect((await defById(incumbentId)).id).toBe(incumbentId)
    // A field named something other than "Orders" is not renamed.
    expect(inbound.name).toBe('Order')
  })

  it('renames only the inbound "Orders" inverses that point at the renamed def', async () => {
    const incumbentId = await seedCustomDef(orgId, 'orders', 'Order', 'Orders')
    const targetFieldId = await seedCustomField(orgId, incumbentId, 'Companies')

    const otherDefId = await seedCustomDef(orgId, 'widgets', 'Widget', 'Widgets')
    const otherTargetId = await seedCustomField(orgId, otherDefId, 'Anything')

    const pointsAtIncumbent = await seedCustomField(orgId, otherDefId, 'Orders', {
      defId: incumbentId,
      fieldId: targetFieldId,
    })
    const pointsElsewhere = await seedCustomField(orgId, incumbentId, 'Orders', {
      defId: otherDefId,
      fieldId: otherTargetId,
    })
    const plainDefId = await seedCustomDef(orgId, 'gizmos', 'Gizmo', 'Gizmos')
    const notARelationship = await seedCustomField(orgId, plainDefId, 'Orders')

    await migration107Order.up(db(), orgId)

    expect((await fieldById(pointsAtIncumbent)).name).toBe('Custom Orders')
    expect((await fieldById(pointsElsewhere)).name).toBe('Orders')
    expect((await fieldById(notARelationship)).name).toBe('Orders')
  })

  // 08 §3.6 calls the `companies.Orders` rename "cosmetic". It is not — it is
  // load-bearing. `CustomField_name_org_model_entity_key` is unique on
  // `(name, organizationId, modelType, entityDefinitionId)` for every row with
  // `appInstallationId IS NULL`, and a template-installed "Orders" inverse on
  // the company def is exactly such a row. Without the rename,
  // `ensureCustomFields` inserting `company_orders` (also named "Orders", also
  // `modelType: 'company'`, same def) violates it and the migration THROWS.
  //
  // (The Shopify connector's `contacts.Orders` is app-owned, so it carries an
  // `appInstallationId` and sits outside that partial index — which is why THAT
  // half really is cosmetic, exactly as §3.6 says.)
  it('the companies rename is what lets `company_orders` be created at all', async () => {
    const incumbentId = await seedCustomDef(orgId, 'orders', 'Order', 'Orders')
    const targetFieldId = await seedCustomField(orgId, incumbentId, 'Company')

    const companyDefId = await seedSystemDef(orgId, 'company', 'companies', 'Company', 'Companies')
    const templateInverseId = await seedCustomField(
      orgId,
      companyDefId,
      'Orders',
      { defId: incumbentId, fieldId: targetFieldId },
      'company'
    )

    await migration107Order.up(db(), orgId)

    expect((await fieldById(templateInverseId)).name).toBe('Custom Orders')

    const companyFields = await fieldsOn(companyDefId)
    const systemOrders = companyFields.find((f) => f.systemAttribute === 'company_orders')
    expect(systemOrders).toBeDefined()
    expect(systemOrders!.name).toBe('Orders')
    expect(companyFields.filter((f) => f.name === 'Orders')).toHaveLength(1)
  })

  it('never lands on an occupied slug — falls through to custom-orders-2', async () => {
    await seedCustomDef(orgId, 'custom-orders', 'Custom Order', 'Custom Orders')
    const incumbentId = await seedCustomDef(orgId, 'orders', 'Order', 'Orders')

    await migration107Order.up(db(), orgId)

    expect((await defById(incumbentId)).apiSlug).toBe('custom-orders-2')
    expect((await defByType(orgId, 'order'))!.apiSlug).toBe('orders')
  })

  it('matches on apiSlug only — a def named "Order" at another slug is untouched', async () => {
    const decoyId = await seedCustomDef(orgId, 'sales-orders', 'Order', 'Orders')

    await migration107Order.up(db(), orgId)

    const decoy = await defById(decoyId)
    expect(decoy.apiSlug).toBe('sales-orders')
    expect(decoy.singular).toBe('Order')
    expect(decoy.plural).toBe('Orders')
    expect(decoy.entityType).toBeNull()
    expect((await defByType(orgId, 'order'))!.apiSlug).toBe('orders')
  })

  it('is idempotent with an incumbent present — the second up() renames nothing', async () => {
    const incumbentId = await seedCustomDef(orgId, 'orders', 'Order', 'Orders')

    await migration107Order.up(db(), orgId)
    const afterFirst = await defById(incumbentId)

    const second = await migration107Order.up(db(), orgId)

    expect(second.alreadyUpToDate).toBe(true)
    expect(await defById(incumbentId)).toEqual(afterFirst)
  })
})
