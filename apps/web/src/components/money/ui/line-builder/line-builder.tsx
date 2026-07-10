// apps/web/src/components/money/ui/line-builder/line-builder.tsx

'use client'

// The document-agnostic line-items builder (money MQ1 build spec §H.1, 01-ui.md #1).
// Renders a quote's (or work order's) lines on the records dynamic table in its
// reduced mode — `DynamicView` called directly with `standalone + hideToolbar +
// hideHeader + disableColumnDnd` and a hand-built fixed `ExtendedColumnDef[]`
// (the `record-list-widget.tsx` precedent; `DynamicResourceView` cannot run
// headerless/standalone, so the builder replicates its fetch layer via
// `useResource` + `useRecordList` with a baseline ConditionGroup on the
// `line_item:quote` / `line_item:workOrder` relationship).
//
// Data flow:
// - Line cell reads: `useSystemValues` (field-value store, autoFetch).
// - Line cell writes: `useSaveFieldValue` with systemAttribute keys — the
//   server-side field-change hooks (§F.2) recompute lineTotal + quote totals
//   and publish via realtime back into the same store.
// - Totals footer: pure client math via `computeDocumentTotals` /
//   `computeLineTotal` from `@auxx/lib/money/client` over store values — the
//   same function the server hook uses, so the optimistic footer and the
//   stored mirrors can never disagree.
// - Reorder: row DnD (`DragDropConfig.onDrop`) → `api.money.reorderLines`.
// - Delete: `api.record.delete` + `api.money.recomputeTotals` (delete path
//   doesn't fire field-change hooks, §F.2).
//
// NOTE on the ghost add-row (01-ui #1): the virtualized body has no non-record
// row primitive (rows are hard `ROW_HEIGHT`-sized virtual items), so the
// sanctioned fallback is used — an "Add line" row rendered in the footer slot,
// visually attached to the bottom of the table.

import { FieldType } from '@auxx/database/enums'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { computeLineTotal } from '@auxx/lib/money/client'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import { AlignLeft, Percent, ReceiptText, Trash2 } from 'lucide-react'
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { DragDropConfig, ExtendedColumnDef } from '~/components/dynamic-table'
import { DynamicTableFooter, DynamicView } from '~/components/dynamic-table'
import { EmptyState } from '~/components/global/empty-state'
import {
  type RecordId,
  type RecordMeta,
  toRecordId,
  useRecordList,
  useResource,
} from '~/components/resources'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import { type CatalogItemPick, CatalogPicker } from './catalog-picker'
import { formatCurrency, type NewLineInput, titleCase } from './shared'
import { TotalsFooter } from './totals-footer'

// ─────────────────────────────────────────────────────────────────────────────
// Props / shared types
// ─────────────────────────────────────────────────────────────────────────────

export interface LineBuilderProps {
  documentRecordId: string
  documentType: 'quote' | 'work_order'
  readOnly?: boolean
}

const LINE_ITEM_SLUG = 'line-items'
const PAGE_SIZE = 100
/** Stable sort ref — `useRecordList` keys its cache off this object. */
const LINE_SORT = [{ id: 'sortOrder', desc: false }]

// Module-level (stable-reference) attribute lists — `useSystemValues` memoizes
// on the array identity, so these must never be inline literals.
const NAME_ATTRS = ['line_item_name', 'line_item_description', 'line_item_category']
const QTY_ATTRS = ['line_item_qty']
const PRICE_ATTRS = ['line_item_unit_price']
const TOTAL_ATTRS = ['line_item_qty', 'line_item_unit_price']
const TAXABLE_ATTRS = ['line_item_taxable']

// ─────────────────────────────────────────────────────────────────────────────
// Context — keeps the column defs static while cells reach the builder's state
// ─────────────────────────────────────────────────────────────────────────────

interface LineBuilderContextValue {
  entityDefinitionId: string
  readOnly: boolean
  currencyCode: string
  openDescriptionIds: Set<string>
  toggleDescription: (lineId: string) => void
  closeDescription: (lineId: string) => void
  deleteLine: (lineId: string) => void
}

