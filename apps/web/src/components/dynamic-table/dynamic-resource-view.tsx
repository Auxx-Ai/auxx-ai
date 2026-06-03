// apps/web/src/components/dynamic-table/dynamic-resource-view.tsx
'use client'

import type { FieldType } from '@auxx/database/types'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import type { RecordId, ResourceField } from '@auxx/lib/resources/client'
import { toFieldId, toResourceFieldId } from '@auxx/types/field'
import Loader from '@auxx/ui/components/loader'
import { type DockedPanelConfig, MainPageContent } from '@auxx/ui/components/main-page'
import { type MutableRefObject, type ReactNode, useCallback, useEffect, useMemo } from 'react'
import { type RecordMeta, toRecordId, useRecordList, useResource } from '~/components/resources'
import { useFieldValueSyncer } from '~/components/resources/hooks/use-field-value-syncer'
import type {
  FieldReference,
  StoredFieldValue,
} from '~/components/resources/store/field-value-store'
import { CustomFieldCell } from './components/custom-field-cell'
import { DynamicTableFooter } from './components/dynamic-table-footer'
import { getIconForFieldType } from './custom-field-column-factory'
import { DynamicView } from './dynamic-view'
import { useColumnVisibility, useTableFilters, useTableSorting } from './stores/store-selectors'
import type { BulkAction, CellSelectionConfig, ExtendedColumnDef } from './types'

/** Page size for the infinite query. Matches the prior records-view page size. */
const PAGE_SIZE = 100

/**
 * Imperative handle exposed via ref.
 *
 * `getValue` reads from the field-value store populated by the internal
 * syncer — useful for callers building a cellSelection config that needs to
 * read currently-rendered cell values. NOTE: the primary column has its own
 * useFieldValue subscription via PrimaryFieldCell (not part of the syncer),
 * so getValue does not include the primary cell.
 */
export interface DynamicResourceViewHandle {
  refresh: () => void
  getValue: (recordId: RecordId, fieldRef: FieldReference) => StoredFieldValue | undefined
}

export interface DynamicResourceViewProps<TRow extends RecordMeta = RecordMeta> {
  /**
   * Optional ref the component writes its imperative handle into on mount.
   * Callers use this to trigger refresh or read field-values for cell config.
   */
  viewRef?: MutableRefObject<DynamicResourceViewHandle | null>
  /** Resource slug — resolved to a Resource via useResource(). */
  slug: string
  /** Table identifier for saved-view persistence. Default: `entity-${resource.id}`. */
  tableId?: string
  /**
   * Baseline filter — AND-merged with the user's filters at query time.
   * Always applied; never visible to the filter UI; not user-removable.
   */
  baselineFilter?: ConditionGroup
  /** Render the primary-column cell body for a row. */
  primaryCellRender: (row: TRow) => ReactNode
  /** Optional per-field column overrides applied on top of the generic column. */
  columnOverrides?: (
    field: ResourceField & { id: string }
  ) => Partial<ExtendedColumnDef<TRow>> | undefined
  /** Cell selection / paste / fill / AI config. Omit to disable entirely. */
  cellSelection?: CellSelectionConfig
  /** Bulk actions surfaced in the floating action bar. */
  bulkActions?: BulkAction<TRow>[]
  /** Custom search bar rendered in the toolbar search slot. */
  renderSearchBar?: () => ReactNode
  /** Component shown when the records list is empty. */
  emptyState: ReactNode
  /** Docked side panels (e.g. the record drawer when docked). */
  dockedPanels?: DockedPanelConfig[]
  /**
   * Skip the `MainPageContent` (PanelFrame) wrapper. Use when the caller already
   * provides the page-content frame — e.g. `ArticlesView` mounted inside
   * `KBLandingShell`'s tab strip — so the rounded card isn't double-rendered.
   * Docked panels are not supported in embedded mode.
   */
  embedded?: boolean
  /** Selection change callback (passthrough from DynamicView). */
  onRowSelectionChange?: (rows: Set<string>) => void
  /** Add-new button handler (primary column "+ New" / empty-state CTA). */
  onAddNew?: () => void
  /** Optional override for the kanban "New X" label (defaults to resource.label). */
  entityLabel?: string
  /** Kanban card click handler. */
  onCardClick?: (row: TRow) => void
  /** Kanban add-card handler. */
  onAddCard?: (columnId: string) => void
  /** Controlled kanban card selection. */
  selectedKanbanCardIds?: Set<string>
  onSelectedKanbanCardIdsChange?: (ids: Set<string>) => void
  /** Optional import page URL surfaced in the toolbar. */
  importHref?: string
}

