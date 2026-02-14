// apps/web/src/components/dynamic-table/stores/store-types.ts

import type { ConditionGroup, ViewContextType } from '@auxx/lib/conditions/client'
import type {
  ColumnOrderState,
  ColumnPinningState,
  ColumnSizingState,
  SortingState,
  VisibilityState,
} from '@tanstack/react-table'
import type { StateCreator } from 'zustand'
import type { ColumnFormatting, KanbanViewConfig, TableView, ViewConfig } from '../types'

// ============================================================================
// UI CONFIG TYPE (everything except filters)
// ============================================================================

/** UI configuration for a table view (everything EXCEPT filters) */
export interface TableUIConfig {
  sorting: SortingState
  columnVisibility: VisibilityState
  columnOrder: ColumnOrderState
  columnSizing: ColumnSizingState
  columnPinning?: ColumnPinningState
  columnLabels?: Record<string, string>
  columnFormatting?: Record<string, ColumnFormatting>
  rowHeight?: 'compact' | 'normal' | 'spacious'
  viewType?: 'table' | 'kanban'
  kanban?: KanbanViewConfig
}

/** Default UI config */
export const DEFAULT_UI_CONFIG: TableUIConfig = {
  sorting: [],
  columnVisibility: {},
  columnOrder: [],
  columnSizing: {},
  viewType: 'table',
}

// ============================================================================
// SLICE INTERFACES
// ============================================================================

/** View slice - manages view metadata and selection */
export interface ViewSlice {
  viewsByTableId: Record<string, TableView[]>
  activeViewIds: Record<string, string | null>
  savingViewIds: Set<string>
  initialized: boolean
  error: Error | null

  setAllViews: (views: TableView[]) => void
  setTableViews: (tableId: string, views: TableView[]) => void
  setActiveView: (tableId: string, viewId: string | null) => void
  setInitialized: (value: boolean) => void
  setError: (error: Error | null) => void
  addView: (view: TableView) => void
  removeView: (viewId: string, tableId: string) => void
  updateViewMeta: (
    viewId: string,
    meta: Partial<Pick<TableView, 'name' | 'isDefault' | 'isShared'>>
  ) => void
  startSaving: (viewId: string) => void
  finishSaving: (viewId: string) => void
  /** Toggle field visibility in a field view (optimistic update) */
  toggleFieldVisibility: (
    tableId: string,
    contextType: ViewContextType,
    resourceFieldId: string,
    visible: boolean
  ) => void
  /** Reorder a field in a field view (optimistic update) */
  reorderFieldInView: (
    tableId: string,
    contextType: ViewContextType,
    fromIndex: number,
    toIndex: number
  ) => void
}

/** UI slice - manages visual/layout config */
export interface UISlice {
  viewConfigs: Record<string, TableUIConfig>
  pendingConfigs: Record<string, Partial<TableUIConfig>>
  sessionConfigs: Record<string, TableUIConfig>

  setViewConfig: (viewId: string, config: TableUIConfig) => void
  updateViewConfig: (viewId: string, changes: Partial<TableUIConfig>) => void
  updateSessionConfig: (tableId: string, changes: Partial<TableUIConfig>) => void
  updateKanbanConfig: (viewId: string, changes: Partial<KanbanViewConfig>) => void
  resetToSaved: (viewId: string) => void
  getSessionConfig: (tableId: string) => TableUIConfig
}

/** Filter slice - manages filter conditions */
export interface FilterSlice {
  viewFilters: Record<string, ConditionGroup[]>
  sessionFilters: Record<string, ConditionGroup[]>

  setViewFilters: (viewId: string, filters: ConditionGroup[]) => void
  setSessionFilters: (tableId: string, filters: ConditionGroup[]) => void
  clearSessionFilters: (tableId: string) => void
}

/** Shared slice - dirty tracking, coordination, computed getters */
export interface SharedSlice {
  dirtyViewIds: Set<string>

  markDirty: (viewId: string) => void
  markClean: (viewId: string) => void
  isDirty: (viewId: string) => boolean
  isSaving: (viewId: string) => boolean
  hasUnsavedChanges: (viewId: string) => boolean

  confirmSave: (viewId: string, savedConfig: ViewConfig) => void
  resetViewChanges: (viewId: string) => void
  clearAll: () => void

  getActiveViewId: (tableId: string) => string | null
  getActiveView: (tableId: string) => TableView | null
  getActiveViewConfig: (tableId: string) => ViewConfig | null
  getActiveFilters: (tableId: string) => ConditionGroup[]
}

// ============================================================================
// COMBINED STORE
// ============================================================================

/** Combined dynamic table store */
export type DynamicTableStore = ViewSlice & UISlice & FilterSlice & SharedSlice

/** Middleware types for slice creators */
type Middlewares = [['zustand/subscribeWithSelector', never], ['zustand/immer', never]]

/** Slice creator type with middleware support */
export type SliceCreator<T> = StateCreator<DynamicTableStore, Middlewares, [], T>
