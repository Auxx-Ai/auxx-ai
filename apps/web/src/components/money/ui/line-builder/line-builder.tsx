// apps/web/src/components/money/ui/line-builder/line-builder.tsx

'use client'

// The document-agnostic line-items builder (money MQ1 build spec §H.1, 01-ui.md #1).
// Lines render as `GridTreeRow`s under a plain grid header (Description / Qty /
// Unit cost / Total / actions) — the data-connectors mapping-editor idiom
// (mapping-row.tsx): one shared `grid-template-columns` keeps the number columns
// aligned across the header and every row. Line counts are small, so plain rows
// replace the virtualized `DynamicView` embed this used to be.
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
// - Add: creates an EMPTY line record; clicking the Description cell opens the
//   catalog picker (§H.2) which fills it in (or renames via free text).
// - Reorder: dnd-kit sortable rows (grip handle) → `api.money.reorderLines`.
// - Delete: `api.record.delete` + `api.money.recomputeTotals` (delete path
//   doesn't fire field-change hooks, §F.2).

import { FieldType } from '@auxx/database/enums'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { computeLineTotal } from '@auxx/lib/money/client'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { GridTreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AlignLeft, GripVertical, Percent, Plus, ReceiptText, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { type CatalogGroupPick, type CatalogItemPick, CatalogPicker } from './catalog-picker'
import { formatCurrency, titleCase } from './shared'
import { TotalsFooter } from './totals-footer'

// ─────────────────────────────────────────────────────────────────────────────
// Props / shared types
// ─────────────────────────────────────────────────────────────────────────────

export interface LineBuilderProps {
  documentRecordId: string
  documentType: 'quote' | 'work_order' | 'invoice'
  readOnly?: boolean
}

const LINE_ITEM_SLUG = 'line-items'
const PAGE_SIZE = 100
/** Stable sort ref — `useRecordList` keys its cache off this object. */
const LINE_SORT = [{ id: 'sortOrder', desc: false }]

/**
 * Shared `grid-template-columns` for the header row and every line row (the
 * mapping-columns.ts idiom) — one template is what keeps the qty / unit cost /
 * total columns aligned. Columns: description (fills) │ qty │ unit cost │
 * total │ actions.
 */
const LINE_COLS = 'minmax(10rem, 1fr) 4rem 6.5rem 6.5rem 5.5rem'

// Module-level (stable-reference) attribute lists — `useSystemValues` memoizes
// on the array identity, so these must never be inline literals.
const NAME_ATTRS = ['line_item_name', 'line_item_description', 'line_item_category']
const QTY_ATTRS = ['line_item_qty']
const PRICE_ATTRS = ['line_item_unit_price']
const TOTAL_ATTRS = ['line_item_qty', 'line_item_unit_price']
const TAXABLE_ATTRS = ['line_item_taxable']
// Document billing mirrors read for the group-explode set-if-unset checks (steps 4–5,
// money 09-product-groups.md "Line-builder consumption") — the same attrs `TotalsFooter`
// reads, minus the invoice-only ledger-sync mirrors this doesn't need.
const QUOTE_BILLING_ATTRS = [
  'quote_discount_type',
  'quote_discount_value',
  'quote_tax_name',
  'quote_tax_rate',
]
const INVOICE_BILLING_ATTRS = [
  'invoice_discount_type',
  'invoice_discount_value',
  'invoice_tax_name',
  'invoice_tax_rate',
]

/** Org tax rate preset (`documents.taxRates` setting, money MQ1 build spec §G.1). */
interface TaxRatePreset {
  id: string
  name: string
  rate: number
  isDefault?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Cells
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Description cell — a transparent full-width button (the formula-row picker
 * idiom) that opens the catalog combobox (§H.2), doubling as free-text rename.
 * Shows the category chip inline and the description as a second muted line.
 */
function LineNameCell({
  recordId,
  rowId,
  readOnly,
  currencyCode,
  descriptionOpen,
  closeDescription,
  onSelectGroup,
}: {
  recordId: RecordId
  rowId: string
  readOnly: boolean
  currencyCode: string
  descriptionOpen: boolean
  closeDescription: (lineId: string) => void
  onSelectGroup: (pick: CatalogGroupPick) => void
}) {
  const { values } = useSystemValues(recordId, NAME_ATTRS, { autoFetch: true })
  const { saveFieldValue, saveMultipleAsync } = useSaveFieldValue()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [descriptionDraft, setDescriptionDraft] = useState<string | null>(null)

  const name = (values.line_item_name as string | undefined) ?? ''
  const description = (values.line_item_description as string | null | undefined) ?? null
  const category = (values.line_item_category as string | null | undefined) ?? null
  const descriptionVisible = !!description || descriptionOpen

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
    <div className='flex min-w-0 flex-1 flex-col justify-center py-1'>
      {readOnly ? (
        <span className='flex min-w-0 items-center gap-1.5 px-1'>
          <span className={cn('truncate text-sm', !name && 'text-muted-foreground italic')}>
            {name || 'Untitled line'}
          </span>
          {category && (
            <span className='shrink-0 rounded-full bg-primary-100 px-1.5 py-px text-[10px] text-muted-foreground leading-tight dark:bg-primary-100/50'>
              {titleCase(category)}
            </span>
          )}
        </span>
      ) : (
        <CatalogPicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          initialQuery={name}
          currencyCode={currencyCode}
          onSelectCatalogItem={handlePick}
          onSelectGroup={onSelectGroup}
          onFreeText={(text) => saveFieldValue(recordId, 'line_item_name', text, FieldType.TEXT)}>
          <Button
            variant='transparent'
            className={cn(
              'h-7 min-w-0 justify-start gap-1.5 rounded-sm px-1 text-sm hover:bg-primary/5',
              !name && 'text-muted-foreground'
            )}>
            <span className='truncate'>{name || 'Add item…'}</span>
            {category && (
              <span className='shrink-0 rounded-full bg-primary-100 px-1.5 py-px text-[10px] text-muted-foreground leading-tight dark:bg-primary-100/50'>
                {titleCase(category)}
              </span>
            )}
          </Button>
        </CatalogPicker>
      )}

      {descriptionVisible &&
        (readOnly ? (
          <span className='truncate px-1 text-muted-foreground text-xs'>{description}</span>
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
            placeholder='Description'
            className='w-full truncate border-none bg-transparent px-1 text-muted-foreground text-xs outline-none placeholder:text-muted-foreground/60'
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
  recordId,
  attr,
  fieldType,
  readOnly,
  currencyCode,
}: {
  recordId: RecordId
  attr: 'line_item_qty' | 'line_item_unit_price'
  fieldType: FieldType
  readOnly: boolean
  currencyCode: string
}) {
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
    // Prices are typed in dollars but stored as integer cents (CURRENCY convention).
    const next =
      parsed !== null && attr === 'line_item_unit_price' ? Math.round(parsed * 100) : parsed
    if (next === (raw ?? null)) return
    saveFieldValue(recordId, attr, next, fieldType)
  }

  if (readOnly) {
    return <div className='w-full px-2 text-right text-sm tabular-nums'>{display}</div>
  }

  return (
    <input
      value={draft ?? display}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() =>
        setDraft(
          raw !== null && raw !== undefined
            ? String(attr === 'line_item_unit_price' ? raw / 100 : raw)
            : ''
        )
      }
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') setDraft(null)
      }}
      inputMode='decimal'
      className={cn(
        'h-full w-full rounded-sm border-none bg-transparent px-2 text-right text-sm tabular-nums outline-none',
        'hover:bg-primary/5 focus:bg-primary/10'
      )}
    />
  )
}

