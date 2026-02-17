// packages/services/src/vendor-parts/vendor-part-queries.ts

import { database } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { ListVendorPartsInput, VendorPartContext } from './types'

/**
 * Get all vendor parts with optional filtering using relational queries
 */
export async function getVendorParts(input: ListVendorPartsInput) {
  const { organizationId, entityInstanceId, partId } = input

  const result = await fromDatabase(
    database.query.VendorPart.findMany({
      where: (vendorParts, { eq, and }) => {
        const conditions = [eq(vendorParts.organizationId, organizationId)]
        if (entityInstanceId) conditions.push(eq(vendorParts.entityInstanceId, entityInstanceId))
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
 * Get vendor part by entity instance and part ID
 */
export async function getVendorPartByEntityInstanceAndPart(
  input: { entityInstanceId: string; partId: string } & VendorPartContext
) {
  const { entityInstanceId, partId, organizationId } = input

  const result = await fromDatabase(
    database.query.VendorPart.findFirst({
      where: (vendorParts, { eq, and }) =>
        and(
          eq(vendorParts.organizationId, organizationId),
          eq(vendorParts.entityInstanceId, entityInstanceId),
          eq(vendorParts.partId, partId)
        ),
      with: {
        contact: true,
        part: true,
      },
    }),
    'get-vendor-part-by-entity-instance-and-part'
  )

  if (result.isErr()) return result

  if (!result.value) {
    return err({
      code: 'VENDOR_PART_NOT_FOUND' as const,
      message: `Vendor part not found for entity instance ${entityInstanceId} and part ${partId}`,
    })
  }

  return ok(result.value)
}

/**
 * Check if vendor part association exists
 */
export async function checkVendorPartExists(
  input: { entityInstanceId: string; partId: string } & VendorPartContext
) {
  const { entityInstanceId, partId, organizationId } = input

  const result = await fromDatabase(
    database.query.VendorPart.findFirst({
      where: (vendorParts, { eq, and }) =>
        and(
          eq(vendorParts.organizationId, organizationId),
          eq(vendorParts.entityInstanceId, entityInstanceId),
          eq(vendorParts.partId, partId)
        ),
      columns: { id: true },
    }),
    'check-vendor-part-exists'
  )

  if (result.isErr()) return result
  return ok(!!result.value)
}