const LineBuilderContext = createContext<LineBuilderContextValue | null>(null)

function useLineBuilder(): LineBuilderContextValue {
  const ctx = useContext(LineBuilderContext)
  if (!ctx) throw new Error('useLineBuilder must be used within LineBuilder')
  return ctx
}

// ─────────────────────────────────────────────────────────────────────────────
// Cells
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Name cell — the catalog combobox (§H.2) doubling as free-text rename. Shows
 * the category chip and the description as a second muted line when set
 * (both lines fit the fixed 38px row; see the row-height note in the report).
 */
function LineNameCell({ rowId }: { rowId: string }) {
  const { entityDefinitionId, readOnly, currencyCode, openDescriptionIds, closeDescription } =
    useLineBuilder()
  const recordId = toRecordId(entityDefinitionId, rowId)
  const { values } = useSystemValues(recordId, NAME_ATTRS, { autoFetch: true })
  const { saveFieldValue, saveMultipleAsync } = useSaveFieldValue()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [descriptionDraft, setDescriptionDraft] = useState<string | null>(null)

  const name = (values.line_item_name as string | undefined) ?? ''
  const description = (values.line_item_description as string | null | undefined) ?? null
  const category = (values.line_item_category as string | null | undefined) ?? null
  const descriptionVisible = !!description || openDescriptionIds.has(rowId)

  const handlePick = (pick: CatalogItemPick) => {
    // COPY the catalog defaults onto the line (snapshot — catalog price changes
    // never rewrite documents) + keep the provenance relationship.
    void saveMultipleAsync(recordId, [
      { fieldId: 'line_item_name', value: pick.name, fieldType: FieldType.TEXT },
      { fieldId: 'line_item_description', value: pick.description, fieldType: FieldType.TEXT },
      { fieldId: 'line_item_category', value: pick.category, fieldType: FieldType.SINGLE_SELECT },
      { fieldId: 'line_item_taxable', value: pick.taxable, fieldType: FieldType.CHECKBOX },
      { fieldId: 'line_item_unit_price', value: pick.unitPrice, fieldType: FieldType.CURRENCY },
      {
        fieldId: 'line_item_catalog_item',
        value: pick.recordId,
        fieldType: FieldType.RELATIONSHIP,
      },
    ])
  }

  const commitDescription = () => {
    if (descriptionDraft === null) return
    const next = descriptionDraft.trim()
    saveFieldValue(recordId, 'line_item_description', next || null, FieldType.TEXT)
    setDescriptionDraft(null)
    if (!next) closeDescription(rowId)
  }

  return (
    <div className='flex h-full w-full min-w-0 flex-col justify-center px-2'>
      <CatalogPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        initialQuery={name}
        currencyCode={currencyCode}
        onSelectCatalogItem={handlePick}
        onFreeText={(text) => saveFieldValue(recordId, 'line_item_name', text, FieldType.TEXT)}>
        <button
          type='button'
          disabled={readOnly}
          // Row drag listeners live on the row wrapper — keep pointer-downs on
          // editors from starting a drag.
          onPointerDown={(e) => e.stopPropagation()}
          className={cn(
            'flex min-w-0 items-center gap-1.5 rounded-sm text-left',
            !readOnly && 'hover:bg-primary-100/60 dark:hover:bg-primary-100/40'
          )}>
          <span
            className={cn(
              'truncate text-sm leading-tight',
              !name && 'text-muted-foreground italic'
            )}>
            {name || 'Untitled line'}
          </span>
          {category && (
            <span className='shrink-0 rounded-full bg-primary-100 px-1.5 py-px text-[10px] text-muted-foreground leading-tight dark:bg-primary-100/50'>
              {titleCase(category)}
            </span>
          )}
        </button>
      </CatalogPicker>

      {descriptionVisible &&
        (readOnly ? (
          <span className='truncate text-[10px] text-muted-foreground leading-tight'>
            {description}
          </span>
        ) : (
          <input
            value={descriptionDraft ?? description ?? ''}
            onChange={(e) => setDescriptionDraft(e.target.value)}
            onFocus={() => setDescriptionDraft(description ?? '')}
            onBlur={commitDescription}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                setDescriptionDraft(null)
                if (!description) closeDescription(rowId)
              }
            }}
            autoFocus={!description}
            onPointerDown={(e) => e.stopPropagation()}
            placeholder='Description'
            className='w-full truncate border-none bg-transparent text-[10px] text-muted-foreground leading-tight outline-none placeholder:text-muted-foreground/60'
          />
        ))}
    </div>
  )
}

