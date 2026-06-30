// packages/lib/src/ai/kopilot/capabilities/record-views/build-view-config.ts

import { toFieldId, toResourceFieldId } from '@auxx/types/field'
import type { Condition, ConditionGroup, ViewConfig } from '../../../../conditions'
import type { ResourceField } from '../../../../resources/registry/field-types'
import type { Resource } from '../../../../resources/registry/types'
import {
  type QueryWarning,
  type SimplifiedFilter,
  validateFilters,
} from '../entities/shared/record-filters'

/**
 * Builds a {@link ViewConfig} (the persisted saved-view shape AND the live
 * dynamic-table store shape) from the LLM's simplified filter/sort/column spec.
 *
 * IMPORTANT — convention: the records table store and saved `TableView` config
 * key every field by its **column id** = `toResourceFieldId(entityDefinitionId,
 * field.id)` (see `dynamic-resource-view` / `header-cell` on the frontend).
 * This is deliberately different from the apiSlug-prefixed convention used by
 * the kopilot `query_records` read path (`record-filters.convertToConditionGroup`).
 * Don't cross the two.
 *
 * Relationship-path filters (`company.name`) are dropped here with a warning:
 * the records view filter layer keys on a single column id, so only direct
 * fields are supported in v1.
 */

export interface ViewSpec {
  filters?: SimplifiedFilter[]
  logicalOperator?: 'AND' | 'OR'
  sort?: { field: string; direction: 'asc' | 'desc' }
  /** Field identifiers (systemAttribute/key) to show, in order. Omit to leave columns untouched. */
  columns?: string[]
}

export interface BuiltViewConfig {
  config: ViewConfig
  warnings: QueryWarning[]
  /** Count of filters that survived validation — distinguishes "no filters" from "all dropped". */
  appliedFilterCount: number
  requestedFilterCount: number
  /**
   * The validated, direct (non-path) filters in their simplified shape. The
   * count path re-builds these into the apiSlug-prefixed `ConditionGroup` the
   * kopilot read handler expects (a different convention from `config.filters`).
   */
  validFilters: SimplifiedFilter[]
  logicalOperator: 'AND' | 'OR'
}

/** Only the `ViewConfig` keys the spec actually touched — the merge unit for updates. */
export interface ViewConfigPatch {
  patch: Partial<ViewConfig>
  warnings: QueryWarning[]
  appliedFilterCount: number
  requestedFilterCount: number
  validFilters: SimplifiedFilter[]
  logicalOperator: 'AND' | 'OR'
}

/** Column id used by the records table store + saved views for a field. */
export function fieldColumnId(field: ResourceField, entityDefinitionId: string): string {
  return field.resourceFieldId ?? toResourceFieldId(entityDefinitionId, toFieldId(field.id))
}

function findField(resource: Resource, identifier: string): ResourceField | undefined {
  return resource.fields.find(
    (f) => f.systemAttribute === identifier || f.key === identifier || f.id === identifier
  )
}

/**
 * Build a **partial** `ViewConfig` containing only the keys the spec provided —
 * the unit `update_table_view` shallow-merges over an existing config so
 * UI-set sizing/pinning/formatting survive an edit. A field is "touched" only
 * when its spec property is present:
 * - `filters` present (even `[]` — an explicit clear) → `patch.filters`
 * - `sort` present → `patch.sorting`
 * - `columns` present and non-empty → `patch.columnVisibility` + `patch.columnOrder`
 */
export function buildViewConfigPatch(
  spec: ViewSpec,
  resource: Resource,
  entityDefinitionId: string
): ViewConfigPatch {
  const warnings: QueryWarning[] = []
  const patch: Partial<ViewConfig> = {}
  const logicalOperator = spec.logicalOperator ?? 'AND'

  // Filters
  let appliedFilterCount = 0
  let requestedFilterCount = 0
  const directFilters: SimplifiedFilter[] = []
  if (spec.filters !== undefined) {
    requestedFilterCount = spec.filters.length
    const { valid, warnings: filterWarnings } = validateFilters(spec.filters, resource)
    warnings.push(...filterWarnings)

    // Records view filters key on a single column id — drop relationship paths.
    for (const f of valid) {
      if (f.field.includes('.')) {
        warnings.push({
          kind: 'multi_hop_dot_notation',
          field: f.field,
          hint: `Relationship filters (e.g. "${f.field}") can't be saved in a record view yet — only direct fields. Filter on a direct field instead.`,
        })
        continue
      }
      directFilters.push(f)
    }

    const conditions: Condition[] = directFilters
      .map((f, i): Condition | null => {
        const field = findField(resource, f.field)
        if (!field) return null
        return {
          id: `f-${i}`,
          fieldId: fieldColumnId(field, entityDefinitionId),
          operator: f.operator as Condition['operator'],
          value: f.value,
        }
      })
      .filter((c): c is Condition => c !== null)

    appliedFilterCount = conditions.length
    patch.filters =
      conditions.length > 0
        ? [{ id: 'kopilot-view', conditions, logicalOperator }]
        : ([] as ConditionGroup[])
  }

  // Sort
  if (spec.sort !== undefined) {
    const field = findField(resource, spec.sort.field)
    if (field) {
      patch.sorting = [
        { id: fieldColumnId(field, entityDefinitionId), desc: spec.sort.direction === 'desc' },
      ]
    } else {
      warnings.push({
        kind: 'unknown_field',
        field: spec.sort.field,
        hint: `Sort field "${spec.sort.field}" not found on "${resource.label}". Sort skipped.`,
      })
    }
  }

  // Columns — when specified, show ONLY the listed fields (special columns like
  // selection/primary aren't in `fields`, so they stay visible by default).
  if (spec.columns !== undefined && spec.columns.length > 0) {
    const wanted = new Set<string>()
    const columnOrder: string[] = []
    for (const c of spec.columns) {
      const field = findField(resource, c)
      if (!field) {
        warnings.push({
          kind: 'unknown_field',
          field: c,
          hint: `Column "${c}" not found on "${resource.label}". Skipped.`,
        })
        continue
      }
      const colId = fieldColumnId(field, entityDefinitionId)
      wanted.add(colId)
      if (!columnOrder.includes(colId)) columnOrder.push(colId)
    }
    if (wanted.size > 0) {
      patch.columnVisibility = Object.fromEntries(
        resource.fields.map((f) => {
          const colId = fieldColumnId(f, entityDefinitionId)
          return [colId, wanted.has(colId)]
        })
      )
      patch.columnOrder = columnOrder
    }
  }

  return {
    patch,
    warnings,
    appliedFilterCount,
    requestedFilterCount,
    validFilters: directFilters,
    logicalOperator,
  }
}

/**
 * Build a complete {@link ViewConfig} for a brand-new view — the patch spread
 * over the empty defaults. Behaviorally identical to building each key inline:
 * untouched keys fall back to their empty defaults.
 */
export function buildViewConfig(
  spec: ViewSpec,
  resource: Resource,
  entityDefinitionId: string
): BuiltViewConfig {
  const {
    patch,
    warnings,
    appliedFilterCount,
    requestedFilterCount,
    validFilters,
    logicalOperator,
  } = buildViewConfigPatch(spec, resource, entityDefinitionId)

  const config: ViewConfig = {
    filters: [],
    sorting: [],
    columnVisibility: {},
    columnOrder: [],
    columnSizing: {},
    viewType: 'table',
    ...patch,
  }

  return {
    config,
    warnings,
    appliedFilterCount,
    requestedFilterCount,
    validFilters,
    logicalOperator,
  }
}