/** Read-only computed line total — `computeLineTotal` live over store values. */
function LineTotalCell({ recordId, currencyCode }: { recordId: RecordId; currencyCode: string }) {
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
function LineActionsCell({
  recordId,
  rowId,
  toggleDescription,
  deleteLine,
}: {
  recordId: RecordId
  rowId: string
  toggleDescription: (lineId: string) => void
  deleteLine: (lineId: string) => void
}) {
  const { values } = useSystemValues(recordId, TAXABLE_ATTRS, { autoFetch: true })
  const { saveFieldValue } = useSaveFieldValue()

  const taxable = (values.line_item_taxable as boolean | undefined) !== false

  return (
    <div className='flex w-full items-center justify-end gap-1 pr-1'>
      <TreeRowButton tooltipText='Description' onClick={() => toggleDescription(rowId)}>
        <AlignLeft />
      </TreeRowButton>
      <TreeRowButton
        tooltipText={taxable ? 'Taxable — click to exempt' : 'Tax exempt — click to tax'}
        className={cn(!taxable && 'text-muted-foreground/40')}
        onClick={() => saveFieldValue(recordId, 'line_item_taxable', !taxable, FieldType.CHECKBOX)}>
        <Percent />
      </TreeRowButton>
      <TreeRowButton
        variant='destructive'
        tooltipText='Delete line'
        onClick={() => deleteLine(rowId)}>
        <Trash2 />
      </TreeRowButton>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Row
// ─────────────────────────────────────────────────────────────────────────────

/** One sortable line row — a GridTreeRow whose leading icon is the drag grip. */
function LineRow({
  record,
  entityDefinitionId,
  readOnly,
  currencyCode,
  descriptionOpen,
  toggleDescription,
  closeDescription,
  deleteLine,
  onSelectGroup,
}: {
  record: RecordMeta
  entityDefinitionId: string
  readOnly: boolean
  currencyCode: string
  descriptionOpen: boolean
  toggleDescription: (lineId: string) => void
  closeDescription: (lineId: string) => void
  deleteLine: (lineId: string) => void
  onSelectGroup: (recordId: RecordId, pick: CatalogGroupPick) => void
}) {
  const recordId = toRecordId(entityDefinitionId, record.id)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: record.id,
    disabled: readOnly,
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && 'relative z-10 opacity-80')}>
      <GridTreeRow
        columns={LINE_COLS}
        icon={
          readOnly ? undefined : (
            <span
              {...attributes}
              {...listeners}
              className='flex cursor-grab items-center justify-center opacity-0 transition-opacity group-hover/tree-row:opacity-100'>
              <GripVertical className='size-3.5' />
            </span>
          )
        }
        title={
          <LineNameCell
            recordId={recordId}
            rowId={record.id}
            readOnly={readOnly}
            currencyCode={currencyCode}
            descriptionOpen={descriptionOpen}
            closeDescription={closeDescription}
            onSelectGroup={(pick) => onSelectGroup(recordId, pick)}
          />
        }
        cells={[
          <InlineNumberCell
            key='qty'
            recordId={recordId}
            attr='line_item_qty'
            fieldType={FieldType.NUMBER}
            readOnly={readOnly}
            currencyCode={currencyCode}
          />,
          <InlineNumberCell
            key='price'
            recordId={recordId}
            attr='line_item_unit_price'
            fieldType={FieldType.CURRENCY}
            readOnly={readOnly}
            currencyCode={currencyCode}
          />,
          <LineTotalCell key='total' recordId={recordId} currencyCode={currencyCode} />,
          readOnly ? (
            <span key='actions' />
          ) : (
            <LineActionsCell
              key='actions'
              recordId={recordId}
              rowId={record.id}
              toggleDescription={toggleDescription}
              deleteLine={deleteLine}
            />
          ),
        ]}
      />
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

  // work_order (M2 job view) has no billing fields (money MI1 build spec §J.2 precedent,
  // mirrored from TotalsFooter) — group discount/tax set-if-unset skips entirely there.
  const hasBilling = documentType === 'quote' || documentType === 'invoice'
  const billingPrefix = documentType === 'invoice' ? 'invoice' : 'quote'
  const { values: billingValues } = useSystemValues(
    docRecordId,
    documentType === 'invoice' ? INVOICE_BILLING_ATTRS : QUOTE_BILLING_ATTRS,
    { autoFetch: hasBilling, enabled: hasBilling }
  )
  const taxRates = ((getSetting('documents.taxRates') as TaxRatePreset[] | null) ?? []).filter(
    (r) => r && typeof r.rate === 'number'
  )

  const [openDescriptionIds, setOpenDescriptionIds] = useState<Set<string>>(new Set())
  const [orderOverride, setOrderOverride] = useState<string[] | null>(null)

  // Baseline filter: lines belonging to this document, via the belongs_to rel
  // (`contact-tickets-tab.tsx` precedent — `operator: 'is'` + the RecordId;
  // the server strips the def prefix). Invoice mode ALSO excludes work-order source
  // lines stamped with `line_item_invoice` (the gather "invoiced by" pointer, money
  // MI1 build spec §B.3/§J.2) — only the invoice's own copies (workOrder empty) show.
  const filters = useMemo<ConditionGroup[]>(() => {
    if (documentType === 'invoice') {
      return [
        {
          id: 'line-builder-baseline',
          logicalOperator: 'AND',
          conditions: [
            {
              id: 'line-builder-document',
              fieldId: 'line_item:invoice',
              operator: 'is',
              value: documentRecordId,
            },
            {
              id: 'line-builder-invoice-workorder',
              fieldId: 'line_item:workOrder',
              operator: 'empty',
              value: null,
            },
          ],
        },
      ]
    }
    return [
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
    ]
  }, [documentType, documentRecordId])

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

  // No virtualized scroll anymore — load every page eagerly (line counts are small).
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isLoading) fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, isLoading, fetchNextPage])

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
  const deleteInvoiceLine = api.money.deleteInvoiceLine.useMutation()
  const createRecord = api.record.create.useMutation()
  const { mutate: reorderMutate } = reorderLines
  const { mutate: recomputeMutate } = recomputeTotals
  const { mutateAsync: deleteMutateAsync } = deleteRecord
  const { mutateAsync: deleteInvoiceLineMutateAsync } = deleteInvoiceLine
  const { mutateAsync: createMutateAsync } = createRecord

  const deleteLine = useCallback(
    async (lineId: string) => {
      if (!entityDefinitionId) return
      try {
        if (documentType === 'invoice') {
          // Unstamps the gathered source line + recomputes totals server-side
          // (money MI1 build spec §G.3) — NOT the quote's record.delete + recompute pair.
          await deleteInvoiceLineMutateAsync({
            lineRecordId: toRecordId(entityDefinitionId, lineId),
          })
        } else {
          await deleteMutateAsync({ recordId: toRecordId(entityDefinitionId, lineId) })
          // Deletes don't fire field-change hooks — recompute explicitly (§F.2).
          if (documentType === 'quote') recomputeMutate({ quoteRecordId: docRecordId })
        }
        refresh()
      } catch (error) {
        toastError({
          title: 'Error deleting line',
          description: error instanceof Error ? error.message : 'Could not delete the line',
        })
      }
    },
    [
      entityDefinitionId,
      documentType,
      docRecordId,
      deleteMutateAsync,
      deleteInvoiceLineMutateAsync,
      recomputeMutate,
      refresh,
    ]
  )

  /** Add an empty line — the Description cell's picker fills it in afterwards. */
  const addLine = useCallback(async () => {
    const relKey =
      documentType === 'quote'
        ? 'line_item_quote'
        : documentType === 'invoice'
          ? 'line_item_invoice'
          : 'line_item_work_order'
    try {
      await createMutateAsync({
        entityDefinitionId: 'line_item',
        values: {
          line_item_name: '',
          line_item_qty: 1,
          line_item_taxable: true,
          line_item_sort_order: displayIdsRef.current.length,
          [relKey]: documentRecordId,
        },
      })
      refresh()
    } catch (error) {
      toastError({
        title: 'Error adding line',
        description: error instanceof Error ? error.message : 'Could not add the line',
      })
    }
  }, [documentType, documentRecordId, createMutateAsync, refresh])

  const { saveMultipleAsync } = useSaveFieldValue()

  /**
   * Explode a picked catalog group onto the document (money 09-product-groups.md
   * "Line-builder consumption"): entry #1 fills the line whose picker was open,
   * entries 2…N append as new lines, then the document discount/tax are
   * set-if-unset from the group (never overwriting an existing value).
   */
  const handleGroupPick = useCallback(
    async (recordId: RecordId, pick: CatalogGroupPick) => {
      if (pick.skippedCount > 0) {
        console.warn(`Catalog group "${pick.name}" skipped ${pick.skippedCount} dangling item(s).`)
      }
      if (pick.lines.length === 0) return

      const [first, ...rest] = pick.lines

      // Step 1: entry #1 fills the CURRENT line — the handlePick shape (catalog-picker.tsx)
      // plus qty, which the single-item pick leaves untouched.
      void saveMultipleAsync(recordId, [
        { fieldId: 'line_item_name', value: first.name, fieldType: FieldType.TEXT },
        { fieldId: 'line_item_description', value: first.description, fieldType: FieldType.TEXT },
        {
          fieldId: 'line_item_category',
          value: first.category,
          fieldType: FieldType.SINGLE_SELECT,
        },
        { fieldId: 'line_item_taxable', value: first.taxable, fieldType: FieldType.CHECKBOX },
        { fieldId: 'line_item_unit_price', value: first.unitPrice, fieldType: FieldType.CURRENCY },
        { fieldId: 'line_item_qty', value: first.qty, fieldType: FieldType.NUMBER },
        {
          fieldId: 'line_item_catalog_item',
          value: toRecordId('catalog_item', first.catalogItemId),
          fieldType: FieldType.RELATIONSHIP,
        },
      ])

      // Step 2: entries 2…N append at the end — sequential creates (not Promise.all) so
      // sort order + the server-side totals-recompute hooks stay deterministic; N is small.
      // Known v1 edge: picking on a middle line still appends these at the list end.
      if (rest.length > 0) {
        const relKey =
          documentType === 'quote'
            ? 'line_item_quote'
            : documentType === 'invoice'
              ? 'line_item_invoice'
              : 'line_item_work_order'
        const baseOrder = displayIdsRef.current.length
        try {
          for (const [index, line] of rest.entries()) {
            await createMutateAsync({
              entityDefinitionId: 'line_item',
              values: {
                line_item_name: line.name,
                line_item_description: line.description,
                line_item_category: line.category,
                line_item_taxable: line.taxable,
                line_item_unit_price: line.unitPrice,
                line_item_qty: line.qty,
                line_item_catalog_item: toRecordId('catalog_item', line.catalogItemId),
                line_item_sort_order: baseOrder + index,
                [relKey]: documentRecordId,
              },
            })
          }
        } catch (error) {
          toastError({
            title: 'Error adding group lines',
            description: error instanceof Error ? error.message : 'Could not add all group lines',
          })
        }
        refresh()
      }

      // Steps 4–5: document discount/tax set-if-unset — quote/invoice only, never
      // overwriting a value the document already has.
      if (hasBilling) {
        const currentDiscountValue = billingValues[`${billingPrefix}_discount_value`] as
          | number
          | null
          | undefined
        if (pick.discountType && pick.discountValue !== null && currentDiscountValue == null) {
          void saveMultipleAsync(docRecordId, [
            {
              fieldId: `${billingPrefix}_discount_type`,
              value: pick.discountType,
              fieldType: FieldType.SINGLE_SELECT,
            },
            {
              fieldId: `${billingPrefix}_discount_value`,
              value: pick.discountValue,
              fieldType: FieldType.NUMBER,
            },
          ])
        }

        const currentTaxRate = billingValues[`${billingPrefix}_tax_rate`] as
          | number
          | null
          | undefined
        if (pick.taxRateId && currentTaxRate == null) {
          // A deleted preset id silently no-ops — no tax write.
          const preset = taxRates.find((r) => r.id === pick.taxRateId)
          if (preset) {
            void saveMultipleAsync(docRecordId, [
              {
                fieldId: `${billingPrefix}_tax_name`,
                value: preset.name,
                fieldType: FieldType.TEXT,
              },
              {
                fieldId: `${billingPrefix}_tax_rate`,
                value: preset.rate,
                fieldType: FieldType.NUMBER,
              },
            ])
          }
        }
      }
    },
    [
      documentType,
      documentRecordId,
      docRecordId,
      hasBilling,
      billingPrefix,
      billingValues,
      taxRates,
      saveMultipleAsync,
      createMutateAsync,
      refresh,
    ]
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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!entityDefinitionId || !over || active.id === over.id) return
      const current = displayIdsRef.current
      const oldIndex = current.indexOf(String(active.id))
      const newIndex = current.indexOf(String(over.id))
      if (oldIndex === -1 || newIndex === -1) return

      const nextOrder = arrayMove(current, oldIndex, newIndex)
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
    [entityDefinitionId, docRecordId, reorderMutate, refresh]
  )

  if (!entityDefinitionId) return null

  const isEmpty = !isLoading && !isLoadingRecords && displayRecords.length === 0

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-y-auto rounded-lg bg-primary-50 p-1 dark:bg-background'>
      {/* Header — same grid template as the rows, so the labels sit over their columns.
          The Description label offsets past the row px-1 + grip slot + title/button padding. */}
      <div
        className='sticky top-0 z-10 grid border-primary-200/50 border-b bg-primary-50 px-1 pb-1 text-muted-foreground text-xs dark:border-[#1e2227] dark:bg-background'
        style={{ gridTemplateColumns: LINE_COLS }}>
        <div className={readOnly ? 'pl-2' : 'pl-9'}>Description</div>
        <div className='px-2 text-right'>Qty</div>
        <div className='px-2 text-right'>Unit cost</div>
        <div className='px-2 text-right'>Total</div>
        <div />
      </div>

      {isEmpty && readOnly ? (
        <EmptyState icon={ReceiptText} title='No line items' />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          modifiers={[restrictToVerticalAxis]}>
          <SortableContext
            items={displayIdsRef.current}
            strategy={verticalListSortingStrategy}
            disabled={readOnly}>
            {displayRecords.map((record) => (
              <LineRow
                key={record.id}
                record={record}
                entityDefinitionId={entityDefinitionId}
                readOnly={readOnly}
                currencyCode={currencyCode}
                descriptionOpen={openDescriptionIds.has(record.id)}
                toggleDescription={toggleDescription}
                closeDescription={closeDescription}
                deleteLine={deleteLine}
                onSelectGroup={handleGroupPick}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}

      {!readOnly && (
        <div className='border-primary-200/50 border-b px-1 py-0.5 dark:border-[#1e2227]'>
          <Button
            variant='ghost'
            size='sm'
            className='text-muted-foreground'
            loading={createRecord.isPending}
            onClick={addLine}>
            <Plus />
            Add line item
          </Button>
        </div>
      )}

      <TotalsFooter
        documentRecordId={docRecordId}
        documentType={documentType}
        readOnly={readOnly}
        currencyCode={currencyCode}
        lineRecordIds={lineRecordIds}
      />
    </div>
  )
}