/**
 * Chromeless inline number editor — quiet at rest, editable on click (the
 * cell-treatment lock in 01-ui #1). Commits on blur/Enter.
 */
function InlineNumberCell({
  rowId,
  attr,
  fieldType,
  align = 'right',
}: {
  rowId: string
  attr: 'line_item_qty' | 'line_item_unit_price'
  fieldType: FieldType
  align?: 'left' | 'right'
}) {
  const { entityDefinitionId, readOnly, currencyCode } = useLineBuilder()
  const recordId = toRecordId(entityDefinitionId, rowId)
  const attrs = attr === 'line_item_qty' ? QTY_ATTRS : PRICE_ATTRS
  const { values } = useSystemValues(recordId, attrs, { autoFetch: true })
  const { saveFieldValue } = useSaveFieldValue()
  const [draft, setDraft] = useState<string | null>(null)

  const raw = values[attr] as number | null | undefined
  const display =
    attr === 'line_item_unit_price'
      ? formatCurrency(raw ?? null, currencyCode)
      : raw !== null && raw !== undefined
        ? String(raw)
        : ''

  const commit = () => {
    if (draft === null) return
    const trimmed = draft.trim()
    const parsed = trimmed === '' ? null : Number(trimmed)
    setDraft(null)
    if (parsed !== null && Number.isNaN(parsed)) return
    // Qty is non-nullable — an emptied qty keeps its previous value.
    if (attr === 'line_item_qty' && parsed === null) return
    if (parsed === (raw ?? null)) return
    saveFieldValue(recordId, attr, parsed, fieldType)
  }

  if (readOnly) {
    return (
      <div
        className={cn(
          'w-full px-2 text-sm tabular-nums',
          align === 'right' ? 'text-right' : 'text-left'
        )}>
        {display}
      </div>
    )
  }

  return (
    <input
      value={draft ?? display}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setDraft(raw !== null && raw !== undefined ? String(raw) : '')}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') setDraft(null)
      }}
      inputMode='decimal'
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        'h-full w-full border-none bg-transparent px-2 text-sm tabular-nums outline-none',
        'hover:bg-primary-100/60 focus:bg-primary-100/80 dark:hover:bg-primary-100/40 dark:focus:bg-primary-100/60',
        align === 'right' ? 'text-right' : 'text-left'
      )}
    />
  )
}

/** Read-only computed line total — `computeLineTotal` live over store values. */
function LineTotalCell({ rowId }: { rowId: string }) {
  const { entityDefinitionId, currencyCode } = useLineBuilder()
  const recordId = toRecordId(entityDefinitionId, rowId)
  const { values } = useSystemValues(recordId, TOTAL_ATTRS, { autoFetch: true })

  const qty = (values.line_item_qty as number | null | undefined) ?? 1
  const unitPrice = (values.line_item_unit_price as number | null | undefined) ?? null
  const lineTotal = computeLineTotal(qty, unitPrice)

  return (
    <div className='w-full px-2 text-right text-muted-foreground text-sm tabular-nums'>
      {formatCurrency(lineTotal, currencyCode)}
    </div>
  )
}

