// packages/lib/src/import/fields/get-identifier-options.ts

import { getFieldOutputKey } from '../../resources/registry/field-types'
import type { Resource } from '../../resources/registry/types'

/** Field that can be used as an identifier for duplicate detection */
export interface IdentifierOption {
  key: string
  label: string
  type: string
  isUnique: boolean
  isRecommended: boolean
}

/** Fields that are typically unique identifiers */
const COMMON_UNIQUE_FIELDS = new Set([
  'email',
  'externalId',
  'id',
  'sku',
  'code',
  'slug',
  'handle',
  'phone',
])

/**
 * Get fields that can be used as identifiers for duplicate detection.
 * Prioritizes fields like email, externalId, etc.
 *
 * @param resource - Resource definition
 * @returns Array of identifier options
 */
export function getIdentifierOptions(resource: Resource): IdentifierOption[] {
  const options: IdentifierOption[] = []

  for (const field of resource.fields) {
    // Skip non-filterable fields
    if (!field.capabilities.filterable) continue

    // Skip relation fields
    if (field.relationship) continue

    const outputKey = getFieldOutputKey(field)

    // Determine if this is likely a unique field
    const isUnique = COMMON_UNIQUE_FIELDS.has(outputKey)

    // Recommend email and externalId fields
    const isRecommended = outputKey === 'email' || outputKey === 'externalId'

    options.push({
      key: outputKey,
      label: field.label,
      type: field.type,
      isUnique,
      isRecommended,
    })
  }

  // Sort: recommended first, then unique fields, then alphabetically
  return options.sort((a, b) => {
    if (a.isRecommended && !b.isRecommended) return -1
    if (!a.isRecommended && b.isRecommended) return 1
    if (a.isUnique && !b.isUnique) return -1
    if (!a.isUnique && b.isUnique) return 1
    return a.label.localeCompare(b.label)
  })
}
