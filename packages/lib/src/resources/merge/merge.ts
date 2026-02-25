// packages/lib/src/resources/merge/merge.ts

import type { FieldType } from '@auxx/database/types'
import { isMultiValueFieldType } from '../../field-values/formatter'
import type { MergeFieldInput, MergeFieldResult } from './types'

/**
 * Merge field values using simple, type-based strategies.
 *
 * Strategies:
 * - Single-value: Target wins, or first non-empty source
 * - Multi-value: Union all values, deduplicate
 * - Relationship: Depends on relationship type
 * - File: Union attachmentIds
 */
export function mergeFieldValue(input: MergeFieldInput): MergeFieldResult {
  const { targetValue, sourceValues, fieldType, fieldOptions } = input

  // Filter out empty sources
  const validSources = sourceValues.filter((v) => hasValue(v))

  // Special handling by field type
  if (fieldType === 'RELATIONSHIP') {
    return mergeRelationship(targetValue, validSources, fieldOptions)
  }

  if (fieldType === 'FILE') {
    return mergeFiles(targetValue, validSources)
  }

  if (isMultiValueFieldType(fieldType)) {
    return mergeMultiValue(targetValue, validSources, fieldType)
  }

  // Default: single-value (target wins)
  return mergeSingleValue(targetValue, validSources)
}

// ─────────────────────────────────────────────────────────────────
// Single-Value: Target wins, or first non-empty source
// ─────────────────────────────────────────────────────────────────

/** Merge single-value field: target wins, or first non-empty source */
function mergeSingleValue(targetValue: unknown, validSources: unknown[]): MergeFieldResult {
  if (hasValue(targetValue)) {
    return { value: targetValue, wasModified: false }
  }

  const firstSource = validSources[0]
  if (firstSource !== undefined) {
    return { value: firstSource, wasModified: true }
  }

  return { value: null, wasModified: false }
}

// ─────────────────────────────────────────────────────────────────
// Multi-Value: Union all values, deduplicate
// ─────────────────────────────────────────────────────────────────

/** Merge multi-value field: union all values, deduplicate */
function mergeMultiValue(
  targetValue: unknown,
  validSources: unknown[],
  fieldType: FieldType
): MergeFieldResult {
  const allValues: unknown[] = []

  // Collect target
  if (Array.isArray(targetValue)) {
    allValues.push(...targetValue)
  } else if (targetValue !== null && targetValue !== undefined) {
    allValues.push(targetValue)
  }

  // Collect sources
  for (const source of validSources) {
    if (Array.isArray(source)) {
      allValues.push(...source)
    } else {
      allValues.push(source)
    }
  }

  // Deduplicate using key-based approach (safer than JSON.stringify)
  const seen = new Set<string>()
  const uniqueValues: unknown[] = []

  for (const val of allValues) {
    const key = getDedupeKey(val, fieldType)
    if (!seen.has(key)) {
      seen.add(key)
      uniqueValues.push(val)
    }
  }

  const targetArray = Array.isArray(targetValue) ? targetValue : []
  const wasModified = uniqueValues.length !== targetArray.length

  return { value: uniqueValues, wasModified }
}

// ─────────────────────────────────────────────────────────────────
// Relationship: has_many = union, belongs_to = target wins
// ─────────────────────────────────────────────────────────────────

/** Relationship value shape */
interface RelationshipValue {
  relatedEntityId: string
  relatedEntityDefinitionId: string
}

/** Merge relationship field: depends on relationship type */
function mergeRelationship(
  targetValue: unknown,
  validSources: unknown[],
  fieldOptions?: Record<string, unknown>
): MergeFieldResult {
  const relationshipType =
    (fieldOptions?.relationship as { relationshipType?: string })?.relationshipType ?? 'has_many'
  const isSingleValue = relationshipType === 'belongs_to' || relationshipType === 'has_one'

  if (isSingleValue) {
    return mergeSingleValue(targetValue, validSources)
  }

  // has_many / many_to_many: union
  const allRelationships: RelationshipValue[] = []

  // Collect target
  if (Array.isArray(targetValue)) {
    allRelationships.push(...(targetValue as RelationshipValue[]))
  } else if (isRelationshipValue(targetValue)) {
    allRelationships.push(targetValue)
  }

  // Collect sources
  for (const source of validSources) {
    if (Array.isArray(source)) {
      allRelationships.push(...(source as RelationshipValue[]))
    } else if (isRelationshipValue(source)) {
      allRelationships.push(source)
    }
  }

  // Deduplicate by relatedEntityId
  const seen = new Set<string>()
  const uniqueRelationships: RelationshipValue[] = []

  for (const rel of allRelationships) {
    if (!seen.has(rel.relatedEntityId)) {
      seen.add(rel.relatedEntityId)
      uniqueRelationships.push(rel)
    }
  }

  const targetArray = Array.isArray(targetValue) ? (targetValue as RelationshipValue[]) : []
  const wasModified = uniqueRelationships.length !== targetArray.length

  return { value: uniqueRelationships, wasModified }
}

// ─────────────────────────────────────────────────────────────────
// File: Union attachmentIds
// ─────────────────────────────────────────────────────────────────

/** File value shape */
interface FileValue {
  attachmentIds: string[]
}

/** Merge file field: union all attachmentIds */
function mergeFiles(targetValue: unknown, validSources: unknown[]): MergeFieldResult {
  const allAttachmentIds: string[] = []

  // Extract from target
  const targetIds = extractAttachmentIds(targetValue)
  allAttachmentIds.push(...targetIds)

  // Extract from sources
  for (const source of validSources) {
    const sourceIds = extractAttachmentIds(source)
    allAttachmentIds.push(...sourceIds)
  }

  // Deduplicate
  const uniqueIds = [...new Set(allAttachmentIds)]

  const wasModified = uniqueIds.length !== targetIds.length

  return {
    value: { attachmentIds: uniqueIds },
    wasModified,
  }
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/** Check if value has actual content (not empty) */
function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string' && value.trim() === '') return false
  if (Array.isArray(value) && value.length === 0) return false

  // For objects (NAME, ADDRESS_STRUCT, relationships), check if any property has value
  if (typeof value === 'object' && !Array.isArray(value)) {
    return Object.values(value as Record<string, unknown>).some(
      (v) => v !== null && v !== undefined && v !== ''
    )
  }

  return true
}

/** Get deduplication key for a value (safer than JSON.stringify) */
function getDedupeKey(value: unknown, fieldType: FieldType): string {
  // For primitive values
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return `${fieldType}:${value}`
  }

  // For relationship values
  if (isRelationshipValue(value)) {
    return `rel:${value.relatedEntityId}`
  }

  // For file/attachment values
  if (typeof value === 'object' && value !== null && 'url' in value) {
    const obj = value as Record<string, unknown>
    return `file:${obj.url ?? obj.name ?? JSON.stringify(value)}`
  }

  // Fallback to JSON (consistent property order for simple objects)
  return `${fieldType}:${JSON.stringify(value)}`
}

/** Type guard for relationship values */
function isRelationshipValue(value: unknown): value is RelationshipValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'relatedEntityId' in value &&
    'relatedEntityDefinitionId' in value
  )
}

/** Extract attachmentIds from file value */
function extractAttachmentIds(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []

  const obj = value as Record<string, unknown>
  if (!('attachmentIds' in obj)) return []

  const ids = obj.attachmentIds
  if (Array.isArray(ids)) return ids
  if (typeof ids === 'string') return [ids]
  return []
}