export function DynamicResourceView<TRow extends RecordMeta = RecordMeta>({
  viewRef,
  slug,
  tableId: tableIdProp,
  baselineFilter,
  primaryCellRender,
  columnOverrides,
  cellSelection,
  bulkActions,
  renderSearchBar,
  emptyState,
  dockedPanels,
  embedded = false,
  onRowSelectionChange,
  onAddNew,
  entityLabel,
  onCardClick,
  onAddCard,
  selectedKanbanCardIds,
  onSelectedKanbanCardIdsChange,
  importHref,
}: DynamicResourceViewProps<TRow>) {
  const { resource, isLoading } = useResource(slug)

  // INVARIANT: rowId → RecordId mapping is `toRecordId(resource.id, rowId)`.
  // BulkUpdateEntityInstanceDialog derives entityDefinitionId from recordIds[0]
  // — callers must build RecordIds the same way for shared dialogs to work.
  const entityDefinitionId = resource?.id

  // Hidden fields never show up — no column, no chooser entry.
  const customFields = useMemo(
    () =>
      resource?.fields.filter(
        (f): f is ResourceField & { id: string } => !!f.id && !f.capabilities.hidden
      ) ?? [],
    [resource?.fields]
  )

  const tableId = tableIdProp ?? `entity-${entityDefinitionId}`

  const viewFilters = useTableFilters(tableId)
  const viewSorting = useTableSorting(tableId)
  const storeColumnVisibility = useColumnVisibility(tableId)

  // Baseline + store filters. Baseline stays a separate ConditionGroup so the
  // filter UI cannot see or edit it; the query layer ANDs groups together.
  const filtersForQuery = useMemo(() => {
    const groups: ConditionGroup[] = []
    if (baselineFilter) groups.push(baselineFilter)
    groups.push(...viewFilters)
    return groups.length > 0 ? groups : undefined
  }, [baselineFilter, viewFilters])
  const sortingForQuery = viewSorting.length > 0 ? viewSorting : undefined

  // Config-ready gate — `useColumnVisibility` returns `undefined` until the
  // store hydrates. Without this gate every mount fires a double `listFiltered`.
  const isConfigReady = storeColumnVisibility !== undefined

  const {
    records,
    isLoading: instancesLoading,
    isLoadingRecords,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refresh,
  } = useRecordList<TRow>({
    entityDefinitionId: entityDefinitionId ?? '',
    filters: filtersForQuery,
    sorting: sortingForQuery,
    limit: PAGE_SIZE,
    enabled: !!entityDefinitionId && isConfigReady,
  })

  const handleScrollToBottom = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !instancesLoading) {
      fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, instancesLoading, fetchNextPage])

  // RecordIds for the syncer. PrimaryFieldCell maintains its own
  // useFieldValue subscription, so the primary column is intentionally NOT
  // part of these columnIds — the syncer doesn't need to fetch it.
  const recordIds = useMemo(
    () => (entityDefinitionId ? records.map((r) => toRecordId(entityDefinitionId, r.id)) : []),
    [records, entityDefinitionId]
  )

  const columnIds = useMemo(() => {
    if (!entityDefinitionId) return []
    const directFieldIds = customFields.map((f) =>
      toResourceFieldId(entityDefinitionId, toFieldId(f.id))
    )
    const pathColumnIds = storeColumnVisibility
      ? Object.keys(storeColumnVisibility).filter((key) => key.includes('::'))
      : []
    return [...directFieldIds, ...pathColumnIds]
  }, [customFields, storeColumnVisibility, entityDefinitionId])

  const { getValue } = useFieldValueSyncer({
    recordIds,
    columnVisibility: storeColumnVisibility ?? {},
    resourceFieldIds: columnIds,
    enabled: !!entityDefinitionId && columnIds.length > 0 && isConfigReady,
  })

  useEffect(() => {
    if (!viewRef) return
    viewRef.current = { refresh, getValue }
    return () => {
      if (viewRef.current?.refresh === refresh) viewRef.current = null
    }
  }, [viewRef, refresh, getValue])

  const createEntityFieldColumn = useCallback(
    (field: ResourceField & { id: string }): ExtendedColumnDef<TRow> => {
      if (!entityDefinitionId) return { id: field.id } as ExtendedColumnDef<TRow>
      const resourceFieldId = toResourceFieldId(entityDefinitionId, toFieldId(field.id))
      const columnId = resourceFieldId

      const base: ExtendedColumnDef<TRow> = {
        id: columnId,
        accessorFn: () => undefined,
        header: field.name ?? field.label,
        fieldType: field.fieldType as FieldType,
        defaultVisible: field.showInPanel !== false,
        icon: getIconForFieldType(field.fieldType!),
        enableSorting: field.fieldType !== 'RELATIONSHIP' && field.capabilities.sortable !== false,
        enableFiltering:
          field.fieldType !== 'RELATIONSHIP' && field.capabilities.filterable !== false,
        enableResizing: true,
        minSize: 100,
        size: field.fieldType === 'RELATIONSHIP' ? 180 : 150,
        cell: ({ row }) => (
          <CustomFieldCell
            recordId={toRecordId(entityDefinitionId, row.original.id)}
            columnId={columnId}
          />
        ),
      }

      const override = columnOverrides?.(field)
      return override ? { ...base, ...override } : base
    },
    [entityDefinitionId, columnOverrides]
  )

  const columns: ExtendedColumnDef<TRow>[] = useMemo(() => {
    if (!entityDefinitionId) return []
    const sortedFields = customFields.filter((f) => f.active !== false)
    const primaryFieldId = resource?.display.primaryDisplayField?.id
    const primaryField = primaryFieldId
      ? sortedFields.find((f) => f.id === primaryFieldId)
      : sortedFields[0]

    const primaryColumn: ExtendedColumnDef<TRow> | null = primaryField
      ? {
          id: toResourceFieldId(entityDefinitionId, toFieldId(primaryField.id)),
          accessorFn: () => undefined,
          header: primaryField.name ?? primaryField.label,
          primaryCell: true,
          fieldType: primaryField.fieldType,
          icon: getIconForFieldType(primaryField.fieldType!),
          enableSorting: true,
          enableResizing: true,
          enableHiding: false,
          minSize: 200,
          size: 300,
          cell: ({ row }) => primaryCellRender(row.original),
        }
      : null

    const otherColumns = sortedFields
      .filter((f) => f.id !== primaryField?.id)
      .map(createEntityFieldColumn)

    return primaryColumn ? [primaryColumn, ...otherColumns] : otherColumns
  }, [customFields, resource, createEntityFieldColumn, entityDefinitionId, primaryCellRender])

  if (isLoading) {
    const loader = (
      <div className='flex h-full items-center justify-center'>
        <Loader size='sm' title='Loading records...' subtitle='Please wait' />
      </div>
    )
    return embedded ? loader : <MainPageContent>{loader}</MainPageContent>
  }

  if (!resource || !entityDefinitionId) return null

  const tableBody = (
    <div className='flex-1 overflow-hidden rounded-lg bg-primary-50 dark:bg-background flex-col flex min-h-0'>
      <DynamicView
        data={records as TRow[]}
        className='h-full flex-1'
        tableId={tableId}
        bulkActions={bulkActions}
        renderSearch={renderSearchBar}
        columns={columns}
        enableSorting
        enableFiltering
        isLoading={instancesLoading || isLoadingRecords}
        onRowSelectionChange={onRowSelectionChange}
        showRowNumbers={false}
        importHref={importHref}
        onScrollToBottom={handleScrollToBottom}
        emptyState={emptyState}
        cellSelection={cellSelection}
        entityLabel={entityLabel ?? resource.label}
        onAddNew={onAddNew}
        onCardClick={onCardClick}
        onAddCard={onAddCard}
        entityDefinitionId={entityDefinitionId}
        selectedKanbanCardIds={selectedKanbanCardIds}
        onSelectedKanbanCardIdsChange={onSelectedKanbanCardIdsChange}>
        <DynamicTableFooter>
          <div className='flex items-center justify-between px-4 py-2 text-sm'>
            <div>
              {records.length}{' '}
              {records.length === 1 ? resource.label.toLowerCase() : resource.plural.toLowerCase()}
              {hasNextPage && <span className='ml-2'>(more available)</span>}
            </div>
            {isFetchingNextPage && (
              <div className='flex items-center gap-2'>
                <div className='h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent' />
                <span>Loading more...</span>
              </div>
            )}
          </div>
        </DynamicTableFooter>
      </DynamicView>
    </div>
  )

  return embedded ? (
    tableBody
  ) : (
    <MainPageContent dockedPanels={dockedPanels}>{tableBody}</MainPageContent>
  )
}
