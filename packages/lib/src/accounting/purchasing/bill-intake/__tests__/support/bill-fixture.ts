// packages/lib/src/accounting/purchasing/bill-intake/__tests__/support/bill-fixture.ts

// packages/lib/src/accounting/purchasing/bill-intake/__tests__/support/bill-fixture.ts

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { eq } from 'drizzle-orm'
import { getOrgCache } from '../../../../../cache'
import { UnifiedCrudHandler } from '../../../../../resources/crud/unified-handler'
import { PartKind } from '../../../../../resources/registry/enum-values'
import { toRecordId } from '../../../../../resources/resource-id'
import { createEntityDefinitions } from '../../../../../seed/entity-seeder/create-entity-defs'
import { createAllFields } from '../../../../../seed/entity-seeder/create-fields'
import { linkDisplayFields } from '../../../../../seed/entity-seeder/link-display-fields'
import { linkRelationships } from '../../../../../seed/entity-seeder/link-relationships'
import type { EntityDefMap } from '../../../../../seed/entity-seeder/types'

const db = () => getTestDb() as unknown as Database

const BILL_ENTITY_TYPES = [
  'company',
  'part',
  'vendor_part',
  'purchase_order',
  'purchase_order_line',
  'vendor_bill',
  'vendor_bill_line',
] as const

export interface BillFixture {
  organizationId: string
  userId: string
  companyDefId: string
  partDefId: string
  vendorPartDefId: string
  purchaseOrderDefId: string
  purchaseOrderLineDefId: string
  vendorBillDefId: string
  vendorBillLineDefId: string
  vendorId: string
  partId: string
  vendorPartId: string
  purchaseOrderId: string
  purchaseOrderLineId: string
}

/** Seed one real vendor, order and order line for bill-intake integration tests. */
export async function seedBillOrg(): Promise<BillFixture> {
  const organization = await createTestOrganization()
  const user = await createTestUser({ name: 'Bill Operator' })
  await db()
    .update(schema.Organization)
    .set({ systemUserId: user.id })
    .where(eq(schema.Organization.id, organization.id))

  const allDefs = await createEntityDefinitions(db(), organization.id)
  const defs: EntityDefMap = new Map()
  for (const entityType of BILL_ENTITY_TYPES) {
    const definition = allDefs.get(entityType)
    if (!definition) throw new Error(`fixture: no ${entityType} entity definition was seeded`)
    defs.set(entityType, definition)
  }
  const fields = await createAllFields(db(), organization.id, defs)
  await linkRelationships(db(), defs, fields)
  await linkDisplayFields(db(), defs, fields)

  const defId = (entityType: string): string => {
    const definition = defs.get(entityType)
    if (!definition) throw new Error(`fixture: no ${entityType} entity definition was seeded`)
    return definition.id
  }

  const companyDefId = defId('company')
  const partDefId = defId('part')
  const vendorPartDefId = defId('vendor_part')
  const purchaseOrderDefId = defId('purchase_order')
  const purchaseOrderLineDefId = defId('purchase_order_line')
  const vendorBillDefId = defId('vendor_bill')
  const vendorBillLineDefId = defId('vendor_bill_line')
  const crud = new UnifiedCrudHandler(organization.id, user.id, db())

  const vendor = await crud.create(companyDefId, {
    company_name: 'Acme Supplies Ltd',
    company_domain: 'acme.example',
  })
  const part = await crud.create(partDefId, {
    part_title: 'Hex bolt M8x40',
    part_sku: 'AF-4420',
    part_kind: PartKind.COMPONENT,
  })
  const vendorPart = await crud.create(vendorPartDefId, {
    vendor_part_part: toRecordId(partDefId, part.instance.id),
    vendor_part_contact: toRecordId(companyDefId, vendor.instance.id),
    vendor_part_vendor_sku: 'V-AF-4420',
  })
  const purchaseOrder = await crud.create(purchaseOrderDefId, {
    purchase_order_vendor: toRecordId(companyDefId, vendor.instance.id),
    purchase_order_currency: 'USD',
  })
  const purchaseOrderLine = await crud.create(purchaseOrderLineDefId, {
    purchase_order_line_purchase_order: toRecordId(purchaseOrderDefId, purchaseOrder.instance.id),
    purchase_order_line_part: toRecordId(partDefId, part.instance.id),
    purchase_order_line_vendor_part: toRecordId(vendorPartDefId, vendorPart.instance.id),
    purchase_order_line_description: 'Hex bolt M8x40',
    purchase_order_line_quantity_ordered: 10,
    purchase_order_line_quantity_received: 10,
    purchase_order_line_quantity_billed: 0,
    purchase_order_line_expected_unit_price: 420,
    purchase_order_line_sort_order: 0,
  })

  return {
    organizationId: organization.id,
    userId: user.id,
    companyDefId,
    partDefId,
    vendorPartDefId,
    purchaseOrderDefId,
    purchaseOrderLineDefId,
    vendorBillDefId,
    vendorBillLineDefId,
    vendorId: vendor.instance.id,
    partId: part.instance.id,
    vendorPartId: vendorPart.instance.id,
    purchaseOrderId: purchaseOrder.instance.id,
    purchaseOrderLineId: purchaseOrderLine.instance.id,
  }
}

/** Find a seeded field id by its stable system attribute. */
export async function fieldId(fixture: BillFixture, attribute: string): Promise<string> {
  const fields = await getOrgCache()
    .from(fixture.organizationId, 'customFields')
    .bySystemAttributes([attribute] as never)
  const field = (fields as Record<string, { id: string } | null>)[attribute]
  if (!field) throw new Error(`fixture: no CustomField for ${attribute}`)
  return field.id
}
