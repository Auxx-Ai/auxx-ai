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

/** Which way the mapping step lists the mapping: one row per target field, or per file column. */
export type MappingView = 'fields' | 'columns'

/** Fields view for named importers and for any target that declares recommended fields. */
export function getDefaultMappingView(
  fields: ReadonlyArray<{ importTier?: ImportTier }>,
  isNamedImporter: boolean
): MappingView {
  return isNamedImporter || fields.some((f) => f.importTier === 'recommended')
    ? 'fields'
    : 'columns'
}

/** The fields the Fields view lists up front; auto-map in that view only targets these. */
export function getGuidedFields<T extends { importTier?: ImportTier }>(fields: T[]): T[] {
  const guided = fields.filter((f) => f.importTier !== undefined)
  return guided.length > 0 ? guided : fields
}
