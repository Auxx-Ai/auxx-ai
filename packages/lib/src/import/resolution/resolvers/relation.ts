// packages/lib/src/import/resolution/resolvers/relation.ts

import type { ResolutionConfig, ResolvedValue } from '../../types/resolution'

/**
 * Relation resolver context - passed when resolving relation values
 */
export interface RelationResolverContext {
  /** Lookup function to find record by field value */
  findRecord?: (
    targetTable: string,
    matchField: string,
    value: string
  ) => Promise<{ id: string } | null>
}

/**
 * Resolve a relation value by looking up the related record.
 * Matches on the display field of the target resource.
 *
 * Note: This is a synchronous "dry" resolver that marks values for lookup.
 * Actual lookup happens during planning phase via processColumnValues.
 */
export function resolveRelationMatch(
  rawValue: string,
  config: ResolutionConfig,
  _ctx?: RelationResolverContext
): ResolvedValue {
  const trimmed = rawValue.trim()

  if (!trimmed) {
    return { type: 'value', value: null }
  }

  const { relatedEntityDefinitionId } = config.relationConfig || {}
  if (!relatedEntityDefinitionId) {
    return { type: 'error', error: 'Relation target entity not configured' }
  }

  // During initial resolution, we mark this as a pending lookup
  // The actual lookup happens during planning phase
  return {
    type: 'value',
    value: {
      __pendingRelationLookup: true,
      targetTable: relatedEntityDefinitionId,
      matchField: config.relationConfig?.matchField,
      searchValue: trimmed,
    },
  }
}

/**
 * Resolve a relation value, creating the record if it doesn't exist.
 */
export function resolveRelationCreate(
  rawValue: string,
  config: ResolutionConfig,
  _ctx?: RelationResolverContext
): ResolvedValue {
  const trimmed = rawValue.trim()

  if (!trimmed) {
    return { type: 'value', value: null }
  }

  const { relatedEntityDefinitionId } = config.relationConfig || {}
  if (!relatedEntityDefinitionId) {
    return { type: 'error', error: 'Relation target entity not configured' }
  }

  // Mark as pending lookup with create capability
  return {
    type: 'value',
    value: {
      __pendingRelationLookup: true,
      __createIfNotFound: true,
      targetTable: relatedEntityDefinitionId,
      matchField: config.relationConfig?.matchField,
      searchValue: trimmed,
    },
  }
}

/**
 * Resolve a relation value when the CSV contains the target record's ID directly.
 * This validates the ID format but marks it for existence verification.
 */
export function resolveRelationId(
  rawValue: string,
  config: ResolutionConfig,
  _ctx?: RelationResolverContext
): ResolvedValue {
  const trimmed = rawValue.trim()

  if (!trimmed) {
    return { type: 'value', value: null }
  }

  const { relatedEntityDefinitionId } = config.relationConfig || {}
  if (!relatedEntityDefinitionId) {
    return { type: 'error', error: 'Relation target entity not configured' }
  }

  // Mark as pending ID verification - we need to verify the ID exists
  return {
    type: 'value',
    value: {
      __pendingRelationLookup: true,
      __isDirectId: true,
      targetTable: relatedEntityDefinitionId,
      matchField: 'id',
      searchValue: trimmed,
    },
  }
}

/** Shape of a pending relation lookup value */
export interface PendingRelationLookupValue {
  __pendingRelationLookup: true
  targetTable: string
  searchValue: string
  matchField?: string
  __createIfNotFound?: boolean
  __isDirectId?: boolean
}

/**
 * Type guard for pending relation lookup values
 */
export function isPendingRelationLookup(value: unknown): value is PendingRelationLookupValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__pendingRelationLookup' in value &&
    (value as Record<string, unknown>).__pendingRelationLookup === true
  )
}

/**
 * Type guard for direct ID relation lookup values
 */
export function isDirectIdRelationLookup(value: unknown): value is {
  __pendingRelationLookup: true
  __isDirectId: true
  targetTable: string
  searchValue: string
} {
  return (
    isPendingRelationLookup(value) &&
    '__isDirectId' in value &&
    (value as Record<string, unknown>).__isDirectId === true
  )
}
