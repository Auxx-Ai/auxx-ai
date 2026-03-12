// apps/web/src/components/dynamic-table/index.tsx
'use client'

// Re-export ConditionGroup for filter types (new filter system)
export type { ConditionGroup } from '@auxx/lib/conditions/client'
// Export view config schema (for programmatic validation)
export { viewConfigSchema } from '@auxx/lib/conditions/client'
export { PrimaryCell, type PrimaryCellProps } from './cells/primary-cell'
export { PrimaryFieldCell } from './cells/primary-field-cell'
export { BulkActionBar } from './components/bulk-action-bar'
export { CopyableLinkCell } from './components/copyable-link-cell'
export { CustomFieldCell } from './components/custom-field-cell'
export { DragPreview } from './components/drag-preview'
export { DropIndicator } from './components/drop-indicator'
export { DefaultFooterContent, DynamicTableFooter } from './components/dynamic-table-footer'
export { type CellConfig, CellPadding, FormattedCell } from './components/formatted-cell'
export { KanbanViewBody } from './components/kanban-view-body'
// New components from the refactor
export { TableBody } from './components/table-body'
export { TableContentSkeleton } from './components/table-content-skeleton'
export { TableToolbar } from './components/table-toolbar'
export { ToolbarSkeleton } from './components/toolbar-skeleton'
export { useCellSelection } from './context/cell-selection-context'
// Custom field column factory (for syncer-based custom field columns)
export {
  type CustomFieldColumnOptions,
  createCustomFieldColumns,
  getIconForFieldType,
} from './custom-field-column-factory'
// DynamicView is the single entry point - DynamicTable is an alias for backwards compatibility
export { DynamicView, DynamicView as DynamicTable } from './dynamic-view'
export { useCombinedFilters } from './hooks/use-combined-filters'
export { useDynamicTable } from './hooks/use-dynamic-table'
// Re-export types and utilities for convenience
export type {
  BulkAction,
  CellAction,
  CellSelectionConfig,
  CellSelectionState,
  ColumnFormatting,
  CurrencyColumnFormatting,
  DateColumnFormatting,
  DragDropConfig,
  DynamicTableProps,
  ExtendedColumnDef,
  FormattableFieldType,
  KanbanViewConfig,
  NumberColumnFormatting,
  RowSelectionFeatures,
  SortOption,
  TableView,
  ViewAction,
  ViewConfig,
  ViewType,
} from './types'

// Cell renderers and utilities
export {
  EmptyCell,
  getRenderer,
  renderAddressValue,
  renderCellValue,
  renderCheckboxValue,
  renderCurrencyValue,
  renderDateValue,
  renderEmailValue,
  renderFileValue,
  renderNumberValue,
  renderPhoneValue,
  renderRichTextValue,
  renderTextValue,
  renderTimeValue,
  renderUrlValue,
} from './utils/cell-renderers'
// Sort options helper
export {
  ACTIONS_WIDTH,
  CHECKBOX_WIDTH,
  DEFAULT_COLUMN_WIDTHS,
  getSortOptionsForFieldType,
  HEADER_HEIGHT,
  ROW_HEIGHT,
  SORT_OPTIONS,
  TOOLBAR_HEIGHT,
} from './utils/constants'

// Import styles
import './styles/table.css'
