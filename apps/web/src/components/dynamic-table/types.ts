// apps/web/src/components/dynamic-table/types.ts

import { type ColumnDef, type Table as TanstackTable } from '@tanstack/react-table'
import { type LucideIcon } from 'lucide-react'
import type { StoreConfig } from '~/components/contacts/drawer/property-provider'
import type { ModelType } from '@auxx/lib/custom-fields/types'

// ============================================================================
// COLUMN FORMATTING TYPES
// ============================================================================

/**
 * Currency formatting options for column display override
 */
export interface CurrencyColumnFormatting {
  type: 'currency'
  currencyCode?: string
  decimalPlaces?: 'two-places' | 'no-decimal'
  displayType?: 'symbol' | 'name' | 'code'
  groups?: 'default' | 'no-groups'
}

/**
 * Date formatting options for column display override
 */
export interface DateColumnFormatting {
  type: 'date'
  format?: 'short' | 'medium' | 'long' | 'relative' | 'iso'
  includeTime?: boolean
}

/**
 * Number formatting options for column display override
 */
export interface NumberColumnFormatting {
  type: 'number'
  decimalPlaces?: number
  useGrouping?: boolean
  displayAs?: 'number' | 'percentage' | 'compact' | 'bytes'
  prefix?: string
  suffix?: string
}

/**
 * Union type for all column formatting options
 */
export type ColumnFormatting =
  | CurrencyColumnFormatting
  | DateColumnFormatting
  | NumberColumnFormatting

/**
 * Field types that support formatting
 */
export const FORMATTABLE_FIELD_TYPES = ['CURRENCY', 'DATE', 'DATETIME', 'TIME', 'NUMBER'] as const
export type FormattableFieldType = (typeof FORMATTABLE_FIELD_TYPES)[number]

// ============================================================================
// CELL SELECTION TYPES
// ============================================================================

/** Cell selection state */
export interface CellSelectionState {
  rowId: string
  columnId: string
}

/** Cell selection configuration */
export interface CellSelectionConfig {
  /** Enable cell selection mode */
  enabled: boolean
  /** Callback when cell value changes (legacy path) */
  onCellValueChange?: (rowId: string, columnId: string, value: unknown) => Promise<void>
  /** Get field definition for a column (for FieldInput) */
  getFieldDefinition?: (columnId: string) => any
  /** Get cell value for editing */
  getCellValue?: (rowId: string, columnId: string) => any
  /** Get store configuration for a row (enables optimistic updates) */
  getStoreConfig?: (rowId: string) => StoreConfig | undefined
}

/**
 * Extended column definition with additional metadata
 */
export type ExtendedColumnDef<TData = any> = ColumnDef<TData> & {
  /** Column data type for appropriate filtering and sorting */
  columnType?: 'text' | 'number' | 'date' | 'boolean' | 'select' | 'email' | 'phone' | 'currency' | 'custom'
  /** Icon to display in column header */
  icon?: LucideIcon
  /** Enable/disable sorting for this column */
  enableSorting?: boolean
  /** Enable/disable filtering for this column */
  enableFiltering?: boolean
  /** Enable/disable column resizing */
  enableResize?: boolean
  /** Enable/disable column reordering */
  enableReorder?: boolean
  /** Minimum column width in pixels */
  minSize?: number
  /** Maximum column width in pixels */
  maxSize?: number
  /** Default visibility state */
  defaultVisible?: boolean
  /** Pin this column to the left by default (when no saved view exists) */
  defaultPinned?: boolean
  /** Field type from custom fields (for formatting support) */
  fieldType?: string
  /** Default formatting options from field definition */
  defaultFormatting?: Partial<ColumnFormatting>
}

/**
 * Filter operators for different column types
 */
export type TextFilterOperator =
  | 'contains'
  | 'notContains'
  | 'is'
  | 'isNot'
  | 'isEmpty'
  | 'isNotEmpty'

export type NumberFilterOperator =
  | 'equals'
  | 'notEquals'
  | 'greaterThan'
  | 'lessThan'
  | 'greaterThanOrEqual'
  | 'lessThanOrEqual'
  | 'isEmpty'
  | 'isNotEmpty'

export type DateFilterOperator =
  | 'is'
  | 'isNot'
  | 'before'
  | 'after'
  | 'onOrBefore'
  | 'onOrAfter'
  | 'isEmpty'
  | 'isNotEmpty'

export type BooleanFilterOperator = 'is' | 'isNot'

export type FilterOperator =
  | TextFilterOperator
  | NumberFilterOperator
  | DateFilterOperator
  | BooleanFilterOperator

/**
 * Table filter configuration
 */
export interface TableFilter {
  id: string
  columnId: string
  operator: FilterOperator
  value: any
}

/**
 * Table view configuration
 */
export interface TableView {
  id: string
  name: string
  tableId: string
  isDefault?: boolean
  isShared?: boolean
  config: ViewConfig
  createdAt?: Date
  updatedAt?: Date
}

