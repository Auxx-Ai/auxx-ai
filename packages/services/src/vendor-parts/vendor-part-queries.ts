// packages/services/src/vendor-parts/vendor-part-queries.ts

import { database } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { ListVendorPartsInput, VendorPartContext } from './types'

/**
 * Get all vendor parts with optional filtering using relational queries
 */
export async function getVendorParts(input: ListVendorPartsInput) {
  const { organizationId, contactId, partId } = input

  const result = await fromDatabase(
    database.query.VendorPart.findMany({
      where: (vendorParts, { eq, and }) => {
        const conditions = [eq(vendorParts.organizationId, organizationId)]
        if (contactId) conditions.push(eq(vendorParts.contactId, contactId))
        if (partId) conditions.push(eq(vendorParts.partId, partId))
        return and(...conditions)
      },
      with: {
        contact: true,
        part: true,
      },
      orderBy: (vendorParts, { desc, asc }) => [
        desc(vendorParts.isPreferred),
        asc(vendorParts.createdAt),
      ],
    }),
    'get-vendor-parts'
  )

  return result
}

/**
 * Get vendor part by ID with relations
 */
export async function getVendorPartById(input: { id: string } & VendorPartContext) {
  const { id, organizationId } = input

  const result = await fromDatabase(
    database.query.VendorPart.findFirst({
      where: (vendorParts, { eq, and }) =>
        and(eq(vendorParts.id, id), eq(vendorParts.organizationId, organizationId)),
      with: {
        contact: true,
        part: true,
      },
    }),
    'get-vendor-part-by-id'
  )

  if (result.isErr()) return result

  if (!result.value) {
    return err({
      code: 'VENDOR_PART_NOT_FOUND' as const,
      message: `Vendor part ${id} not found`,
      vendorPartId: id,
    })
  }

  return ok(result.value)
}

/**
 * Get vendor part by contact and part ID
 */
export async function getVendorPartByContactAndPart(
  input: { contactId: string; partId: string } & VendorPartContext
) {
  const { contactId, partId, organizationId } = input

  const result = await fromDatabase(
    database.query.VendorPart.findFirst({
      where: (vendorParts, { eq, and }) =>
        and(
          eq(vendorParts.organizationId, organizationId),
          eq(vendorParts.contactId, contactId),
          eq(vendorParts.partId, partId)
        ),
      with: {
        contact: true,
        part: true,
      },
    }),
    'get-vendor-part-by-contact-and-part'
  )

  if (result.isErr()) return result

  if (!result.value) {
    return err({
      code: 'VENDOR_PART_NOT_FOUND' as const,
      message: `Vendor part not found for contact ${contactId} and part ${partId}`,
    })
  }

  return ok(result.value)
}

/**
 * Check if vendor part association exists
 */
export async function checkVendorPartExists(
  input: { contactId: string; partId: string } & VendorPartContext
) {
  const { contactId, partId, organizationId } = input

  const result = await fromDatabase(
    database.query.VendorPart.findFirst({
      where: (vendorParts, { eq, and }) =>
        and(
          eq(vendorParts.organizationId, organizationId),
          eq(vendorParts.contactId, contactId),
          eq(vendorParts.partId, partId)
        ),
      columns: { id: true },
    }),
    'check-vendor-part-exists'
  )

  if (result.isErr()) return result
  return ok(!!result.value)
}
