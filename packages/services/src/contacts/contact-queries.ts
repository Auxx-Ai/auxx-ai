// packages/services/src/contacts/contact-queries.ts

import { database, schema } from '@auxx/database'
import { and, asc, count, desc, eq, ilike, inArray, or, type SQL, sql } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { ContactContext, GetAllContactsInput, SearchContactsInput } from './types'

/**
 * Search contacts with lightweight results
 */
export async function searchContacts(input: SearchContactsInput) {
  const { organizationId, limit, cursor, search } = input
  const take = limit + 1

  const conditions: SQL[] = [eq(schema.Contact.organizationId, organizationId)]

  if (search) {
    const term = search.trim()
    conditions.push(
      or(
        ilike(schema.Contact.name, `%${term}%`),
        ilike(schema.Contact.firstName, `%${term}%`),
        ilike(schema.Contact.lastName, `%${term}%`),
        ilike(schema.Contact.email, `%${term}%`),
        ilike(schema.Contact.phone, `%${term}%`)
      )!
    )
  }

  if (cursor) {
    const [timestamp, id] = cursor.split('|')
    if (timestamp && id) {
      conditions.push(
        or(
          sql`${schema.Contact.updatedAt} < ${timestamp}`,
          and(sql`${schema.Contact.updatedAt} = ${timestamp}`, sql`${schema.Contact.id} < ${id}`)
        )!
      )
    }
  }

  const result = await fromDatabase(
    database
      .select({
        id: schema.Contact.id,
        firstName: schema.Contact.firstName,
        lastName: schema.Contact.lastName,
        email: schema.Contact.email,
        phone: schema.Contact.phone,
        status: schema.Contact.status,
        updatedAt: schema.Contact.updatedAt,
      })
      .from(schema.Contact)
      .where(and(...conditions))
      .orderBy(desc(schema.Contact.updatedAt))
      .limit(take),
    'search-contacts'
  )

  if (result.isErr()) return result

  const items = result.value
  let nextCursor: string | undefined

  if (items.length > limit) {
    const next = items.pop()
    nextCursor = next ? `${next.updatedAt.toISOString()}|${next.id}` : undefined
  }

  return ok({ items, nextCursor })
}

/**
 * Valid sortable fields for contacts
 */
const SORTABLE_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'status',
  'createdAt',
  'updatedAt',
] as const
type SortableField = (typeof SORTABLE_FIELDS)[number]

/**
 * Get all contacts with full relations
 */
export async function getAllContacts(input: GetAllContactsInput) {
  const { organizationId, limit, cursor, search, status, sortField, sortDirection = 'desc' } = input

  // Validate and normalize sort field
  const validSortField: SortableField = SORTABLE_FIELDS.includes(sortField as SortableField)
    ? (sortField as SortableField)
    : 'updatedAt'

  const result = await fromDatabase(
    database.query.Contact.findMany({
      where: (contacts, { eq, and, or, ilike, sql }) => {
        const conditions = [eq(contacts.organizationId, organizationId)]

        if (status) conditions.push(eq(contacts.status, status))

        if (search) {
          conditions.push(
            or(
              ilike(contacts.email, `%${search}%`),
              sql`${search} = ANY(${contacts.emails})`,
              ilike(contacts.name, `%${search}%`),
              ilike(contacts.firstName, `%${search}%`),
              ilike(contacts.lastName, `%${search}%`),
              ilike(contacts.phone, `%${search}%`)
            )!
          )
        }

        if (cursor) {
          const [timestamp, id] = cursor.split('|')
          if (timestamp && id) {
            conditions.push(
              or(
                sql`${contacts.updatedAt} < ${timestamp}`,
                and(sql`${contacts.updatedAt} = ${timestamp}`, sql`${contacts.id} < ${id}`)
              )!
            )
          }
        }

        return and(...conditions)
      },
      with: {
        shopifyCustomers: true,
        customerSources: {
          columns: { id: true, source: true, email: true, sourceId: true },
        },
        customerGroups: { with: { customerGroup: true } },
      },
      orderBy: (contacts, { desc, asc }) => {
        const orderFn = sortDirection === 'asc' ? asc : desc
        return [orderFn(contacts[validSortField])]
      },
      limit: limit + 1,
    }),
    'get-all-contacts'
  )

  if (result.isErr()) return result

  const contacts = result.value
  let nextCursor: string | undefined

  if (contacts.length > limit) {
    const next = contacts.pop()
    nextCursor = next ? `${next.updatedAt.toISOString()}|${next.id}` : undefined
  }

  return ok({ items: contacts, nextCursor })
}

