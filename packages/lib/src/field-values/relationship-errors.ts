// packages/lib/src/field-values/relationship-errors.ts

/**
 * Error codes for relationship validation failures
 */
export type RelationshipErrorCode = 'CIRCULAR_REFERENCE' | 'MAX_DEPTH_EXCEEDED' | 'HAS_CHILDREN'

/**
 * Custom error class for relationship validation failures.
 * Includes an error code for programmatic error handling.
 */
export class RelationshipValidationError extends Error {
  constructor(
    message: string,
    public code: RelationshipErrorCode
  ) {
    super(message)
    this.name = 'RelationshipValidationError'
  }
}

/**
 * Create an error for circular reference detection
 */
export function createCircularReferenceError(): RelationshipValidationError {
  return new RelationshipValidationError(
    'This would create a circular reference',
    'CIRCULAR_REFERENCE'
  )
}

/**
 * Create an error for max depth exceeded
 */
export function createMaxDepthError(maxDepth: number): RelationshipValidationError {
  return new RelationshipValidationError(
    `Maximum hierarchy depth of ${maxDepth} exceeded`,
    'MAX_DEPTH_EXCEEDED'
  )
}

/**
 * Create an error for deletion with children
 */
export function createHasChildrenError(): RelationshipValidationError {
  return new RelationshipValidationError(
    'Cannot delete: this item has children',
    'HAS_CHILDREN'
  )
}
