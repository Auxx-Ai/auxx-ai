// packages/services/src/contacts/contact-queries.ts

import { database } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { ContactContext } from './types'

/**
 * Get contact (EntityInstance) by ID
 */
export async function getContactById(input: { contactId: string } & ContactContext) {
  const { contactId, organizationId } = input

  const result = await fromDatabase(
    database.query.EntityInstance.findFirst({
      where: (instances, { eq, and }) =>
        and(eq(instances.id, contactId), eq(instances.organizationId, organizationId)),
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
 * Get contacts (EntityInstance) by IDs
 */
export async function getContactsByIds(input: { contactIds: string[] } & ContactContext) {
  const { contactIds, organizationId } = input

  if (contactIds.length === 0) return ok([])

  const result = await fromDatabase(
    database.query.EntityInstance.findMany({
      where: (instances, { inArray, eq, and }) =>
        and(inArray(instances.id, contactIds), eq(instances.organizationId, organizationId)),
    }),
    'get-contacts-by-ids'
  )

  return result
}
