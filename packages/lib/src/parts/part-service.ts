// packages/lib/src/parts/part-service.ts

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import * as partDb from '@auxx/services/parts'
import { insertVendorPartTx } from '@auxx/services/vendor-parts'
import { recalculateAffectedParts, recalculateAllPartCosts } from '../bom'

const logger = createScopedLogger('part-service')

/**
 * Inventory data for part creation/update
 */
export interface InventoryInput {
  quantity: number
  location?: string
  reorderPoint?: number
  reorderQty?: number
}

/**
 * Vendor part data for part creation
 */
export interface VendorPartInput {
  contactId: string
  vendorSku: string
  unitPrice?: number | null
  leadTime?: number | null
  minOrderQty?: number | null
  isPreferred?: boolean
}

/**
 * Part with inventory result type
 */
export type PartWithInventory = {
  id: string
  organizationId: string
  title: string
  sku: string
  description: string | null
  hsCode: string | null
  category: string | null
  shopifyProductLinkId: string | null
  createdById: string
  createdAt: Date
  updatedAt: Date
  inventory: {
    id: string
    partId: string
    quantity: number
    location: string | null
    reorderPoint: number | null
    reorderQty: number | null
  } | null
}

/**
 * Input type for creating a part
 */
export interface CreatePartInput {
  title: string
  sku: string
  description?: string
  hsCode?: string
  category?: string
  shopifyProductLinkId?: string
  inventory?: InventoryInput
  vendorPart?: VendorPartInput
}

/**
 * Input type for updating a part
 */
export interface UpdatePartInput {
  id: string
  title: string
  sku: string
  description?: string
  hsCode?: string
  category?: string
  shopifyProductLinkId?: string
  inventory?: InventoryInput
}

/**
 * Input type for getting all parts
 */
export interface GetAllPartsInput {
  cursor?: string
  sortOrder?: 'asc' | 'desc'
  orderBy?: 'createdAt' | 'updatedAt'
  searchParams?: {
    category?: string
    query?: string
  }
}

/**
 * Paginated parts result
 */
export interface PaginatedPartsResult {
  parts: PartWithInventory[]
  nextCursor: string | null
}

/**
 * PartService orchestrates part operations, handling business logic
 */
export class PartService {
  private readonly organizationId: string
  private readonly userId: string

  constructor(organizationId: string, userId: string) {
    this.organizationId = organizationId
    this.userId = userId
  }

  /**
   * Create a new part with optional inventory and vendor part
   */
  async createPart(input: CreatePartInput): Promise<PartWithInventory> {
    const {
      title,
      sku,
      description,
      hsCode,
      category,
      shopifyProductLinkId,
      inventory,
      vendorPart,
    } = input

    // Check SKU uniqueness
    const skuExistsResult = await partDb.checkSkuExists({
      organizationId: this.organizationId,
      sku,
    })

    if (skuExistsResult.isErr()) {
      logger.error('Failed to check SKU existence', {
        sku,
        organizationId: this.organizationId,
        error: skuExistsResult.error.message,
      })
      throw new Error(`Database error checking SKU: ${skuExistsResult.error.message}`)
    }

    if (skuExistsResult.value) {
      throw new Error('A part with this SKU already exists')
    }

    // Create part, inventory, and vendor part in transaction
    const result = await database.transaction(async (tx) => {
      const createdPart = await partDb.insertPartTx(tx, {
        organizationId: this.organizationId,
        createdById: this.userId,
        title,
        sku,
        description,
        hsCode,
        category,
        shopifyProductLinkId,
      })

      let createdInventory = null
      if (inventory && createdPart) {
        createdInventory = await partDb.insertInventoryTx(tx, {
          organizationId: this.organizationId,
          partId: createdPart.id,
          quantity: inventory.quantity || 0,
          location: inventory.location,
          reorderPoint: inventory.reorderPoint,
          reorderQty: inventory.reorderQty,
        })
      }

      let createdVendorPart = null
      if (vendorPart && createdPart) {
        createdVendorPart = await insertVendorPartTx(tx, {
          organizationId: this.organizationId,
          partId: createdPart.id,
          contactId: vendorPart.contactId,
          vendorSku: vendorPart.vendorSku,
          unitPrice: vendorPart.unitPrice ?? null,
          leadTime: vendorPart.leadTime ?? null,
          minOrderQty: vendorPart.minOrderQty ?? null,
          isPreferred: vendorPart.isPreferred ?? false,
        })
      }

      return { part: createdPart, inventory: createdInventory, vendorPart: createdVendorPart }
    })

    if (!result.part) {
      throw new Error('Unable to create part')
    }

    // Recalculate cost if vendor part was created
    if (result.vendorPart) {
      await recalculateAffectedParts(this.organizationId, [result.part.id])
    }

    logger.info('Created part', {
      partId: result.part.id,
      sku,
      organizationId: this.organizationId,
      hasVendorPart: !!result.vendorPart,
    })

    return { ...result.part, inventory: result.inventory } as PartWithInventory
  }

