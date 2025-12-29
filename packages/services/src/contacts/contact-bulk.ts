// packages/services/src/contacts/contact-bulk.ts

import { database, schema, type Transaction } from '@auxx/database'
import { eq, and, inArray } from 'drizzle-orm'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { ContactContext, MergeContactsInput } from './types'

/**
 * Generic bulk update for contacts.
 * Replaces specific methods like bulkUpdateToSpam.
 *
 * @example
 * // Mark as spam
 * await bulkUpdate({ contactIds: [...], organizationId }, { status: 'SPAM' })
 *
 * // Update multiple fields
 * await bulkUpdate({ contactIds: [...], organizationId }, { status: 'ACTIVE', notes: 'Reviewed' })
 */
export async function bulkUpdate(
  input: { contactIds: string[] } & ContactContext,
  values: Partial<{
    status: string
    notes: string
    firstName: string
    lastName: string
    phone: string
    tags: string[]
  }>
) {
  const { contactIds, organizationId } = input

  if (contactIds.length === 0) {
    return ok({ count: 0, contactIds: [] as string[] })
  }

  // Get valid contacts
  const contactsResult = await fromDatabase(
    database
      .select({ id: schema.Contact.id })
      .from(schema.Contact)
      .where(
        and(
          inArray(schema.Contact.id, contactIds),
          eq(schema.Contact.organizationId, organizationId)
        )
      ),
    'get-contacts-for-bulk-update'
  )

  if (contactsResult.isErr()) return contactsResult
  if (contactsResult.value.length === 0) {
    return ok({ count: 0, contactIds: [] as string[] })
  }

  const validIds = contactsResult.value.map((c) => c.id)

  // Perform update
  const result = await fromDatabase(
    database
      .update(schema.Contact)
      .set({ ...values, updatedAt: new Date() })
      .where(
        and(
          inArray(schema.Contact.id, validIds),
          eq(schema.Contact.organizationId, organizationId)
        )
      )
      .returning({ id: schema.Contact.id }),
    'bulk-update-contacts'
  )

  if (result.isErr()) return result
  return ok({ count: result.value.length, contactIds: result.value.map((c) => c.id) })
}

/**
 * Bulk update contacts to spam status
 * @deprecated Use bulkUpdate({ ... }, { status: 'SPAM' }) instead
 */
export async function bulkUpdateToSpam(input: { contactIds: string[] } & ContactContext) {
  return bulkUpdate(input, { status: 'SPAM' })
}

/**
 * Bulk delete contacts (provides transaction-ready delete)
 */
export async function bulkDeleteContacts(
  tx: Transaction,
  contactIds: string[],
  organizationId: string
) {
  const contacts = await tx
    .select({ id: schema.Contact.id })
    .from(schema.Contact)
    .where(
      and(inArray(schema.Contact.id, contactIds), eq(schema.Contact.organizationId, organizationId))
    )

  if (contacts.length === 0) return []

  const validIds = contacts.map((c) => c.id)

  await Promise.all([
    tx.delete(schema.CustomerSource).where(inArray(schema.CustomerSource.contactId, validIds)),
    tx
      .delete(schema.CustomerGroupMember)
      .where(inArray(schema.CustomerGroupMember.contactId, validIds)),
    tx.delete(schema.CustomFieldValue).where(inArray(schema.CustomFieldValue.entityId, validIds)),
    tx
      .delete(schema.Comment)
      .where(
        and(inArray(schema.Comment.entityId, validIds), eq(schema.Comment.entityType, 'Contact'))
      ),
  ])

  const deleted = await tx
    .delete(schema.Contact)
    .where(
      and(inArray(schema.Contact.id, validIds), eq(schema.Contact.organizationId, organizationId))
    )
    .returning({ id: schema.Contact.id })

  return deleted
}

/**
 * Merge contacts - transfer all data to primary contact
 */
export async function mergeContacts(tx: Transaction, input: MergeContactsInput) {
  const { organizationId, primaryContactId, contactIdsToMerge } = input

  const [primary] = await tx
    .select()
    .from(schema.Contact)
    .where(
      and(eq(schema.Contact.id, primaryContactId), eq(schema.Contact.organizationId, organizationId))
    )
    .limit(1)

  if (!primary) {
    throw new Error(`Primary contact ${primaryContactId} not found`)
  }

  const toMerge = await tx
    .select()
    .from(schema.Contact)
    .where(
      and(
        inArray(schema.Contact.id, contactIdsToMerge),
        eq(schema.Contact.organizationId, organizationId)
      )
    )

  if (toMerge.length !== contactIdsToMerge.length) {
    throw new Error('One or more contacts to merge were not found')
  }

  const allEmails = new Set(primary.emails || [])
  let allTags = [...(primary.tags || [])]

  for (const contact of toMerge) {
    contact.emails?.forEach((e: string) => allEmails.add(e))
    if (contact.tags) allTags = [...allTags, ...contact.tags]

    await tx
      .update(schema.CustomerSource)
      .set({ contactId: primaryContactId, updatedAt: new Date() })
      .where(eq(schema.CustomerSource.contactId, contact.id))

    await tx
      .update(schema.shopify_customers)
      .set({ contactId: primaryContactId, updatedAt: new Date() })
      .where(eq(schema.shopify_customers.contactId, contact.id))

    await tx
      .update(schema.Ticket)
      .set({ contactId: primaryContactId, updatedAt: new Date() })
      .where(eq(schema.Ticket.contactId, contact.id))

    await tx
      .update(schema.CustomerGroupMember)
      .set({ contactId: primaryContactId, updatedAt: new Date() })
      .where(eq(schema.CustomerGroupMember.contactId, contact.id))

    await tx
      .update(schema.Contact)
      .set({
        status: 'MERGED',
        notes: contact.notes
          ? `${contact.notes}\n\nMerged into contact ${primaryContactId}`
          : `Merged into contact ${primaryContactId}`,
        updatedAt: new Date(),
      })
      .where(eq(schema.Contact.id, contact.id))
  }

  const [updated] = await tx
    .update(schema.Contact)
    .set({
      emails: Array.from(allEmails),
      tags: [...new Set(allTags)],
      updatedAt: new Date(),
    })
    .where(eq(schema.Contact.id, primaryContactId))
    .returning()

  return updated
}
