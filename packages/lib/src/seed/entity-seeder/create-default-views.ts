// packages/lib/src/seed/entity-seeder/create-default-views.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toFieldId, toResourceFieldId } from '@auxx/types/field'
import type { Condition, ConditionGroup } from '../../conditions/types'
import { DEFAULT_VIEW_CONFIGS, type DefaultViewDefinition } from '../default-view-configs'
import type { EntityDefMap, FieldMap } from './types'

const logger = createScopedLogger('entity-seeder:create-default-views')

/**
 * Pass 5: Create Default TableViews
 * Create the seeded table views (default + filtered shared views) per resource
 * with all `field_*` symbolic references rewritten to real ResourceFieldIds.
 */
export async function createDefaultViews(
  db: Database,
  organizationId: string,
  userId: string,
  entityDefMap: EntityDefMap,
  fieldMap: FieldMap
): Promise<void> {
  const now = new Date()

  // Cast through the definition type — the literal `as const satisfies` shape
  // hides optional fields like `isDefault` on entries that omit them.
  const entries = Object.entries(
    DEFAULT_VIEW_CONFIGS as unknown as Record<string, readonly DefaultViewDefinition[]>
  )

  for (const [entityType, viewDefs] of entries) {
    const entityDef = entityDefMap.get(entityType)
    if (!entityDef) {
      logger.warn(`EntityDefinition not found for ${entityType}, skipping view creation`)
      continue
    }

    assertSingleDefault(entityType, viewDefs)

    const tableId = `entity-${entityDef.id}`

    for (const viewDef of viewDefs) {
      const isDefault = viewDef.isDefault ?? false
      const resolvedConfig = resolveViewConfig(viewDef.config, entityType, entityDef.id, fieldMap)

      const [createdView] = await db
        .insert(schema.TableView)
        .values({
          organizationId,
          userId,
          tableId,
          name: viewDef.name,
          isDefault,
          isShared: true,
          config: resolvedConfig,
          updatedAt: now,
        })
        .returning()

      if (!createdView) {
        throw new Error(`Failed to create view "${viewDef.name}" for ${entityType}`)
      }

      logger.debug(`Created view "${viewDef.name}" for ${entityType}`, {
        viewId: createdView.id,
        tableId,
        isDefault,
      })
    }
  }
}

/**
 * Fail loudly when a seed author marks zero or multiple views as default for a
 * single entity. Postgres enforces this via a partial unique index, but the DB
 * error is opaque — this catches the bug at the source with a clear message.
 */
function assertSingleDefault(entityType: string, viewDefs: readonly DefaultViewDefinition[]): void {
  const defaults = viewDefs.filter((v) => v.isDefault)
  if (defaults.length !== 1) {
    const names = defaults.map((v) => v.name).join(', ') || '<none>'
    throw new Error(
      `DEFAULT_VIEW_CONFIGS["${entityType}"] must have exactly one entry with isDefault: true (found ${defaults.length}: ${names})`
    )
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
  config: DefaultViewDefinition['config'],
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

  // Transform filters: rewrite each condition's symbolic fieldId; drop conditions
  // whose field can't be resolved (and drop groups that end up empty), so we
  // never persist a half-broken filter.
  const filters = (config.filters ?? [])
    .map((group) => resolveFilterGroup(group, resolve, entityType))
    .filter((g): g is ConditionGroup => g !== null)

  return {
    ...config,
    columnVisibility,
    columnOrder,
    columnPinning,
    sorting,
    filters,
  }
}

function resolveFilterGroup(
  group: ConditionGroup,
  resolve: (fieldKey: string) => string | null,
  entityType: string
): ConditionGroup | null {
  const conditions: Condition[] = []
  for (const condition of group.conditions) {
    const resolved = resolveFilterCondition(condition, resolve, entityType)
    if (resolved) conditions.push(resolved)
  }

  if (conditions.length === 0) return null
  return { ...group, conditions }
}

function resolveFilterCondition(
  condition: Condition,
  resolve: (fieldKey: string) => string | null,
  entityType: string
): Condition | null {
  // Filters in default-view-configs only use a single symbolic fieldId string.
  // Bail (and warn) on anything more exotic so we don't silently corrupt it.
  if (typeof condition.fieldId !== 'string') {
    logger.warn(
      `Default view filter condition ${condition.id} on ${entityType} has non-string fieldId; skipping`
    )
    return null
  }

  const resolved = resolve(condition.fieldId)
  if (!resolved) {
    logger.warn(
      `Default view filter condition ${condition.id} on ${entityType} references unknown field "${condition.fieldId}"; skipping`
    )
    return null
  }

  return { ...condition, fieldId: resolved }
}
