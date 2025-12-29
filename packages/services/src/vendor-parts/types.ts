// packages/services/src/vendor-parts/types.ts

/**
 * Base context for all vendor part operations
 */
export interface VendorPartContext {
  organizationId: string
}

/**
 * Input for creating a vendor part
 */
export interface CreateVendorPartInput extends VendorPartContext {
  contactId: string
  partId: string
  vendorSku: string
  unitPrice?: number | null
  leadTime?: number | null
  minOrderQty?: number | null
  isPreferred?: boolean
}

/**
 * Input for updating a vendor part
 */
export interface UpdateVendorPartInput extends VendorPartContext {
  id: string
  vendorSku?: string
  unitPrice?: number | null
  leadTime?: number | null
  minOrderQty?: number | null
  isPreferred?: boolean
}

/**
 * Query options for listing vendor parts
 */
export interface ListVendorPartsInput extends VendorPartContext {
  contactId?: string
  partId?: string
}
