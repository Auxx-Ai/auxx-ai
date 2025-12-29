// packages/services/src/parts/types.ts

/**
 * Base context for all part operations
 */
export interface PartContext {
  organizationId: string
}

/**
 * Input for creating a part
 */
export interface CreatePartInput extends PartContext {
  title: string
  sku: string
  description?: string
  hsCode?: string
  category?: string
  shopifyProductLinkId?: string
  createdById: string
}

/**
 * Input for creating inventory
 */
export interface CreateInventoryInput extends PartContext {
  partId: string
  quantity: number
  location?: string
  reorderPoint?: number
  reorderQty?: number
}

/**
 * Input for updating a part
 */
export interface UpdatePartInput extends PartContext {
  id: string
  title?: string
  sku?: string
  description?: string
  hsCode?: string
  category?: string
  shopifyProductLinkId?: string
}

/**
 * Input for updating inventory
 */
export interface UpdateInventoryInput extends PartContext {
  partId: string
  quantity?: number
  location?: string
  reorderPoint?: number
  reorderQty?: number
}

/**
 * Input for listing parts with pagination
 */
export interface GetAllPartsInput extends PartContext {
  cursor?: string
  limit: number
  sortOrder: 'asc' | 'desc'
  orderBy: 'createdAt' | 'updatedAt'
  searchParams?: {
    category?: string
    query?: string
  }
}

/**
 * Input for checking SKU existence
 */
export interface CheckSkuExistsInput extends PartContext {
  sku: string
  excludeId?: string
}