/** Trailing hover actions: description toggle · taxable toggle · delete (no confirm). */
function LineActionsCell({ rowId }: { rowId: string }) {
  const { entityDefinitionId, toggleDescription, deleteLine } = useLineBuilder()
  const recordId = toRecordId(entityDefinitionId, rowId)
  const { values } = useSystemValues(recordId, TAXABLE_ATTRS, { autoFetch: true })
  const { saveFieldValue } = useSaveFieldValue()

  const taxable = (values.line_item_taxable as boolean | undefined) !== false

  return (
    <div className='flex w-full items-center justify-end gap-0.5 px-1 opacity-0 transition-opacity group-hover/tablerow:opacity-100'>
      <SimpleTooltip content='Description'>
        <Button variant='ghost' size='icon-sm' onClick={() => toggleDescription(rowId)}>
          <AlignLeft />
        </Button>
      </SimpleTooltip>
      <SimpleTooltip content={taxable ? 'Taxable — click to exempt' : 'Tax exempt — click to tax'}>
        <Button
          variant='ghost'
          size='icon-sm'
          className={cn(!taxable && 'text-muted-foreground/40')}
          onClick={() =>
            saveFieldValue(recordId, 'line_item_taxable', !taxable, FieldType.CHECKBOX)
          }>
          <Percent />
        </Button>
      </SimpleTooltip>
      <SimpleTooltip content='Delete line'>
        <Button
          variant='ghost'
          size='icon-sm'
          className='text-destructive/70 hover:text-destructive'
          onClick={() => deleteLine(rowId)}>
          <Trash2 />
        </Button>
      </SimpleTooltip>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// The builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One document-agnostic line builder: quote detail tab, job Line-items section
 * (M2), invoice detail + gather dialogs (MI1, `readOnly`). Fetches the parent
 * document's billing fields itself — consumers only pass the document handle.
 */
export function LineBuilder({
  documentRecordId,
  documentType,
  readOnly = false,
}: LineBuilderProps) {
  const docRecordId = documentRecordId as RecordId
  const { resource } = useResource(LINE_ITEM_SLUG)
  const entityDefinitionId = resource?.id
  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'

  const [openDescriptionIds, setOpenDescriptionIds] = useState<Set<string>>(new Set())
  const [orderOverride, setOrderOverride] = useState<string[] | null>(null)

  // Baseline filter: lines belonging to this document, via the belongs_to rel
  // (`contact-tickets-tab.tsx` precedent — `operator: 'is'` + the RecordId;
  // the server strips the def prefix).
  const filters = useMemo<ConditionGroup[]>(
    () => [
      {
        id: 'line-builder-baseline',
        logicalOperator: 'AND',
        conditions: [
          {
            id: 'line-builder-document',
            fieldId: documentType === 'quote' ? 'line_item:quote' : 'line_item:workOrder',
            operator: 'is',
            value: documentRecordId,
          },
        ],
      },
    ],
    [documentType, documentRecordId]
  )

  const {
    records,
    isLoading,
    isLoadingRecords,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    refresh,
  } = useRecordList<RecordMeta>({
    entityDefinitionId: entityDefinitionId ?? '',
    filters,
    sorting: LINE_SORT,
    limit: PAGE_SIZE,
    enabled: !!entityDefinitionId,
  })

  // Optimistic display order while a reorder mutation settles. Ids missing from
  // the override (freshly added lines) append in server order.
  const displayRecords = useMemo(() => {
    if (!orderOverride) return records
    const byId = new Map(records.map((r) => [r.id, r]))
    const overrideSet = new Set(orderOverride)
    const ordered = orderOverride
      .map((id) => byId.get(id))
      .filter((r): r is RecordMeta => r !== undefined)
    return [...ordered, ...records.filter((r) => !overrideSet.has(r.id))]
  }, [records, orderOverride])

  const displayIdsRef = useRef<string[]>([])
  displayIdsRef.current = displayRecords.map((r) => r.id)

  const lineRecordIds = useMemo(
    () =>
      entityDefinitionId ? displayRecords.map((r) => toRecordId(entityDefinitionId, r.id)) : [],
    [entityDefinitionId, displayRecords]
  )

  // Mutations (stable fns destructured — the wrapper objects churn per render).
  const reorderLines = api.money.reorderLines.useMutation()
  const recomputeTotals = api.money.recomputeTotals.useMutation()
  const deleteRecord = api.record.delete.useMutation()
  const createRecord = api.record.create.useMutation()
  const { mutate: reorderMutate } = reorderLines
  const { mutate: recomputeMutate } = recomputeTotals
  const { mutateAsync: deleteMutateAsync } = deleteRecord
  const { mutateAsync: createMutateAsync } = createRecord

  const deleteLine = useCallback(
    async (lineId: string) => {
      if (!entityDefinitionId) return
      try {
        await deleteMutateAsync({ recordId: toRecordId(entityDefinitionId, lineId) })
        // Deletes don't fire field-change hooks — recompute explicitly (§F.2).
        if (documentType === 'quote') recomputeMutate({ quoteRecordId: docRecordId })
        refresh()
      } catch (error) {
        toastError({
          title: 'Error deleting line',
          description: error instanceof Error ? error.message : 'Could not delete the line',
        })
      }
    },
    [entityDefinitionId, documentType, docRecordId, deleteMutateAsync, recomputeMutate, refresh]
  )

  const addLine = useCallback(
    async (input: NewLineInput) => {
      const relKey = documentType === 'quote' ? 'line_item_quote' : 'line_item_work_order'
      const values: Record<string, unknown> = {
        line_item_name: input.name,
        line_item_qty: 1,
        line_item_taxable: input.taxable ?? true,
        line_item_sort_order: displayIdsRef.current.length,
        [relKey]: documentRecordId,
      }
      if (input.description) values.line_item_description = input.description
      if (input.category) values.line_item_category = input.category
      if (input.unitPrice !== null && input.unitPrice !== undefined) {
        values.line_item_unit_price = input.unitPrice
      }
      if (input.catalogItemRecordId) values.line_item_catalog_item = input.catalogItemRecordId

      try {
        await createMutateAsync({ entityDefinitionId: 'line_item', values })
        refresh()
      } catch (error) {
        toastError({
          title: 'Error adding line',
          description: error instanceof Error ? error.message : 'Could not add the line',
        })
      }
    },
    [documentType, documentRecordId, createMutateAsync, refresh]
  )

  const toggleDescription = useCallback((lineId: string) => {
    setOpenDescriptionIds((prev) => {
      const next = new Set(prev)
      if (next.has(lineId)) next.delete(lineId)
      else next.add(lineId)
      return next
    })
  }, [])

  const closeDescription = useCallback((lineId: string) => {
    setOpenDescriptionIds((prev) => {
      if (!prev.has(lineId)) return prev
      const next = new Set(prev)
      next.delete(lineId)
      return next
    })
  }, [])

  const contextValue = useMemo<LineBuilderContextValue | null>(
    () =>
      entityDefinitionId
        ? {
            entityDefinitionId,
            readOnly,
            currencyCode,
            openDescriptionIds,
            toggleDescription,
            closeDescription,
            deleteLine,
          }
        : null,
    [
      entityDefinitionId,
      readOnly,
      currencyCode,
      openDescriptionIds,
      toggleDescription,
      closeDescription,
      deleteLine,
    ]
  )

  // Fixed columns — static defs, cells reach builder state through context.
  const columns = useMemo<ExtendedColumnDef<RecordMeta>[]>(() => {
    const interactionOff = {
      enableSorting: false,
      enableFiltering: false,
      enableHiding: false,
      enableResizing: false,
      enableResize: false,
      enableReorder: false,
    } as const

    const defs: ExtendedColumnDef<RecordMeta>[] = [
      {
        id: 'line-name',
        accessorFn: () => undefined,
        header: 'Item',
        ...interactionOff,
        minSize: 220,
        size: 340,
        cell: ({ row }) => <LineNameCell rowId={row.original.id} />,
      },
      {
        id: 'line-qty',
        accessorFn: () => undefined,
        header: 'Qty',
        ...interactionOff,
        minSize: 60,
        size: 70,
        cell: ({ row }) => (
          <InlineNumberCell
            rowId={row.original.id}
            attr='line_item_qty'
            fieldType={FieldType.NUMBER}
          />
        ),
      },
      {
        id: 'line-unit-price',
        accessorFn: () => undefined,
        header: 'Unit price',
        ...interactionOff,
        minSize: 90,
        size: 120,
        cell: ({ row }) => (
          <InlineNumberCell
            rowId={row.original.id}
            attr='line_item_unit_price'
            fieldType={FieldType.CURRENCY}
          />
        ),
      },
      {
        id: 'line-total',
        accessorFn: () => undefined,
        header: 'Total',
        ...interactionOff,
        minSize: 90,
        size: 120,
        cell: ({ row }) => <LineTotalCell rowId={row.original.id} />,
      },
    ]

    if (!readOnly) {
      defs.push({
        id: 'line-actions',
        accessorFn: () => undefined,
        header: '',
        ...interactionOff,
        minSize: 100,
        size: 110,
        cell: ({ row }) => <LineActionsCell rowId={row.original.id} />,
      })
    }

    return defs
  }, [readOnly])

  // Row drag-reorder. The table's drop handler always reports 'inside' (no
  // before/after edge detection exists) — the new index is derived from the
  // dragged row's position relative to the target: moving down lands after
  // the target, moving up lands before it.
  const dragDrop = useMemo<DragDropConfig<RecordMeta>>(
    () => ({
      enabled: !readOnly,
      canDrag: () => !readOnly,
      canDrop: (draggedItems, targetRow) => !draggedItems.some((d) => d.id === targetRow.id),
      onDrop: (draggedItems, targetRow) => {
        if (!entityDefinitionId) return
        const draggedIds = draggedItems.map((d) => d.id)
        const current = displayIdsRef.current
        const fromIndex = current.indexOf(draggedIds[0] ?? '')
        const targetIndex = current.indexOf(targetRow.id)
        if (fromIndex === -1 || targetIndex === -1) return

        const without = current.filter((id) => !draggedIds.includes(id))
        let insertAt = without.indexOf(targetRow.id)
        if (insertAt === -1) return
        if (fromIndex < targetIndex) insertAt += 1
        const nextOrder = [...without]
        nextOrder.splice(insertAt, 0, ...draggedIds)

        setOrderOverride(nextOrder)
        reorderMutate(
          {
            documentRecordId: docRecordId,
            orderedLineRecordIds: nextOrder.map((id) => toRecordId(entityDefinitionId, id)),
          },
          {
            onError: (error) => {
              setOrderOverride(null)
              refresh()
              toastError({ title: 'Error reordering lines', description: error.message })
            },
          }
        )
      },
    }),
    [readOnly, entityDefinitionId, docRecordId, reorderMutate, refresh]
  )

  const handleScrollToBottom = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !isLoading) fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, isLoading, fetchNextPage])

  if (!contextValue) return null

  return (
    <LineBuilderContext.Provider value={contextValue}>
      <div className='flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-primary-50 dark:bg-background'>
        <DynamicView<RecordMeta>
          data={displayRecords}
          columns={columns}
          tableId={`line-builder-${documentRecordId}`}
          standalone
          hideToolbar
          hideHeader
          disableColumnDnd
          enableSearch={false}
          enableFiltering={false}
          enableSorting={false}
          showRowNumbers={false}
          isLoading={isLoading || isLoadingRecords}
          getRowId={(row) => row.id}
          onScrollToBottom={handleScrollToBottom}
          dragDrop={dragDrop}
          className='h-full flex-1'
          emptyState={
            <EmptyState
              icon={ReceiptText}
              title='No line items yet'
              description='Add from the catalog or type a custom line.'
            />
          }>
          <DynamicTableFooter>
            <TotalsFooter
              documentRecordId={docRecordId}
              documentType={documentType}
              readOnly={readOnly}
              currencyCode={currencyCode}
              lineRecordIds={lineRecordIds}
              onAddLine={addLine}
            />
          </DynamicTableFooter>
        </DynamicView>
      </div>
    </LineBuilderContext.Provider>
  )
}
