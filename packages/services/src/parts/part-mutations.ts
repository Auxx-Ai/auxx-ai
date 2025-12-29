// packages/services/src/parts/part-mutations.ts

import { database, schema, type Transaction } from '@auxx/database'
import { eq, and } from 'drizzle-orm'
import { ok, err } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type {
  PartContext,
  CreatePartInput,
  CreateInventoryInput,
  UpdatePartInput,
  UpdateInventoryInput,
} from './types'

/**
 * Insert a new part record
 */
export async function insertPart(input: CreatePartInput) {
  const {
    organizationId,
    title,
    sku,
    description,
    hsCode,
    category,
    shopifyProductLinkId,
    createdById,
  } = input

  const result = await fromDatabase(
    database
      .insert(schema.Part)
      .values({
        organizationId,
        createdById,
        title,
        description,
        sku,
        hsCode,
        category,
        shopifyProductLinkId,
        updatedAt: new Date(),
      })
      .returning(),
    'insert-part'
  )

  if (result.isErr()) return result
  return ok(result.value[0])
}

/**
 * Insert a new part record within a transaction
 */
export async function insertPartTx(tx: Transaction, input: CreatePartInput) {
  const {
    organizationId,
    title,
    sku,
    description,
    hsCode,
    category,
    shopifyProductLinkId,
    createdById,
  } = input

  const [part] = await tx
    .insert(schema.Part)
    .values({
      organizationId,
      createdById,
      title,
      description,
      sku,
      hsCode,
      category,
      shopifyProductLinkId,
      updatedAt: new Date(),
    })
    .returning()

  return part
}

/**
 * Insert a new inventory record
 */
export async function insertInventory(input: CreateInventoryInput) {
  const { organizationId, partId, quantity, location, reorderPoint, reorderQty } = input

  const result = await fromDatabase(
    database
      .insert(schema.Inventory)
      .values({
        organizationId,
        partId,
        quantity: quantity || 0,
        location,
        reorderPoint,
        reorderQty,
        updatedAt: new Date(),
      })
      .returning(),
    'insert-inventory'
  )

  if (result.isErr()) return result
  return ok(result.value[0])
}

/**
 * Insert a new inventory record within a transaction
 */
export async function insertInventoryTx(tx: Transaction, input: CreateInventoryInput) {
  const { organizationId, partId, quantity, location, reorderPoint, reorderQty } = input

  const [inventory] = await tx
    .insert(schema.Inventory)
    .values({
      organizationId,
      partId,
      quantity: quantity || 0,
      location,
      reorderPoint,
      reorderQty,
      updatedAt: new Date(),
    })
    .returning()

  return inventory
}

/**
 * Update a part record
 */
export async function updatePart(input: UpdatePartInput) {
  const { id, organizationId, ...data } = input

  const existsResult = await fromDatabase(
    database
      .select({ id: schema.Part.id })
      .from(schema.Part)
      .where(and(eq(schema.Part.id, id), eq(schema.Part.organizationId, organizationId)))
      .limit(1),
    'check-part-exists'
  )

  if (existsResult.isErr()) return existsResult
  if (existsResult.value.length === 0) {
    return err({
      code: 'PART_NOT_FOUND' as const,
      message: `Part ${id} not found`,
      partId: id,
    })
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() }
  if (data.title !== undefined) updateData.title = data.title
  if (data.sku !== undefined) updateData.sku = data.sku
  if (data.description !== undefined) updateData.description = data.description
  if (data.hsCode !== undefined) updateData.hsCode = data.hsCode
  if (data.category !== undefined) updateData.category = data.category
  if (data.shopifyProductLinkId !== undefined)
    updateData.shopifyProductLinkId = data.shopifyProductLinkId

  const result = await fromDatabase(
    database
      .update(schema.Part)
      .set(updateData)
      .where(and(eq(schema.Part.id, id), eq(schema.Part.organizationId, organizationId)))
      .returning(),
    'update-part'
  )

  if (result.isErr()) return result
  return ok(result.value[0])
}