/**
 * Get contact by ID with relations
 */
export async function getContactById(input: { contactId: string } & ContactContext) {
  const { contactId, organizationId } = input

  const result = await fromDatabase(
    database.query.Contact.findFirst({
      where: (contacts, { eq, and }) =>
        and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId)),
      with: {
        shopifyCustomers: true,
        customerSources: true,
        customerGroups: { with: { customerGroup: true } },
      },
    }),
    'get-contact-by-id'
  )

  if (result.isErr()) return result

  if (!result.value) {
    return err({
      code: 'CONTACT_NOT_FOUND' as const,
      message: `Contact ${contactId} not found`,
      contactId,
    })
  }

  return ok(result.value)
}

/**
 * Get contacts by IDs with relations
 */
export async function getContactsByIds(input: { contactIds: string[] } & ContactContext) {
  const { contactIds, organizationId } = input

  if (contactIds.length === 0) return ok([])

  const result = await fromDatabase(
    database.query.Contact.findMany({
      where: (contacts, { inArray, eq, and }) =>
        and(inArray(contacts.id, contactIds), eq(contacts.organizationId, organizationId)),
      with: {
        shopifyCustomers: true,
        customerSources: {
          columns: { id: true, source: true, email: true, sourceId: true },
        },
        customerGroups: { with: { customerGroup: true } },
      },
    }),
    'get-contacts-by-ids'
  )

  return result
}

/**
 * Get custom fields for organization
 */
export async function getCustomFieldsForContacts(organizationId: string) {
  return fromDatabase(
    database
      .select()
      .from(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.organizationId, organizationId),
          eq(schema.CustomField.modelType, 'contact'),
          eq(schema.CustomField.active, true)
        )
      )
      .orderBy(asc(schema.CustomField.sortOrder)),
    'get-custom-fields'
  )
}

/**
 * Get custom field values for contacts
 */
export async function getCustomFieldValuesForContacts(contactIds: string[], fieldIds: string[]) {
  if (contactIds.length === 0 || fieldIds.length === 0) return ok([])

  return fromDatabase(
    database
      .select()
      .from(schema.CustomFieldValue)
      .where(
        and(
          inArray(schema.CustomFieldValue.entityId, contactIds),
          inArray(schema.CustomFieldValue.fieldId, fieldIds)
        )
      ),
    'get-custom-field-values'
  )
}

/**
 * Get ticket counts for contacts
 */
export async function getTicketCountsForContacts(contactIds: string[]) {
  if (contactIds.length === 0) return ok(new Map<string, number>())

  const result = await fromDatabase(
    database
      .select({
        contactId: schema.Ticket.contactId,
        count: count(),
      })
      .from(schema.Ticket)
      .where(inArray(schema.Ticket.contactId, contactIds))
      .groupBy(schema.Ticket.contactId),
    'get-ticket-counts'
  )

  if (result.isErr()) return result

  return ok(new Map(result.value.map((tc) => [tc.contactId, Number(tc.count)])))
}

/**
 * Get recent tickets for a contact
 */
export async function getRecentTickets(contactId: string, limit = 5) {
  return fromDatabase(
    database.query.Ticket.findMany({
      where: (tickets, { eq }) => eq(tickets.contactId, contactId),
      orderBy: (tickets, { desc }) => [desc(tickets.createdAt)],
      limit,
    }),
    'get-recent-tickets'
  )
}

/**
 * Find existing contact by email
 */
export async function findContactByEmail(input: { email: string } & ContactContext) {
  const { email, organizationId } = input

  const result = await fromDatabase(
    database
      .select()
      .from(schema.Contact)
      .where(
        and(
          eq(schema.Contact.organizationId, organizationId),
          or(eq(schema.Contact.email, email), sql`${email} = ANY(${schema.Contact.emails})`),
          sql`${schema.Contact.status} != 'MERGED'`
        )
      )
      .limit(1),
    'find-contact-by-email'
  )

  if (result.isErr()) return result
  return ok(result.value[0] ?? null)
}
