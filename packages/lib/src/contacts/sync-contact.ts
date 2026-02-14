// packages/lib/src/contacts/sync-contact.ts
import { type Database, schema, type Transaction } from '@auxx/database'
import type { ContactEntity as Contact } from '@auxx/database/models'
import type { CustomerSourceType } from '@auxx/database/types'
import { and, eq, ne, or, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

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
 * Syncs a customer from an external source to the contact customer system.
 * If a contact customer with this email exists, it links the source to that customer.
 * Otherwise, it creates a new contact customer and links the source.
 */

async function syncContactFromSource(db: Database, contactData: ContactData): Promise<Contact> {
  const { email, firstName, lastName, phone, source, sourceId, sourceData, organizationId } =
    contactData

  // Generate a unique sourceId for manual entries to avoid conflicts
  const finalSourceId = source === 'MANUAL' ? `manual-${uuidv4()}` : sourceId

  // Look for existing contact with this email
  const existingContact = await db.query.Contact.findFirst({
    where: (contact) =>
      and(
        eq(contact.organizationId, organizationId),
        or(eq(contact.email, email), sql`${email} = ANY(${contact.emails})`),
        ne(contact.status, 'MERGED')
      ),
  })

  if (existingContact) {
    // Link this source to the existing contact
    try {
      await db.insert(schema.CustomerSource).values({
        source,
        sourceId: finalSourceId,
        email,
        sourceData: sourceData || {},
        contactId: existingContact.id,
        organizationId,
        updatedAt: new Date(),
      })
    } catch (error) {
      // If there's an error creating the source, just log it and continue
      console.error('Error creating source:', error)
    }

    // Make sure the email is in the contact's emails array
    const currentEmails = existingContact.emails || []
    if (!currentEmails.includes(email)) {
      await db
        .update(schema.Contact)
        .set({ emails: [...currentEmails, email], updatedAt: new Date() })
        .where(eq(schema.Contact.id, existingContact.id))
    }
    const refreshedContact = await db.query.Contact.findFirst({
      where: (contact, { eq }) => eq(contact.id, existingContact.id),
    })

    return refreshedContact ?? existingContact
  }

  // Create new contact with this source
  return await db.transaction(async (tx: Transaction) => {
    const [contact] = await tx
      .insert(schema.Contact)
      .values({
        organizationId,
        email,
        emails: [email],
        firstName: firstName || null,
        lastName: lastName || null,
        phone: phone || null,
        updatedAt: new Date(),
      })
      .returning({ id: schema.Contact.id })

    await tx.insert(schema.CustomerSource).values({
      source,
      sourceId: finalSourceId,
      email,
      sourceData: sourceData || {},
      contactId: contact!.id,
      organizationId,
      updatedAt: new Date(),
    })

    const createdContact = await tx.query.Contact.findFirst({
      where: (contactTable, { eq }) => eq(contactTable.id, contact!.id),
    })

    if (!createdContact) {
      throw new Error('Contact creation failed')
    }

    return createdContact
  })
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
 * Links a Shopify customer to a contact customer.
 * If no contact customer exists with the email, creates one.
 */
export async function linkShopifyCustomer({
  db,
  shopifyCustomerId,
  email,
  firstName,
  lastName,
  phone,
  organizationId,
}: LinkShopifyCustomerParams): Promise<Contact> {
  // Check if already linked
  const resolvedShopifyId =
    typeof shopifyCustomerId === 'bigint' ? Number(shopifyCustomerId) : shopifyCustomerId

  const shopifyCustomer = await db.query.shopify_customers.findFirst({
    where: (shopifyCustomers, { eq }) => eq(shopifyCustomers.id, resolvedShopifyId),
    with: {
      contact: true,
    },
  })

  if (!shopifyCustomer) {
    throw new Error(`Shopify customer ${resolvedShopifyId} not found`)
  }

  if (shopifyCustomer?.contactId && shopifyCustomer.contact) {
    return shopifyCustomer.contact
  }

  // Find or create contact customer
  const contact = await syncContactFromSource(db, {
    email,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    phone: phone || undefined,
    source: 'SHOPIFY',
    sourceId: shopifyCustomerId.toString(),
    organizationId,
  })

  // Link Shopify customer to contact customer
  await db
    .update(schema.shopify_customers)
    .set({ contactId: contact.id, updatedAt: new Date() })
    .where(eq(schema.shopify_customers.id, resolvedShopifyId))

  return contact
}
