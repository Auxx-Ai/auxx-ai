// packages/services/src/parts/errors.ts

/**
 * Part not found error
 */
export type PartNotFoundError = {
  code: 'PART_NOT_FOUND'
  message: string
  partId: string
}

/**
 * SKU already exists error
 */
export type SkuAlreadyExistsError = {
  code: 'SKU_ALREADY_EXISTS'
  message: string
  sku: string
}

/**
 * All part-specific errors
 */
export type PartError = PartNotFoundError | SkuAlreadyExistsError
