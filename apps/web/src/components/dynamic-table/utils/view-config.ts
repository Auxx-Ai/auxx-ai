// apps/web/src/components/dynamic-table/utils/view-config.ts

import type {
  ColumnOrderState,
  ColumnPinningState,
  ColumnSizingState,
  SortingState,
  VisibilityState,
} from '@tanstack/react-table'
import type {
  ExtendedColumnDef,
  ViewConfig,
  ColumnFormatting,
  KanbanViewConfig,
} from '../types'
import type { ConditionGroup } from '@auxx/lib/conditions/client'

/**
 * Snapshot of the table state that can be persisted as a view configuration.
 */
export interface ViewStateSnapshot {
  sorting?: SortingState
  columnVisibility?: VisibilityState
  columnOrder?: ColumnOrderState
  columnSizing?: ColumnSizingState
  columnPinning?: ColumnPinningState
  columnLabels?: Record<string, string>
  columnFormatting?: Record<string, ColumnFormatting>
  filters?: ConditionGroup[]
}

/**
 * Default configuration builder for new views when no remote config exists.
 */
export interface ViewDefaults {
  columns: ExtendedColumnDef[]
  enableCheckbox?: boolean
  filters?: ConditionGroup[]
}

/**
 * Build a normalized view configuration from the provided table state snapshot.
 */
export function buildViewConfig(snapshot: ViewStateSnapshot): ViewConfig {
  return normalizeViewConfig({
    sorting: snapshot.sorting,
    columnVisibility: snapshot.columnVisibility,
    columnOrder: snapshot.columnOrder,
    columnSizing: snapshot.columnSizing,
    columnPinning: snapshot.columnPinning,
    columnLabels: snapshot.columnLabels,
    columnFormatting: snapshot.columnFormatting,
    filters: snapshot.filters,
  })
}

/**
 * Compute the initial view configuration that should be used when a table has no saved view.
 */
export function computeInitialViewConfig(defaults: ViewDefaults): ViewConfig {
  const columnVisibility: VisibilityState = {}

  defaults.columns.forEach((column) => {
    if (column.defaultVisible !== undefined) {
      const columnId = resolveColumnId(column)
      if (columnId) {
        columnVisibility[columnId] = column.defaultVisible
      }
    }
  })

  const columnPinning = computeDefaultColumnPinning(defaults.columns, defaults.enableCheckbox)

  return normalizeViewConfig({
    filters: defaults.filters ?? [],
    sorting: [],
    columnVisibility,
    columnOrder: [],
    columnSizing: {},
    columnPinning,
  })
}

/**
 * Compute default column pinning based on column definitions.
 * Finds the last column with defaultPinned: true and pins all columns up to it.
 */
function computeDefaultColumnPinning(
  columns: ExtendedColumnDef[],
  enableCheckbox?: boolean
): ColumnPinningState {
  // Find the last column with defaultPinned: true
  let lastPinnedIndex = -1
  columns.forEach((column, index) => {
    if (column.defaultPinned) {
      lastPinnedIndex = index
    }
  })

  // If no defaultPinned columns, just pin checkbox if enabled
  if (lastPinnedIndex === -1) {
    return enableCheckbox ? { left: ['_checkbox'] } : {}
  }

  // Collect all column IDs from start to lastPinnedIndex (inclusive)
  const pinnedColumnIds: string[] = []

  // Add checkbox first if enabled
  if (enableCheckbox) {
    pinnedColumnIds.push('_checkbox')
  }

  // Add all columns up to and including the last pinned one
  for (let i = 0; i <= lastPinnedIndex; i++) {
    const columnId = resolveColumnId(columns[i])
    if (columnId) {
      pinnedColumnIds.push(columnId)
    }
  }

  return { left: pinnedColumnIds }
}

/**
 * Clone filter groups to avoid accidental mutations.
 */
function cloneFilterGroups(groups: ConditionGroup[]): ConditionGroup[] {
  return groups.map((group) => ({
    ...group,
    conditions: group.conditions.map((condition) => ({ ...condition })),
    metadata: group.metadata ? { ...group.metadata } : undefined,
  }))
}

