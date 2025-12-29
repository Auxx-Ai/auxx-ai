// apps/web/src/app/(protected)/app/custom/[slug]/_components/types.ts

/**
 * Row data type for the entity table
 * Normalized to have customFieldValues for compatibility with existing column helpers
 */
export interface EntityRow {
  id: string
  entityDefinitionId: string
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  customFieldValues: Array<{
    fieldId: string
    value: unknown
  }>
  /** Original values array from API */
  _originalValues: Array<{
    id: string
    fieldId: string
    value: unknown
    createdAt?: Date
    updatedAt?: Date
    entityId?: string
  }>
}
