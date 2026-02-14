// apps/web/src/components/dynamic-table/types.ts

import type { FieldType } from '@auxx/database/types'
import type { RecordId } from '@auxx/lib/resources/client'
import type { TargetTimeInStatus } from '@auxx/types/custom-field'
import type { FieldPath } from '@auxx/types/field'
import type { ColumnDef, Table as TanstackTable } from '@tanstack/react-table'
import type { LucideIcon } from 'lucide-react'

// Re-export TargetTimeInStatus for backward compatibility
export type { TargetTimeInStatus }

// ============================================================================
// COLUMN FORMATTING & VIEW CONFIG TYPES (from schema - single source of truth)
// ============================================================================

// Re-export types from schema (inferred from Zod = always in sync with validation)
export type {
  CheckboxColumnFormatting,
  ColumnFormatting,
  CurrencyColumnFormatting,
  DateColumnFormatting,
  KanbanColumnSettings,
  KanbanViewConfig,
  NumberColumnFormatting,
  PhoneColumnFormatting,
  ViewConfig,
  ViewType,
} from '@auxx/lib/conditions'

/**
 * Field types that support formatting
 */
export const FORMATTABLE_FIELD_TYPES = [
  'CURRENCY',
  'DATE',
  'DATETIME',
  'TIME',
  'NUMBER',
  'PHONE_INTL',
  'CHECKBOX',
] as const
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
  /** Get field definition for a column (for FieldInput) */
  getFieldDefinition?: (columnId: string) => ResourceField | null
  /** Get cell value for editing */
  getCellValue?: (rowId: string, columnId: string) => any
  /** Get RecordId for a row (required for optimistic updates when editing) */
  getRecordId?: (rowId: string) => RecordId
}

/**
 * Extended column definition with additional metadata
 */
export type ExtendedColumnDef<TData = any> = ColumnDef<TData> & {
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
  /** Mark this column as primary (pins left by default, can show 'New' button) */
  primaryCell?: boolean
  /** Field type - determines sorting options, cell rendering, and formatting support */
  fieldType?: FieldType
  /** Default formatting options from field definition */
  defaultFormatting?: Partial<ColumnFormatting>
  /** Additional column metadata */
  meta?: {
    /** Whether this is a custom field column */
    isCustomField?: boolean
    /** Unprefixed field ID for custom fields */
    fieldId?: string
    /** Field path for relationship fields */
    fieldPath?: FieldPath
    /** Extensible for other metadata */
    [key: string]: any
  }
}

/**
 * Table view configuration
 */
export interface TableView {
  id: string
  name: string
  tableId: string
  /** Context type: 'table' | 'kanban' | 'panel' | 'dialog_create' | 'dialog_edit' */
  contextType?: string
  isDefault?: boolean
  isShared?: boolean
  config: ViewConfig
  createdAt?: Date
  updatedAt?: Date
}

// ============================================================================
// KANBAN UI TYPES (not in schema - UI-only)
// ============================================================================

/** Column ID for items without a status value */
export const NO_STATUS_COLUMN_ID = '__no_status__'

/** Generic row data for kanban cards */
export interface KanbanRow {
  id: string
  updatedAt?: string | Date
  customFieldValues?: Array<{
    fieldId: string
    value: unknown
  }>
  [key: string]: unknown
}

/** Normalized option for kanban columns (with id instead of value) */
export interface KanbanSelectOption {
  id: string
  label: string
  color?: string
  /** Target time for items to remain in this status */
  targetTimeInStatus?: TargetTimeInStatus
  /** Trigger celebration animation when cards move to this column */
  celebration?: boolean
}

// Use ResourceField directly from lib (no transformation needed)
import type { ResourceField } from '@auxx/lib/resources/client'

/** Custom field type for kanban - now uses ResourceField directly */
export type CustomField = ResourceField & { id: string }
export type { ResourceField }

/** @deprecated Use CustomField or ResourceField instead */
export type KanbanCustomField = CustomField

/** Drag item type for kanban DnD */
export type KanbanDragItemType = 'card' | 'column'

/**
 * Bulk action configuration
 */
export interface BulkAction<TData = any> {
  /** Unique identifier for the action */
  id?: string
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

  /** Entity label for "New X" buttons in kanban */
  entityLabel?: string

  /** Callback when "New" button is clicked in primary column header */
  onAddNew?: () => void

  /** Callback when kanban card is clicked */
  onCardClick?: (card: TData) => void

  /** Callback to add a new card in a kanban column */
  onAddCard?: (columnId: string) => void

  /** Selected kanban card IDs (controlled) */
  selectedKanbanCardIds?: Set<string>

  /** Callback when kanban card selection changes */
  onSelectedKanbanCardIdsChange?: (ids: Set<string>) => void

  /** Entity definition ID for field creation */
  entityDefinitionId?: string

  /** Standalone mode - bypasses view store initialization, useful for preview tables */
  standalone?: boolean
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
  onDrop?: (
    draggedItems: TData[],
    targetRow: TData,
    dropPosition: DropPosition
  ) => Promise<void> | void

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
  onDragEnd?: (result: {
    items: TData[]
    over?: ExternalDropTarget | { type: 'row'; item: TData }
  }) => void

  /** NEW: handle drops outside the table (e.g., breadcrumbs) */
  onDropExternal?: (items: TData[], target: ExternalDropTarget) => Promise<void> | void

  /** NEW: map dnd-kit's `over` to a target object your app understands */
  getExternalTargetData?: (over: import('@dnd-kit/core').Over) => ExternalDropTarget | null
}
