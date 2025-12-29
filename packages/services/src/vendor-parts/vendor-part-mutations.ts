// packages/services/src/vendor-parts/vendor-part-mutations.ts

import { database, schema, type Transaction } from '@auxx/database'
import { eq, and, ne } from 'drizzle-orm'
import { ok, err } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { CreateVendorPartInput, UpdateVendorPartInput, VendorPartContext } from './types'

/**
 * Create a vendor part
 */
export async function insertVendorPart(input: CreateVendorPartInput) {
  const { organizationId, contactId, partId, vendorSku, unitPrice, leadTime, minOrderQty, isPreferred } = input

  return fromDatabase(
    database
      .insert(schema.VendorPart)
      .values({
        organizationId,
        contactId,
        partId,
        vendorSku,
        unitPrice,
        leadTime,
        minOrderQty,
        isPreferred: isPreferred ?? false,
        updatedAt: new Date(),
      })
      .returning(),
    'insert-vendor-part'
  ).then((result) => result.map((rows) => rows[0]))
}

/**
 * Create a vendor part within a transaction
 */
export async function insertVendorPartTx(tx: Transaction, input: CreateVendorPartInput) {
  const { organizationId, contactId, partId, vendorSku, unitPrice, leadTime, minOrderQty, isPreferred } = input

  const [vendorPart] = await tx
    .insert(schema.VendorPart)
    .values({
      organizationId,
      contactId,
      partId,
      vendorSku,
      unitPrice,
      leadTime,
      minOrderQty,
      isPreferred: isPreferred ?? false,
      updatedAt: new Date(),
    })
    .returning()

  return vendorPart
}

/**
 * Update a vendor part
 */
export async function updateVendorPart(input: UpdateVendorPartInput) {
  const { id, organizationId, ...data } = input

  const result = await fromDatabase(
    database
      .update(schema.VendorPart)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(schema.VendorPart.id, id), eq(schema.VendorPart.organizationId, organizationId)))
      .returning(),
    'update-vendor-part'
  )

  if (result.isErr()) return result
  if (result.value.length === 0) {
    return err({
      code: 'VENDOR_PART_NOT_FOUND' as const,
      message: `Vendor part ${id} not found`,
      vendorPartId: id,
    })
  }
  return ok(result.value[0])
}

/**
 * Delete a vendor part
 */
export async function deleteVendorPart(input: { id: string } & VendorPartContext) {
  const { id, organizationId } = input

  const result = await fromDatabase(
    database
      .delete(schema.VendorPart)
      .where(and(eq(schema.VendorPart.id, id), eq(schema.VendorPart.organizationId, organizationId)))
      .returning({ id: schema.VendorPart.id }),
    'delete-vendor-part'
  )

  if (result.isErr()) return result
  return ok(result.value.length > 0)
}

/**
 * Clear preferred status for other vendor parts of the same part
 */
export async function clearOtherPreferred(input: { partId: string; excludeId: string } & VendorPartContext) {
  const { partId, excludeId, organizationId } = input

  return fromDatabase(
    database
      .update(schema.VendorPart)
      .set({ isPreferred: false })
      .where(
        and(
          eq(schema.VendorPart.organizationId, organizationId),
          eq(schema.VendorPart.partId, partId),
          ne(schema.VendorPart.id, excludeId),
          eq(schema.VendorPart.isPreferred, true)
        )
      ),
    'clear-other-preferred'
  )
}