/**
 * Update a part record within a transaction
 */
export async function updatePartTx(tx: Transaction, input: UpdatePartInput) {
  const { id, organizationId, ...data } = input

  const updateData: Record<string, unknown> = { updatedAt: new Date() }
  if (data.title !== undefined) updateData.title = data.title
  if (data.sku !== undefined) updateData.sku = data.sku
  if (data.description !== undefined) updateData.description = data.description
  if (data.hsCode !== undefined) updateData.hsCode = data.hsCode
  if (data.category !== undefined) updateData.category = data.category
  if (data.shopifyProductLinkId !== undefined)
    updateData.shopifyProductLinkId = data.shopifyProductLinkId

  const [part] = await tx
    .update(schema.Part)
    .set(updateData)
    .where(and(eq(schema.Part.id, id), eq(schema.Part.organizationId, organizationId)))
    .returning()

  return part
}

/**
 * Update inventory record
 */
export async function updateInventory(input: UpdateInventoryInput) {
  const { partId, organizationId, ...data } = input

  const updateData: Record<string, unknown> = { updatedAt: new Date() }
  if (data.quantity !== undefined) updateData.quantity = data.quantity
  if (data.location !== undefined) updateData.location = data.location
  if (data.reorderPoint !== undefined) updateData.reorderPoint = data.reorderPoint
  if (data.reorderQty !== undefined) updateData.reorderQty = data.reorderQty

  const result = await fromDatabase(
    database
      .update(schema.Inventory)
      .set(updateData)
      .where(
        and(
          eq(schema.Inventory.partId, partId),
          eq(schema.Inventory.organizationId, organizationId)
        )
      )
      .returning(),
    'update-inventory'
  )

  if (result.isErr()) return result
  return ok(result.value[0])
}

/**
 * Update inventory record within a transaction
 */
export async function updateInventoryTx(tx: Transaction, input: UpdateInventoryInput) {
  const { partId, organizationId, ...data } = input

  const updateData: Record<string, unknown> = { updatedAt: new Date() }
  if (data.quantity !== undefined) updateData.quantity = data.quantity
  if (data.location !== undefined) updateData.location = data.location
  if (data.reorderPoint !== undefined) updateData.reorderPoint = data.reorderPoint
  if (data.reorderQty !== undefined) updateData.reorderQty = data.reorderQty

  const [inventory] = await tx
    .update(schema.Inventory)
    .set(updateData)
    .where(
      and(
        eq(schema.Inventory.partId, partId),
        eq(schema.Inventory.organizationId, organizationId)
      )
    )
    .returning()

  return inventory
}

/**
 * Delete a part record
 */
export async function deletePart(partId: string, organizationId: string) {
  const result = await fromDatabase(
    database
      .delete(schema.Part)
      .where(and(eq(schema.Part.id, partId), eq(schema.Part.organizationId, organizationId)))
      .returning({ id: schema.Part.id }),
    'delete-part'
  )

  if (result.isErr()) return result
  if (result.value.length === 0) {
    return err({
      code: 'PART_NOT_FOUND' as const,
      message: `Part ${partId} not found`,
      partId,
    })
  }

  return ok(result.value[0])
}

/**
 * Delete inventory for a part
 */
export async function deleteInventory(partId: string) {
  return fromDatabase(
    database.delete(schema.Inventory).where(eq(schema.Inventory.partId, partId)),
    'delete-inventory'
  )
}

/**
 * Get part with inventory for update operations
 */
export async function getPartWithInventory(input: { partId: string } & PartContext) {
  const { partId, organizationId } = input

  const result = await fromDatabase(
    database.query.Part.findFirst({
      where: (part, { and, eq }) =>
        and(eq(part.id, partId), eq(part.organizationId, organizationId)),
      with: {
        inventory: true,
      },
    }),
    'get-part-with-inventory'
  )

  if (result.isErr()) return result

  if (!result.value) {
    return err({
      code: 'PART_NOT_FOUND' as const,
      message: `Part ${partId} not found`,
      partId,
    })
  }

  return ok(result.value)
}
