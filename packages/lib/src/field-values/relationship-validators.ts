// packages/lib/src/field-values/relationship-validators.ts

import { type Database, schema } from '@auxx/database'
import { eq, and } from 'drizzle-orm'
import {
  type RelationshipConfig,
  type RelationshipConstraints,
  isSelfReferentialRelationship,
} from '@auxx/types/custom-field'

// ============================================================================
// TYPES
// ============================================================================

/** Context for validation operations */
export interface ValidationContext {
  db: Database
  organizationId: string
}

/** Result of a validation check */
export interface ValidationResult {
  valid: boolean
  error?: string
}

// ============================================================================
// CIRCULAR REFERENCE DETECTION
// ============================================================================

/**
 * Detect circular reference in a self-referential relationship.
 * Traverses up the parent chain to check if we'd create a cycle.
 *
 * @param ctx - Database context
 * @param entityId - The entity being updated
 * @param newParentId - The proposed new parent ID
 * @param parentFieldId - The CustomField ID of the parent relationship field
 * @returns true if setting this parent would create a cycle
 */
export async function hasCircularReference(
  ctx: ValidationContext,
  entityId: string,
  newParentId: string | null,
  parentFieldId: string
): Promise<boolean> {
  if (!newParentId) return false
  if (entityId === newParentId) return true // Self-reference

  const visited = new Set<string>([entityId])
  let currentId: string | null = newParentId

  while (currentId) {
    if (visited.has(currentId)) {
      return true // Circular!
    }
    visited.add(currentId)

    // Get parent of current entity
    const parentValue = await ctx.db.query.FieldValue.findFirst({
      where: and(
        eq(schema.FieldValue.entityId, currentId),
        eq(schema.FieldValue.fieldId, parentFieldId),
        eq(schema.FieldValue.organizationId, ctx.organizationId)
      ),
      columns: { relatedEntityId: true },
    })

    currentId = parentValue?.relatedEntityId ?? null
  }

  return false
}

// ============================================================================
// DEPTH CALCULATION
// ============================================================================

/**
 * Calculate the depth of an entity in a hierarchy.
 * Counts the number of ancestors from this entity to the root.
 *
 * @param ctx - Database context
 * @param entityId - The entity to calculate depth for
 * @param parentFieldId - The CustomField ID of the parent relationship field
 * @returns The depth (0 = root, 1 = first level, etc.)
 */
export async function calculateDepth(
  ctx: ValidationContext,
  entityId: string,
  parentFieldId: string
): Promise<number> {
  let depth = 0
  let currentId: string | null = entityId

  while (currentId) {
    const parentValue = await ctx.db.query.FieldValue.findFirst({
      where: and(
        eq(schema.FieldValue.entityId, currentId),
        eq(schema.FieldValue.fieldId, parentFieldId),
        eq(schema.FieldValue.organizationId, ctx.organizationId)
      ),
      columns: { relatedEntityId: true },
    })

    currentId = parentValue?.relatedEntityId ?? null
    if (currentId) depth++
  }

  return depth
}

// ============================================================================
// DESCENDANT RETRIEVAL
// ============================================================================

/**
 * Get all descendant IDs of an entity in a hierarchy.
 * Uses breadth-first traversal to find all children, grandchildren, etc.
 *
 * @param ctx - Database context
 * @param entityId - The root entity
 * @param parentFieldId - The CustomField ID of the parent relationship field
 * @returns Set of all descendant entity IDs
 */
export async function getDescendantIds(
  ctx: ValidationContext,
  entityId: string,
  parentFieldId: string
): Promise<Set<string>> {
  const descendants = new Set<string>()
  const queue: string[] = [entityId]

  while (queue.length > 0) {
    const currentId = queue.shift()!

    // Find all entities where parentFieldId = currentId
    const children = await ctx.db
      .select({ entityId: schema.FieldValue.entityId })
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.fieldId, parentFieldId),
          eq(schema.FieldValue.relatedEntityId, currentId),
          eq(schema.FieldValue.organizationId, ctx.organizationId)
        )
      )

    for (const child of children) {
      if (!descendants.has(child.entityId)) {
        descendants.add(child.entityId)
        queue.push(child.entityId)
      }
    }
  }

  return descendants
}

// ============================================================================
// MAX DESCENDANT DEPTH
// ============================================================================

/**
 * Get the maximum depth among descendants of an entity.
 * Used to validate that moving an entity won't cause descendants to exceed max depth.
 */
