// apps/web/src/components/dynamic-table/utils/table-id.ts

/**
 * Generate a unique table ID for metadata scoping.
 *
 * Uses a combination of entity definition ID and view ID to ensure:
 * - Same entity + same view = same table ID (metadata reuse)
 * - Different entities or views = different table IDs (no conflicts)
 */
export function generateTableId(entityDefinitionId: string, viewId?: string): string {
  return viewId ? `${entityDefinitionId}:${viewId}` : entityDefinitionId
}
