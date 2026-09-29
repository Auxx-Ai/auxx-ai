// packages/lib/src/import/fields/import-tier.ts

import type { ResourceField } from '../../resources/registry/field-types'

/** Import tier shown by the field-first mapping view; absent = neither required nor recommended. */
export type ImportTier = 'required' | 'recommended'

/** Required is derived (`capabilities.required` or a natural-key leg); only `recommended` is declared. */
export function getImportTier(
  field: Pick<ResourceField, 'capabilities' | 'naturalKeyPosition' | 'importHint'>
): ImportTier | undefined {
  if (field.capabilities.required || typeof field.naturalKeyPosition === 'number') {
    return 'required'
  }
  return field.importHint === 'recommended' ? 'recommended' : undefined
}