  /**
   * Get all parts with pagination
   */
  async getAllParts(input: GetAllPartsInput = {}): Promise<PaginatedPartsResult> {
    const result = await partDb.getAllParts({
      organizationId: this.organizationId,
      cursor: input.cursor,
      limit: 100,
      sortOrder: input.sortOrder || 'desc',
      orderBy: input.orderBy || 'createdAt',
      searchParams: input.searchParams,
    })

    if (result.isErr()) {
      logger.error('Failed to get all parts', {
        organizationId: this.organizationId,
        error: result.error.message,
      })
      throw new Error(`Database error fetching parts: ${result.error.message}`)
    }

    return result.value as PaginatedPartsResult
  }

  /**
   * Get single part by ID with all relations
   */
  async getPartById(partId: string) {
    const result = await partDb.getPartById({
      partId,
      organizationId: this.organizationId,
    })

    if (result.isErr()) {
      if (result.error.code === 'PART_NOT_FOUND') {
        throw new Error(`Part ${partId} not found`)
      }
      logger.error('Failed to get part by ID', {
        partId,
        organizationId: this.organizationId,
        error: result.error.message,
      })
      throw new Error(`Database error fetching part: ${result.error.message}`)
    }

    // Get attachments
    const attachmentsResult = await partDb.getPartAttachments(partId)
    if (attachmentsResult.isErr()) {
      logger.error('Failed to get part attachments', {
        partId,
        error: attachmentsResult.error.message,
      })
      throw new Error(`Database error fetching attachments: ${attachmentsResult.error.message}`)
    }

    return {
      ...result.value,
      attachments: attachmentsResult.value || [],
    }
  }

