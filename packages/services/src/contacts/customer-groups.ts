// packages/services/src/contacts/customer-groups.ts

import { database, schema } from '@auxx/database'
import { and, asc, count, eq, ilike, inArray } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { ContactContext } from './types'

/**
 * Get all customer groups with member counts
 */
export async function getCustomerGroups(input: { search?: string } & ContactContext) {
  const { organizationId, search } = input

  const conditions = [eq(schema.CustomerGroup.organizationId, organizationId)]
  if (search) conditions.push(ilike(schema.CustomerGroup.name, `%${search}%`))

  const groupsResult = await fromDatabase(
    database
      .select({
        id: schema.CustomerGroup.id,
        name: schema.CustomerGroup.name,
        description: schema.CustomerGroup.description,
        organizationId: schema.CustomerGroup.organizationId,
        createdAt: schema.CustomerGroup.createdAt,
        updatedAt: schema.CustomerGroup.updatedAt,
      })
      .from(schema.CustomerGroup)
      .where(and(...conditions))
      .orderBy(asc(schema.CustomerGroup.name)),
    'get-customer-groups'
  )

  if (groupsResult.isErr()) return groupsResult

  const groups = groupsResult.value
  if (groups.length === 0) return ok([])

  const countsResult = await fromDatabase(
    database
      .select({
        groupId: schema.CustomerGroupMember.customerGroupId,
        count: count(),
      })
      .from(schema.CustomerGroupMember)
      .where(
        inArray(
          schema.CustomerGroupMember.customerGroupId,
          groups.map((g) => g.id)
        )
      )
      .groupBy(schema.CustomerGroupMember.customerGroupId),
    'get-group-counts'
  )

  if (countsResult.isErr()) return countsResult

  const countMap = new Map(countsResult.value.map((c) => [c.groupId, Number(c.count)]))

  return ok(groups.map((g) => ({ ...g, _count: { members: countMap.get(g.id) || 0 } })))
}

/**
 * Get customer group by ID
 */
export async function getCustomerGroupById(input: { groupId: string } & ContactContext) {
  const { groupId, organizationId } = input

  const result = await fromDatabase(
    database
      .select()
      .from(schema.CustomerGroup)
      .where(
        and(
          eq(schema.CustomerGroup.id, groupId),
          eq(schema.CustomerGroup.organizationId, organizationId)
        )
      )
      .limit(1),
    'get-customer-group'
  )

  if (result.isErr()) return result
  if (result.value.length === 0) {
    return err({
      code: 'CUSTOMER_GROUP_NOT_FOUND' as const,
      message: `Group ${groupId} not found`,
      groupId,
    })
  }
  return ok(result.value[0])
}

/**
 * Check if group name exists
 */
export async function checkGroupNameExists(input: { name: string } & ContactContext) {
  const { name, organizationId } = input

  const result = await fromDatabase(
    database
      .select({ id: schema.CustomerGroup.id })
      .from(schema.CustomerGroup)
      .where(
        and(
          eq(schema.CustomerGroup.name, name),
          eq(schema.CustomerGroup.organizationId, organizationId)
        )
      )
      .limit(1),
    'check-group-name'
  )

  if (result.isErr()) return result
  return ok(result.value.length > 0)
}

/**
 * Insert a customer group
 */
export async function insertCustomerGroup(
  input: { name: string; description?: string } & ContactContext
) {
  const { organizationId, name, description } = input

  const result = await fromDatabase(
    database
      .insert(schema.CustomerGroup)
      .values({ name, description, organizationId, updatedAt: new Date() })
      .returning(),
    'insert-customer-group'
  )

  if (result.isErr()) return result
  return ok(result.value[0])
}

/**
 * Update a customer group
 */
export async function updateCustomerGroup(
  input: { groupId: string; name?: string; description?: string } & ContactContext
) {
  const { groupId, organizationId, name, description } = input

  const result = await fromDatabase(
    database
      .update(schema.CustomerGroup)
      .set({ name, description, updatedAt: new Date() })
      .where(
        and(
          eq(schema.CustomerGroup.id, groupId),
          eq(schema.CustomerGroup.organizationId, organizationId)
        )
      )
      .returning(),
    'update-customer-group'
  )

  if (result.isErr()) return result
  if (result.value.length === 0) {
    return err({
      code: 'CUSTOMER_GROUP_NOT_FOUND' as const,
      message: `Group ${groupId} not found`,
      groupId,
    })
  }
  return ok(result.value[0])
}

/**
 * Delete a customer group
 */
export async function deleteCustomerGroup(input: { groupId: string } & ContactContext) {
  const { groupId, organizationId } = input

  const result = await fromDatabase(
    database
      .delete(schema.CustomerGroup)
      .where(
        and(
          eq(schema.CustomerGroup.id, groupId),
          eq(schema.CustomerGroup.organizationId, organizationId)
        )
      )
      .returning({ id: schema.CustomerGroup.id }),
    'delete-customer-group'
  )

  if (result.isErr()) return result
  return ok(result.value.length > 0)
}

/**
 * Add contacts to a group
 */
export async function addContactsToGroup(
  input: { groupId: string; contactIds: string[] } & ContactContext
) {
  const { groupId, contactIds } = input

  const result = await fromDatabase(
    database
      .insert(schema.CustomerGroupMember)
      .values(
        contactIds.map((contactId) => ({
          customerGroupId: groupId,
          contactId,
          updatedAt: new Date(),
        }))
      )
      .onConflictDoNothing(),
    'add-contacts-to-group'
  )

  return result.map(() => ({ success: true }))
}

/**
 * Remove contacts from a group
 */
export async function removeContactsFromGroup(
  input: { groupId: string; contactIds: string[] } & ContactContext
) {
  const { groupId, contactIds } = input

  const result = await fromDatabase(
    database
      .delete(schema.CustomerGroupMember)
      .where(
        and(
          eq(schema.CustomerGroupMember.customerGroupId, groupId),
          inArray(schema.CustomerGroupMember.contactId, contactIds)
        )
      ),
    'remove-contacts-from-group'
  )

  return result.map(() => ({ success: true }))
}

/**
 * Get groups for specific contacts
 */
export async function getGroupsForContacts(input: { contactIds: string[] } & ContactContext) {
  const { contactIds, organizationId } = input

  if (contactIds.length === 0) return ok([])

  return fromDatabase(
    database
      .select({
        id: schema.CustomerGroup.id,
        name: schema.CustomerGroup.name,
        description: schema.CustomerGroup.description,
        organizationId: schema.CustomerGroup.organizationId,
        members: {
          contactId: schema.CustomerGroupMember.contactId,
          customerGroupId: schema.CustomerGroupMember.customerGroupId,
        },
      })
      .from(schema.CustomerGroup)
      .leftJoin(
        schema.CustomerGroupMember,
        and(
          eq(schema.CustomerGroup.id, schema.CustomerGroupMember.customerGroupId),
          inArray(schema.CustomerGroupMember.contactId, contactIds)
        )
      )
      .where(eq(schema.CustomerGroup.organizationId, organizationId))
      .orderBy(asc(schema.CustomerGroup.name)),
    'get-groups-for-contacts'
  )
}
