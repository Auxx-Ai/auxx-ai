// packages/services/src/vendor-parts/errors.ts

/**
 * Vendor part not found error
 */
export type VendorPartNotFoundError = {
  code: 'VENDOR_PART_NOT_FOUND'
  message: string
  vendorPartId?: string
}

/**
 * Vendor part already exists error
 */
export type VendorPartAlreadyExistsError = {
  code: 'VENDOR_PART_ALREADY_EXISTS'
  message: string
  entityInstanceId: string
  partId: string
}

/**
 * All vendor part errors
 */
export type VendorPartError = VendorPartNotFoundError | VendorPartAlreadyExistsError
