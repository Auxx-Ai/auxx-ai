// packages/lib/src/contacts/sync-contact.ts
import { type Database, schema } from '@auxx/database'
import type { CustomerSourceType } from '@auxx/database/types'
import { eq } from 'drizzle-orm'
import { UnifiedCrudHandler } from '../resources/crud/unified-handler'

/** Inferred type for EntityInstance select */
type EntityInstanceEntity = typeof schema.EntityInstance.$inferSelect

/** Data required to map an external customer to a contact. */
type ContactData = {
  email: string
  firstName?: string
  lastName?: string
  phone?: string
  source: CustomerSourceType
  sourceId: string
  sourceData?: any
  organizationId: string
}

/**
 * Syncs a customer from an external source to the contact system.
 * Uses UnifiedCrudHandler to find or create contacts via EntityInstance + FieldValue.
 */
async function syncContactFromSource(
  db: Database,
  contactData: ContactData
): Promise<EntityInstanceEntity> {
  const { email, firstName, lastName, phone, organizationId } = contactData

  // Use UnifiedCrudHandler for find-or-create
  // TODO: Pass a proper userId when available (using 'system' as placeholder)
  const handler = new UnifiedCrudHandler(organizationId, 'system', db)

  const { instance, created } = await handler.findOrCreate(
    'contact',
    { primary_email: email },
    {
      ...(firstName && { first_name: firstName }),
      ...(lastName && { last_name: lastName }),
      ...(phone && { phone: phone }),
    }
  )

  // If found (not created), update fields that may have changed
  if (!created && (firstName || lastName || phone)) {
    // TODO: Optionally update existing contact fields if they are empty/different
  }

  return instance
}

/** Parameters required to connect Shopify customers to contacts. */
type LinkShopifyCustomerParams = {
  db: Database
  shopifyCustomerId: bigint | number
  email: string
  firstName: string | null
  lastName: string | null
  phone: string | null
  organizationId: string
}

/**
 * Links a Shopify customer to a contact (EntityInstance).
 * If no contact exists with the email, creates one via UnifiedCrudHandler.
 */
export async function linkShopifyCustomer({
  db,
  shopifyCustomerId,
  email,
  firstName,
  lastName,
  phone,
  organizationId,
}: LinkShopifyCustomerParams): Promise<EntityInstanceEntity> {
  const resolvedShopifyId =
    typeof shopifyCustomerId === 'bigint' ? Number(shopifyCustomerId) : shopifyCustomerId

  // Check if already linked via entityInstanceId
  const shopifyCustomer = await db.query.shopify_customers.findFirst({
    where: (shopifyCustomers, { eq }) => eq(shopifyCustomers.id, resolvedShopifyId),
  })

  if (!shopifyCustomer) {
    throw new Error(`Shopify customer ${resolvedShopifyId} not found`)
  }

  // If already linked to an EntityInstance, fetch and return it
  if (shopifyCustomer.entityInstanceId) {
    const existing = await db.query.EntityInstance.findFirst({
      where: (ei, { eq }) => eq(ei.id, shopifyCustomer.entityInstanceId!),
    })
    if (existing) return existing
  }

  // Find or create contact via UnifiedCrudHandler
  const contact = await syncContactFromSource(db, {
    email,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    phone: phone || undefined,
    source: 'SHOPIFY',
    sourceId: shopifyCustomerId.toString(),
    organizationId,
  })

  // Link Shopify customer to the EntityInstance
  await db
    .update(schema.shopify_customers)
    .set({ entityInstanceId: contact.id, updatedAt: new Date() })
    .where(eq(schema.shopify_customers.id, resolvedShopifyId))

  return contact
}
