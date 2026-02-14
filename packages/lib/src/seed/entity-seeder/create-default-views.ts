// packages/lib/src/seed/entity-seeder/create-default-views.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toFieldId, toResourceFieldId } from '@auxx/types/field'
import { DEFAULT_VIEW_CONFIGS } from '../default-view-configs'
import type { EntityDefMap, FieldMap } from './types'

const logger = createScopedLogger('entity-seeder:create-default-views')

/**
 * Pass 5: Create Default TableViews
 * Create default table views with resolved field IDs.
 */
export async function createDefaultViews(
  db: Database,
  organizationId: string,
  userId: string,
  entityDefMap: EntityDefMap,
  fieldMap: FieldMap
): Promise<void> {
  const now = new Date()

  for (const [entityType, viewConfig] of Object.entries(DEFAULT_VIEW_CONFIGS)) {
    const entityDef = entityDefMap.get(entityType)
    if (!entityDef) {
      logger.warn(`EntityDefinition not found for ${entityType}, skipping view creation`)
      continue
    }

    const tableId = `entity-${entityDef.id}`
    const resolvedConfig = resolveViewConfig(viewConfig.config, entityType, entityDef.id, fieldMap)

    const [createdView] = await db
      .insert(schema.TableView)
      .values({
        organizationId,
        userId,
        tableId,
        name: viewConfig.name,
        isDefault: true,
        isShared: true,
        config: resolvedConfig,
        updatedAt: now,
      })
      .returning()

    if (!createdView) {
      throw new Error(`Failed to create default view for ${entityType}`)
    }

    logger.debug(`Created default view for ${entityType}`, {
      viewId: createdView.id,
      tableId,
    })
  }
}

/**
 * Build field mapping from systemAttribute to CustomField
 */
function buildFieldIdMap(
  entityType: string,
  fieldMap: FieldMap
): Map<string, { id: string; entityDefinitionId: string }> {
  const map = new Map<string, { id: string; entityDefinitionId: string }>()

  for (const [key, field] of fieldMap.entries()) {
    if (key.startsWith(`${entityType}:`)) {
      // Key format in default-view-configs is `field_${systemAttribute}`
      const configKey = `field_${field.systemAttribute}`
      map.set(configKey, {
        id: field.id,
        entityDefinitionId: field.entityDefinitionId,
      })
    }
  }

  return map
}

/**
 * Resolve view config field references to actual ResourceFieldIds
 */
function resolveViewConfig(
  config: (typeof DEFAULT_VIEW_CONFIGS)[keyof typeof DEFAULT_VIEW_CONFIGS]['config'],
  entityType: string,
  entityDefId: string,
  fieldMap: FieldMap
): Record<string, unknown> {
  const fieldIdMap = buildFieldIdMap(entityType, fieldMap)

  // Resolve field_* to ResourceFieldId
  const resolve = (fieldKey: string): string | null => {
    const field = fieldIdMap.get(fieldKey)
    if (!field) return null
    return toResourceFieldId(entityDefId, toFieldId(field.id))
  }

  // Transform columnVisibility (keys are field_* values)
  const columnVisibility: Record<string, boolean> = {}
  for (const [fieldKey, visible] of Object.entries(config.columnVisibility)) {
    const resolved = resolve(fieldKey)
    if (resolved) columnVisibility[resolved] = visible
  }

  // Transform columnOrder (array of field_* values)
  const columnOrder = config.columnOrder
    .map((fieldKey) => resolve(fieldKey))
    .filter((v): v is string => v !== null)

  // Transform columnPinning
  const columnPinning: { left?: string[] } = {}
  if (config.columnPinning?.left) {
    const pinnedLeft: string[] = []
    for (const fieldKey of config.columnPinning.left) {
      if (fieldKey === '_checkbox') {
        pinnedLeft.push('_checkbox')
      } else {
        const resolved = resolve(fieldKey)
        if (resolved) pinnedLeft.push(resolved)
      }
    }
    columnPinning.left = pinnedLeft
  }

  // Transform sorting
  const sorting = config.sorting
    ?.map((s) => {
      const resolved = resolve(s.id)
      return resolved ? { id: resolved, desc: s.desc } : null
    })
    .filter((s): s is { id: string; desc: boolean } => s !== null)

  return {
    ...config,
    columnVisibility,
    columnOrder,
    columnPinning,
    sorting,
  }
}
