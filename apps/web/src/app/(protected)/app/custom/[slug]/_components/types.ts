// apps/web/src/app/(protected)/app/custom/[slug]/_components/types.ts

/**
 * Row data type for the entity table
 * Field values are stored in customFieldValueStore and accessed via syncer/getValue
 */
export interface EntityRow {
  id: string
  entityDefinitionId: string
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  /** @deprecated Values come from store via syncer, not from row data */
  customFieldValues: Array<{
    fieldId: string
    value: unknown
  }>
  /** @deprecated No longer populated - use getValue from store instead */
  _originalValues: Array<{
    id: string
    fieldId: string
    value: unknown
    createdAt?: Date
    updatedAt?: Date
    entityId?: string
  }>
}
