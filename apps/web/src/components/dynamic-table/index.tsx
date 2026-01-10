// apps/web/src/components/dynamic-table/index.tsx
'use client'

// Re-export types and utilities for convenience
export type {
  DynamicTableProps,
  ExtendedColumnDef,
  TableView,
  ViewConfig,
  ViewType,
  KanbanViewConfig,
  BulkAction,
  RowSelectionFeatures,
  SortOption,
  CellAction,
  ViewAction,
  DragDropConfig,
  CellSelectionState,
  CellSelectionConfig,
  ColumnFormatting,
  CurrencyColumnFormatting,
  DateColumnFormatting,
  NumberColumnFormatting,
  FormattableFieldType,
} from './types'

// Re-export ConditionGroup for filter types (new filter system)
export type { ConditionGroup } from '@auxx/lib/conditions/client'

// Export view config schema (for programmatic validation)
export { viewConfigSchema } from '@auxx/lib/conditions'

// DynamicView is the single entry point - DynamicTable is an alias for backwards compatibility
export { DynamicView } from './dynamic-view'
export { DynamicView as DynamicTable } from './dynamic-view'

export {
  SORT_OPTIONS,
  ROW_HEIGHT,
  TOOLBAR_HEIGHT,
  HEADER_HEIGHT,
  CHECKBOX_WIDTH,
  ACTIONS_WIDTH,
  DEFAULT_COLUMN_WIDTHS,
} from './utils/constants'

export { useDynamicTable } from './hooks/use-dynamic-table'
export { useCombinedFilters } from './hooks/use-combined-filters'
export { useTableContext } from './context/table-context'
export { useCellSelection } from './context/cell-selection-context'
export { DynamicTableFooter, DefaultFooterContent } from './components/dynamic-table-footer'
export { BulkActionBar } from './components/bulk-action-bar'
export { TableToolbar } from './components/table-toolbar'
export { DropIndicator } from './components/drop-indicator'
export { DragPreview } from './components/drag-preview'
export { FormattedCell, CellPadding, type CellConfig } from './components/formatted-cell'
export { CustomFieldCell } from './components/custom-field-cell'
export { CopyableLinkCell } from './components/copyable-link-cell'
export { PrimaryCell, type PrimaryCellProps } from './cells/primary-cell'
export { PrimaryFieldCell } from './cells/primary-field-cell'

// New components from the refactor
export { TableBody } from './components/table-body'
export { KanbanViewBody } from './components/kanban-view-body'
export { TableContentSkeleton } from './components/table-content-skeleton'
export { ToolbarSkeleton } from './components/toolbar-skeleton'

// Cell renderers and utilities
export {
  renderCellValue,
  renderDateValue,
  renderTimeValue,
  renderNumberValue,
  renderCurrencyValue,
  renderEmailValue,
  renderPhoneValue,
  renderUrlValue,
  renderCheckboxValue,
  renderAddressValue,
  renderRichTextValue,
  renderFileValue,
  renderTextValue,
  EmptyCell,
  getRenderer,
} from './utils/cell-renderers'

// Custom field column factory (for syncer-based custom field columns)
export {
  createCustomFieldColumns,
  getIconForFieldType,
  type CustomFieldColumnOptions,
} from './custom-field-column-factory'

// Sort options helper
export { getSortOptionsForFieldType } from './utils/constants'

// Import styles
import './styles/table.css'