// ============================================================================
// VIEW TYPE AND KANBAN CONFIGURATION
// ============================================================================

/** View type - table or kanban */
export type ViewType = 'table' | 'kanban'

/** Per-column view settings (stored in view config) */
export interface KanbanColumnSettings {
  /** Hide this column in the current view */
  isVisible?: boolean // defaults to true if undefined
}

/** Target time configuration for kanban columns (stored in field options) */
export interface TargetTimeInStatus {
  value: number
  unit: 'days' | 'months' | 'years'
}

/** Kanban-specific configuration */
export interface KanbanViewConfig {
  /** ID of the SINGLE_SELECT custom field used for columns */
  groupByFieldId: string
  /** Column order (option IDs from the SINGLE_SELECT field) */
  columnOrder?: string[]
  /** Collapsed columns */
  collapsedColumns?: string[]
  /** Card display settings - field IDs to show on cards */
  cardFields?: string[]
  /** Primary display field ID (for card title) */
  primaryFieldId?: string
  /** Column-specific view settings keyed by column value */
  columnSettings?: Record<string, KanbanColumnSettings>
}

/**
 * View configuration details
 */
export interface ViewConfig {
  filters: TableFilter[]
  sorting: Array<{ id: string; desc: boolean }>
  columnVisibility: Record<string, boolean>
  columnOrder: string[]
  columnSizing: Record<string, number>
  columnPinning?: { left?: string[]; right?: string[] }
  columnLabels?: Record<string, string>
  columnFormatting?: Record<string, ColumnFormatting>

  /** View type (defaults to 'table' for backward compatibility) */
  viewType?: ViewType
  /** Kanban config (only used when viewType === 'kanban') */
  kanban?: KanbanViewConfig
}

/**
 * Bulk action configuration
 */
export interface BulkAction<TData = any> {
  /** Action label */
  label: string
  /** Action icon */
  icon?: LucideIcon
  /** Action handler */
  action: (rows: TData[]) => void | Promise<void>
  /** Button variant */
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost'
  /** Disable condition */
  disabled?: (rows: TData[]) => boolean
  /** Hide condition */
  hidden?: (rows: TData[]) => boolean
}

/**
 * Row selection features configuration
 */
export interface RowSelectionFeatures {
  /** Show row numbers when not hovering */
  showRowNumbers?: boolean
  /** Show checkboxes only on hover */
  showCheckboxesOnHover?: boolean
  /** Enable range selection with Shift+click */
  enableRangeSelection?: boolean
  /** Enable toggle selection with Ctrl/Cmd+click */
  enableToggleSelection?: boolean
  /** Enable row starring/favoriting */
  enableStarring?: boolean
  /** Set of starred row IDs */
  starredRows?: Set<string>
  /** Star toggle handler */
  onStarToggle?: (rowId: string) => void
}

/**
 * Main dynamic table props
 */
export interface DynamicTableProps<TData = any> {
  // Core
  /** Table data */
  data: TData[]
  /** Column definitions */
  columns: ExtendedColumnDef<TData>[]

  // Features
  /** Enable filtering */
  enableFiltering?: boolean
  /** Enable sorting */
  enableSorting?: boolean
  /** Enable column reordering */
  enableColumnReorder?: boolean
  /** Row selection configuration */
  rowSelectionFeatures?: RowSelectionFeatures
  /** Enable global search */
  enableSearch?: boolean
  /** Search placeholder text */
  searchPlaceholder?: string
  /** Keys to search in for global search */
  searchKeys?: string[]
  /** Show row numbers when checkbox is enabled */
  showRowNumbers?: boolean
  /** Callback when row selection changes */
  onRowSelectionChange?: (selectedRows: Set<string>) => void
  /** Controlled row selection state (row IDs that are selected) */
  rowSelection?: Set<string>

  // Customization
  /** Unique table identifier for view persistence */
  tableId: string
  /** Bulk actions configuration (enables checkbox and bulk actions when provided) */
  bulkActions?: BulkAction<TData>[]
  /** Row click handler with enhanced parameters */
  onRowClick?: (
    row: TData,
    event: React.MouseEvent,
    rowId: string,
    table: import('@tanstack/react-table').Table<TData>
  ) => void
  /** Custom row ID getter */
  getRowId?: (row: TData) => string

  // Server-side
  /** Loading state */
  isLoading?: boolean
  /** Total page count for pagination */
  pageCount?: number
  /** Pagination change handler */
  onPaginationChange?: (pagination: any) => void

  // Styling
  /** Additional CSS classes */
  className?: string
  /** Custom row className */
  rowClassName?: (row: TData) => string
  /** Show footer */
  showFooter?: boolean
  /** Hide toolbar (default: false) */
  hideToolbar?: boolean

  // Import/Export
  /** Import handler (legacy - triggers file picker) */
  onImport?: (file: File) => Promise<void>
  /** Import page URL (navigates to import page) */
  importHref?: string
  /** Refresh handler (enables refresh button when provided) */
  onRefresh?: () => void
  /** Export handler */
  onExport?: (rows: TData[]) => void

