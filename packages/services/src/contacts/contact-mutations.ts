// packages/services/src/contacts/contact-mutations.ts

import { database, schema, type Transaction } from '@auxx/database'
import type { CustomerStatus } from '@auxx/database/types'
import { eq, and } from 'drizzle-orm'
import { ok, err } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type {
  ContactContext,
  InsertContactInput,
  InsertCustomerSourceInput,
  UpdateContactInput,
} from './types'

/**
 * Insert a new contact record
 */
export async function insertContact(input: InsertContactInput) {
  const { organizationId, email, emails, firstName, lastName, phone, notes, tags } = input

  const result = await fromDatabase(
    database
      .insert(schema.Contact)
      .values({
        organizationId,
        email,
        emails: emails || [email],
        firstName,
        lastName,
        phone,
        notes,
        tags: tags || [],
        updatedAt: new Date(),
      })
      .returning(),
    'insert-contact'
  )

  if (result.isErr()) return result
  return ok(result.value[0])
}

/**
 * Insert a customer source record
 */
export async function insertCustomerSource(input: InsertCustomerSourceInput) {
  const { organizationId, contactId, source, sourceId, email, sourceData } = input

  return fromDatabase(
    database.insert(schema.CustomerSource).values({
      source,
      sourceId,
      email,
      sourceData: sourceData || {},
      contactId,
      organizationId,
      updatedAt: new Date(),
    }),
    'insert-customer-source'
  )
}

/**
 * Update a contact record
 */
export async function updateContact(input: UpdateContactInput) {
  const { id, organizationId, ...data } = input

  const existsResult = await fromDatabase(
    database
      .select({ id: schema.Contact.id })
      .from(schema.Contact)
      .where(and(eq(schema.Contact.id, id), eq(schema.Contact.organizationId, organizationId)))
      .limit(1),
    'check-contact-exists'
  )

  if (existsResult.isErr()) return existsResult
  if (existsResult.value.length === 0) {
    return err({
      code: 'CONTACT_NOT_FOUND' as const,
      message: `Contact ${id} not found`,
      contactId: id,
    })
  }

  const result = await fromDatabase(
    database
      .update(schema.Contact)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.Contact.id, id))
      .returning(),
    'update-contact'
  )

  if (result.isErr()) return result
  return ok(result.value[0])
}

/**
 * Update contact status
 */
export async function updateContactStatus(
  input: { contactId: string; status: CustomerStatus } & ContactContext
) {
  const { contactId, organizationId, status } = input

  const result = await fromDatabase(
    database
      .update(schema.Contact)
      .set({ status, updatedAt: new Date() })
      .where(
        and(eq(schema.Contact.id, contactId), eq(schema.Contact.organizationId, organizationId))
      )
      .returning(),
    'update-contact-status'
  )

  if (result.isErr()) return result
  if (result.value.length === 0) {
    return err({
      code: 'CONTACT_NOT_FOUND' as const,
      message: `Contact ${contactId} not found`,
      contactId,
    })
  }
  return ok(result.value[0])
}

/**
 * Delete contact and related records (within transaction)
 */
export async function deleteContactWithRelations(
  tx: Transaction,
  contactId: string,
  organizationId: string
) {
  await Promise.all([
    tx.delete(schema.CustomerSource).where(eq(schema.CustomerSource.contactId, contactId)),
    tx
      .delete(schema.CustomerGroupMember)
      .where(eq(schema.CustomerGroupMember.contactId, contactId)),
    tx.delete(schema.CustomFieldValue).where(eq(schema.CustomFieldValue.entityId, contactId)),
    // Soft delete associated comments
    tx
      .update(schema.Comment)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.Comment.entityId, contactId),
          eq(schema.Comment.entityDefinitionId, 'contact'),
          eq(schema.Comment.organizationId, organizationId)
        )
      ),
  ])

  const result = await tx
    .delete(schema.Contact)
    .where(
      and(eq(schema.Contact.id, contactId), eq(schema.Contact.organizationId, organizationId))
    )
    .returning({ id: schema.Contact.id })

  return result
}

/**
 * Get contact for deletion verification
 */
export async function getContactForDeletion(input: { contactId: string } & ContactContext) {
  const { contactId, organizationId } = input

  const result = await fromDatabase(
    database
      .select()
      .from(schema.Contact)
      .where(
        and(eq(schema.Contact.id, contactId), eq(schema.Contact.organizationId, organizationId))
      )
      .limit(1),
    'get-contact-for-deletion'
  )

  if (result.isErr()) return result
  if (result.value.length === 0) {
    return err({
      code: 'CONTACT_NOT_FOUND' as const,
      message: `Contact ${contactId} not found`,
      contactId,
    })
  }
  return ok(result.value[0])
}