  /**
   * Update part with optional inventory
   */
  async updatePart(input: UpdatePartInput): Promise<PartWithInventory> {
    const { id, title, sku, description, hsCode, category, shopifyProductLinkId, inventory } = input

    // Get existing part with inventory
    const existingResult = await partDb.getPartWithInventory({
      partId: id,
      organizationId: this.organizationId,
    })

    if (existingResult.isErr()) {
      if (existingResult.error.code === 'PART_NOT_FOUND') {
        throw new Error(`Part ${id} not found`)
      }
      throw new Error(`Database error fetching part: ${existingResult.error.message}`)
    }

    const existingPart = existingResult.value

    // If SKU is changing, check if the new SKU already exists
    if (sku && sku !== existingPart.sku) {
      const skuExistsResult = await partDb.checkSkuExists({
        organizationId: this.organizationId,
        sku,
        excludeId: id,
      })

      if (skuExistsResult.isErr()) {
        throw new Error(`Database error checking SKU: ${skuExistsResult.error.message}`)
      }

      if (skuExistsResult.value) {
        throw new Error('A part with this SKU already exists')
      }
    }

    // Update part and inventory in transaction
    const result = await database.transaction(async (tx) => {
      const updatedPart = await partDb.updatePartTx(tx, {
        id,
        organizationId: this.organizationId,
        title,
        sku,
        description,
        hsCode,
        category,
        shopifyProductLinkId,
      })

      let updatedInventory = existingPart.inventory

      if (inventory) {
        if (existingPart.inventory && (existingPart.inventory as any).id) {
          // Update existing inventory
          updatedInventory = await partDb.updateInventoryTx(tx, {
            partId: id,
            organizationId: this.organizationId,
            quantity: inventory.quantity,
            location: inventory.location,
            reorderPoint: inventory.reorderPoint,
            reorderQty: inventory.reorderQty,
          })
        } else {
          // Create new inventory
          updatedInventory = await partDb.insertInventoryTx(tx, {
            organizationId: this.organizationId,
            partId: id,
            quantity: inventory.quantity || 0,
            location: inventory.location,
            reorderPoint: inventory.reorderPoint,
            reorderQty: inventory.reorderQty,
          })
        }
      }

      return { part: updatedPart, inventory: updatedInventory }
    })

    logger.info('Updated part', {
      partId: id,
      organizationId: this.organizationId,
    })

    return { ...result.part, inventory: result.inventory } as PartWithInventory
  }

  /**
   * Delete part and related records
   */
  async deletePart(partId: string): Promise<{ success: boolean }> {
    // Get parent parts for cost recalculation
    const parentPartIdsResult = await partDb.getParentPartIds(partId)

    if (parentPartIdsResult.isErr()) {
      throw new Error(`Database error fetching parent parts: ${parentPartIdsResult.error.message}`)
    }

    const parentPartIds = parentPartIdsResult.value

    // Delete inventory first
    const deleteInventoryResult = await partDb.deleteInventory(partId)
    if (deleteInventoryResult.isErr()) {
      logger.error('Failed to delete inventory', {
        partId,
        error: deleteInventoryResult.error.message,
      })
      throw new Error(`Database error deleting inventory: ${deleteInventoryResult.error.message}`)
    }

    // Delete the part
    const deleteResult = await partDb.deletePart(partId, this.organizationId)
    if (deleteResult.isErr()) {
      if (deleteResult.error.code === 'PART_NOT_FOUND') {
        throw new Error(`Part ${partId} not found`)
      }
      throw new Error(`Database error deleting part: ${deleteResult.error.message}`)
    }

    // Recalculate costs for parent parts affected by this deletion
    if (parentPartIds.length > 0) {
      await recalculateAffectedParts(this.organizationId, parentPartIds)
    }

    logger.info('Deleted part', {
      partId,
      organizationId: this.organizationId,
    })

    return { success: true }
  }

  /**
   * Calculate cost for a single part
   */
  async calculateCost(partId: string): Promise<{ id: string; cost: number | null }> {
    await recalculateAffectedParts(this.organizationId, [partId])

    // Get updated part cost
    const result = await partDb.getPartById({
      partId,
      organizationId: this.organizationId,
    })

    if (result.isErr()) {
      throw new Error(`Failed to get updated part: ${result.error.message}`)
    }

    return {
      id: result.value.id,
      cost: result.value.cost,
    }
  }

  /**
   * Calculate costs for all leaf parts
   */
  async calculateAllCosts(): Promise<{ success: boolean; updatedCount: number }> {
    const leafPartsResult = await partDb.getLeafParts(this.organizationId)

    if (leafPartsResult.isErr()) {
      throw new Error(`Database error fetching leaf parts: ${leafPartsResult.error.message}`)
    }

    const leafParts = leafPartsResult.value

    // Recalculate all part costs in a single pass
    await recalculateAllPartCosts(this.organizationId)

    logger.info('Calculated costs for all leaf parts', {
      count: leafParts.length,
      organizationId: this.organizationId,
    })

    return { success: true, updatedCount: leafParts.length }
  }
}