/**
 * Normalise a view configuration to guarantee all optional keys are populated for comparisons.
 */
export function normalizeViewConfig(config?: Partial<ViewConfig> | null): ViewConfig {
  return {
    filters: config?.filters ? cloneFilterGroups(config.filters) : [],
    sorting: config?.sorting ? [...config.sorting] : [],
    columnVisibility: config?.columnVisibility ? { ...config.columnVisibility } : {},
    columnOrder: config?.columnOrder ? [...config.columnOrder] : [],
    columnSizing: config?.columnSizing ? { ...config.columnSizing } : {},
    columnPinning: config?.columnPinning ? cloneColumnPinning(config.columnPinning) : {},
    columnLabels: config?.columnLabels ? { ...config.columnLabels } : {},
    columnFormatting: config?.columnFormatting ? cloneColumnFormatting(config.columnFormatting) : {},
    // Preserve view type (defaults to 'table' for backward compatibility)
    viewType: config?.viewType ?? 'table',
    // Preserve kanban configuration if present
    kanban: config?.kanban ? cloneKanbanConfig(config.kanban) : undefined,
  }
}

/**
 * Clone a kanban configuration to avoid accidental mutations.
 */
function cloneKanbanConfig(kanban: KanbanViewConfig): KanbanViewConfig {
  return {
    groupByFieldId: kanban.groupByFieldId,
    columnOrder: kanban.columnOrder ? [...kanban.columnOrder] : undefined,
    collapsedColumns: kanban.collapsedColumns ? [...kanban.collapsedColumns] : undefined,
    cardFields: kanban.cardFields ? [...kanban.cardFields] : undefined,
    primaryFieldId: kanban.primaryFieldId,
    columnSettings: kanban.columnSettings
      ? Object.fromEntries(
          Object.entries(kanban.columnSettings).map(([k, v]) => [k, { ...v }])
        )
      : undefined,
  }
}

/**
 * Determine whether two view configurations represent the same state.
 */
export function areViewConfigsEqual(a?: Partial<ViewConfig> | null, b?: Partial<ViewConfig> | null): boolean {
  const normalizedA = normalizeViewConfig(a)
  const normalizedB = normalizeViewConfig(b)
  return deepEqual(normalizedA, normalizedB)
}

/**
 * Clone a column pinning configuration to avoid accidental mutations.
 */
function cloneColumnPinning(pinning: ColumnPinningState): ColumnPinningState {
  const next: ColumnPinningState = {}
  if (pinning.left) {
    next.left = [...pinning.left]
  }
  if (pinning.right) {
    next.right = [...pinning.right]
  }
  return next
}

/**
 * Clone column formatting configuration to avoid accidental mutations.
 */
function cloneColumnFormatting(
  formatting: Record<string, ColumnFormatting>
): Record<string, ColumnFormatting> {
  const next: Record<string, ColumnFormatting> = {}
  for (const [key, value] of Object.entries(formatting)) {
    next[key] = { ...value }
  }
  return next
}

/**
 * Resolve a stable column identifier from a column definition.
 */
function resolveColumnId(column: ExtendedColumnDef): string | undefined {
  if (column.id) {
    return column.id
  }
  if ('accessorKey' in column && typeof column.accessorKey === 'string') {
    return column.accessorKey
  }
  return undefined
}

/**
 * Deep comparison helper for the small collection-like structures used in view configs.
 */
function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true
  }

  if (typeof left !== typeof right) {
    return false
  }

  if (left === null || right === null || typeof left !== 'object') {
    return false
  }

  if (left instanceof Date && right instanceof Date) {
    return left.getTime() === right.getTime()
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return false
    }
    for (let index = 0; index < left.length; index += 1) {
      if (!deepEqual(left[index], right[index])) {
        return false
      }
    }
    return true
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    return false
  }

  const leftEntries = Object.entries(left as Record<string, unknown>)
  const rightEntries = Object.entries(right as Record<string, unknown>)

  if (leftEntries.length !== rightEntries.length) {
    return false
  }

  for (const [key, value] of leftEntries) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) {
      return false
    }
    if (!deepEqual(value, (right as Record<string, unknown>)[key])) {
      return false
    }
  }

  return true
}