async function getMaxDescendantDepth(
  ctx: ValidationContext,
  entityId: string,
  parentFieldId: string,
  descendants: Set<string>
): Promise<number> {
  if (descendants.size === 0) return 0

  let maxDepth = 0

  // For each descendant, calculate its depth relative to entityId
  for (const descendantId of descendants) {
    let depth = 0
    let currentId: string | null = descendantId

    while (currentId && currentId !== entityId) {
      const parentValue = await ctx.db.query.FieldValue.findFirst({
        where: and(
          eq(schema.FieldValue.entityId, currentId),
          eq(schema.FieldValue.fieldId, parentFieldId),
          eq(schema.FieldValue.organizationId, ctx.organizationId)
        ),
        columns: { relatedEntityId: true },
      })

      currentId = parentValue?.relatedEntityId ?? null
      depth++
    }

    maxDepth = Math.max(maxDepth, depth)
  }

  return maxDepth
}

// ============================================================================
// MAIN VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validate a self-referential relationship change.
 * Checks constraints like circular references and max depth.
 *
 * @param ctx - Database context
 * @param params - Validation parameters
 * @returns ValidationResult with valid flag and optional error message
 */
export async function validateSelfReferentialChange(
  ctx: ValidationContext,
  params: {
    entityId: string
    entityDefinitionId: string
    fieldId: string
    newRelatedId: string | null
    relationship: RelationshipConfig
  }
): Promise<ValidationResult> {
  const { entityId, entityDefinitionId, fieldId, newRelatedId, relationship } = params

  // Check if this is a self-referential relationship
  if (!isSelfReferentialRelationship(entityDefinitionId, relationship)) {
    return { valid: true } // Not self-referential, no special validation
  }

  const constraints = relationship.constraints ?? {}

  // Default: prevent circular references unless explicitly disabled
  const preventCircular = constraints.preventCircular !== false

  // Check for circular reference
  if (preventCircular && newRelatedId) {
    const isCircular = await hasCircularReference(ctx, entityId, newRelatedId, fieldId)
    if (isCircular) {
      return {
        valid: false,
        error: 'This would create a circular reference',
      }
    }
  }

  // Check max depth constraint
  if (constraints.maxDepth !== undefined && newRelatedId) {
    // Calculate new depth: depth of new parent + 1
    const parentDepth = await calculateDepth(ctx, newRelatedId, fieldId)
    const newDepth = parentDepth + 1

    if (newDepth > constraints.maxDepth) {
      return {
        valid: false,
        error: `Maximum hierarchy depth of ${constraints.maxDepth} exceeded`,
      }
    }

    // Also check if this entity has descendants that would exceed max depth
    const descendants = await getDescendantIds(ctx, entityId, fieldId)
    const descendantMaxDepth = await getMaxDescendantDepth(ctx, entityId, fieldId, descendants)
    const totalDepth = newDepth + descendantMaxDepth

    if (totalDepth > constraints.maxDepth) {
      return {
        valid: false,
        error: `Moving this item would cause descendants to exceed maximum depth of ${constraints.maxDepth}`,
      }
    }
  }

  return { valid: true }
}

/**
 * Validate deletion of an entity with potential children.
 *
 * @param ctx - Database context
 * @param params - Validation parameters
 * @returns ValidationResult
 */
export async function validateSelfReferentialDelete(
  ctx: ValidationContext,
  params: {
    entityId: string
    entityDefinitionId: string
    fieldId: string
    relationship: RelationshipConfig
  }
): Promise<ValidationResult> {
  const { entityId, entityDefinitionId, fieldId, relationship } = params

  if (!isSelfReferentialRelationship(entityDefinitionId, relationship)) {
    return { valid: true }
  }

  const constraints = relationship.constraints ?? {}
  const onDelete = constraints.onDeleteWithChildren ?? 'prevent'

  if (onDelete === 'prevent') {
    // Check if entity has children
    const children = await ctx.db
      .select({ entityId: schema.FieldValue.entityId })
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.fieldId, fieldId),
          eq(schema.FieldValue.relatedEntityId, entityId),
          eq(schema.FieldValue.organizationId, ctx.organizationId)
        )
      )
      .limit(1)

    if (children.length > 0) {
      return {
        valid: false,
        error: 'Cannot delete: this item has children. Remove or reassign children first.',
      }
    }
  }

  return { valid: true }
}
