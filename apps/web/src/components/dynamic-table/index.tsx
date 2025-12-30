// apps/web/src/components/dynamic-table/index.tsx
'use client'

// Re-export types and utilities for convenience
export type {
  DynamicTableProps,
  ExtendedColumnDef,
  TableFilter,
  TableView,
  ViewConfig,
  ViewType,
  KanbanViewConfig,
  BulkAction,
  RowSelectionFeatures,
  FilterOperator,
  TextFilterOperator,
  NumberFilterOperator,
  DateFilterOperator,
  BooleanFilterOperator,
  ColumnTypeConfig,
  FilterOperatorConfig,
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

// DynamicView is the single entry point - DynamicTable is an alias for backwards compatibility
export { DynamicView } from './dynamic-view'
export { DynamicView as DynamicTable } from './dynamic-view'

export {
  FILTER_OPERATORS,
  COLUMN_TYPE_CONFIGS,
  SORT_OPTIONS,
  COLUMN_TYPE_ICONS,
  ROW_HEIGHT,
  DEFAULT_COLUMN_WIDTHS,
} from './utils/constants'

export { useDynamicTable } from './hooks/use-dynamic-table'
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

// New components from the refactor
export { TableBody } from './components/table-body'
export { KanbanViewBody } from './components/kanban-view-body'

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

// Column helpers
export {
  createDateColumn,
  createCurrencyColumn,
  createNumberColumn,
  createEmailColumn,
  createPhoneColumn,
  createUrlColumn,
  createTextColumn,
} from './utils/column-helpers'

// Custom field column factory (for syncer-based custom field columns)
export {
  createCustomFieldColumns,
  mapFieldTypeToColumnType,
  getIconForFieldType,
  type CustomFieldColumnOptions,
} from './custom-field-column-factory'

// Import styles
import './styles/table.css'
