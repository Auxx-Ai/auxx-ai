// packages/lib/src/import/resolution/resolvers/relation.ts

import type {
  RelationLinkMode,
  RelationOnNoMatch,
  ResolutionConfig,
  ResolvedValue,
} from '../../types/resolution'

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
      // `relation:match` carries whatever policy the column persisted. Absent
      // ⇒ `'fail'`, which is what this resolution type has always meant.
      __onNoMatch: config.relationConfig?.onNoMatch ?? 'fail',
      __linkMode: config.relationConfig?.linkMode,
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
      // An explicit `'blank'`/`'fail'` on a `relation:create` column still
      // wins, the resolution type is DERIVED from the policy, so the policy
      // is the authority when the two disagree (a stale row, a hand edit).
      __onNoMatch: config.relationConfig?.onNoMatch ?? 'create',
      __linkMode: config.relationConfig?.linkMode,
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
  /**
   * Per-column no-match policy, carried on the marker so the batch resolver
   * never has to re-read the mapping row it is resolving values for.
   */
  __onNoMatch?: RelationOnNoMatch
  /** Per-column replace-or-append policy for multi-valued relations. */
  __linkMode?: RelationLinkMode
  /**
   * @deprecated Superseded by `__onNoMatch: 'create'`. Still read so markers
   * written before the policy existed keep resolving the way they were meant
   * to instead of silently downgrading to `'fail'`.
   */
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
  return isPendingRelationLookup(value) && value.__isDirectId === true
}
