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

/** Column id used by the records table store + saved views for a field. */
export function fieldColumnId(field: ResourceField, entityDefinitionId: string): string {
  return field.resourceFieldId ?? toResourceFieldId(entityDefinitionId, toFieldId(field.id))
}

function findField(resource: Resource, identifier: string): ResourceField | undefined {
  return resource.fields.find(
    (f) => f.systemAttribute === identifier || f.key === identifier || f.id === identifier
  )
}

export function buildViewConfig(
  spec: ViewSpec,
  resource: Resource,
  entityDefinitionId: string
): BuiltViewConfig {
  const requested = spec.filters ?? []
  const { valid, warnings } = validateFilters(requested, resource)

  // Records view filters key on a single column id — drop relationship paths.
  const directFilters: SimplifiedFilter[] = []
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

  const filters: ConditionGroup[] =
    conditions.length > 0
      ? [{ id: 'kopilot-view', conditions, logicalOperator: spec.logicalOperator ?? 'AND' }]
      : []

  // Sort
  const sorting: Array<{ id: string; desc: boolean }> = []
  if (spec.sort) {
    const field = findField(resource, spec.sort.field)
    if (field) {
      sorting.push({
        id: fieldColumnId(field, entityDefinitionId),
        desc: spec.sort.direction === 'desc',
      })
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
  let columnVisibility: Record<string, boolean> = {}
  let columnOrder: string[] = []
  if (spec.columns && spec.columns.length > 0) {
    const wanted = new Set<string>()
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
      columnVisibility = Object.fromEntries(
        resource.fields.map((f) => [
          fieldColumnId(f, entityDefinitionId),
          wanted.has(fieldColumnId(f, entityDefinitionId)),
        ])
      )
    } else {
      columnOrder = []
    }
  }

  const config: ViewConfig = {
    filters,
    sorting,
    columnVisibility,
    columnOrder,
    columnSizing: {},
    viewType: 'table',
  }

  return {
    config,
    warnings,
    appliedFilterCount: conditions.length,
    requestedFilterCount: requested.length,
    validFilters: directFilters,
    logicalOperator: spec.logicalOperator ?? 'AND',
  }
}