  // Column visibility callback (for syncer integration)
  /** Callback when column visibility changes (used for custom field value syncer) */
  onColumnVisibilityChange?: (visibility: Record<string, boolean>) => void

  // Custom components
  /** Custom filter component rendered before search input */
  customFilter?: React.ReactNode

  // Scroll
  /** Callback when scrolling to bottom */
  onScrollToBottom?: () => void

  // Row tracking
  /** Get last clicked row ID */
  getLastClickedRowId?: () => string | null

  emptyState?: React.ReactNode

  /** React node to render after the last column header (e.g., add column button) */
  headerActions?: React.ReactNode

  // Children
  /** Children elements (e.g., DynamicTableFooter) */
  children?: React.ReactNode

  /** Drag and drop configuration */
  dragDrop?: DragDropConfig<TData>

  /** Debug options for drag and drop collision detection */
  debug?: {
    /** Enable debug visualization */
    enabled?: boolean
    /** Show collision rectangles */
    showRects?: boolean
    /** Show collision points/centers */
    showCenters?: boolean
    /** Show distances between elements */
    showDistances?: boolean
  }

  /** Cell selection configuration */
  cellSelection?: CellSelectionConfig

  /** SINGLE_SELECT fields for kanban view grouping */
  selectFields?: Array<{
    id: string
    name: string
    options?: { options?: Array<{ id: string; label: string; color?: string }> }
  }>

  /** Model type for creating new fields: 'contact', 'ticket', 'entity', etc. */
  modelType?: ModelType

  /** Entity definition ID - required only when modelType is 'entity' */
  entityDefinitionId?: string
}

/**
 * Filter operator configuration
 */
export interface FilterOperatorConfig {
  value: FilterOperator
  label: string
  requiresValue: boolean
}

/**
 * Column type configuration
 */
export interface ColumnTypeConfig {
  type: ExtendedColumnDef['columnType']
  operators: FilterOperatorConfig[]
  defaultOperator: FilterOperator
  inputType?: 'text' | 'number' | 'date' | 'select' | 'boolean'
  formatValue?: (value: any) => string
  parseValue?: (value: string) => any
}

/**
 * Sort option configuration
 */
export interface SortOption {
  value: 'asc' | 'desc'
  label: string
  icon: LucideIcon
}

/**
 * Table state
 */
export interface TableState<TData = any> {
  table: TanstackTable<TData>
  views: TableView[]
  currentView: TableView | null
  isLoadingViews: boolean
  searchQuery: string
}

/**
 * View action types
 */
export type ViewAction = 'duplicate' | 'rename' | 'delete' | 'setDefault'

/**
 * Cell action configuration
 */
export interface CellAction {
  icon: LucideIcon
  label: string
  onClick: () => void
  showOnHover?: boolean
  delay?: number
}

/**
 * Drop position for drag and drop operations
 */
export type DropPosition = 'inside' | 'before' | 'after'

/**
 * External drop target for drops outside the table
 */
export type ExternalDropTarget = {
  id: string
  type: string // e.g. 'breadcrumb'
  data?: unknown
}

/**
 * Drag and drop configuration for table rows
 */
export interface DragDropConfig<TData = any> {
  /** Enable drag-and-drop functionality */
  enabled: boolean
  
  /** Determines if a row can be dragged */
  canDrag?: (row: TData) => boolean
  
  /** Determines if a row can accept drops */
  canDrop?: (draggedItems: TData[], targetRow: TData) => boolean
  
  /** Called when items are dropped */
  onDrop?: (draggedItems: TData[], targetRow: TData, dropPosition: DropPosition) => Promise<void> | void
  
  /** Custom drag preview component */
  dragPreview?: React.ComponentType<{ items: TData[]; isDragging: boolean }>
  
  /** Visual feedback for drop zones */
  dropIndicator?: React.ComponentType<{ isActive: boolean; position: DropPosition }>
  
  /** Function to get currently selected items for multi-select drag */
  getSelectedItems?: (currentRow: TData) => TData[]
  
  /** NEW: run table DnD in a parent DndContext */
  externalDnd?: boolean
  
  /** NEW: lifecycle hooks for cross-component coordination */
  onDragStart?: (items: TData[]) => void
  onDragMove?: (items: TData[]) => void
  onDragCancel?: () => void
  onDragEnd?: (result: { items: TData[]; over?: ExternalDropTarget | { type: 'row'; item: TData } }) => void
  
  /** NEW: handle drops outside the table (e.g., breadcrumbs) */
  onDropExternal?: (items: TData[], target: ExternalDropTarget) => Promise<void> | void
  
  /** NEW: map dnd-kit's `over` to a target object your app understands */
  getExternalTargetData?: (over: import('@dnd-kit/core').Over) => ExternalDropTarget | null
}
