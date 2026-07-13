// apps/web/src/components/money/ui/line-builder/line-rows.tsx

'use client'

// Row + cell components for the line-items builder (line-builder.tsx). Split
// out once the builder file crossed the ~800-line component threshold
// (CLAUDE.md "Component Architecture"): this file owns the presentational
// cell views, their store-bound wrappers for real (persisted) rows, and the
// two row shells (`LineRow` for real records, `DraftLineRow` for phantom
// draft lines — see line-builder.tsx's file-header comment for the draft
// lifecycle). `LineBuilder` itself (state, mutations, data fetching) stays in
// line-builder.tsx.

import { FieldType } from '@auxx/database/enums'
import { computeLineTotal } from '@auxx/lib/money/client'
import { Button } from '@auxx/ui/components/button'
import { GridTreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AlignLeft, GripVertical, Percent, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { type RecordId, type RecordMeta, toRecordId } from '~/components/resources'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { type CatalogGroupPick, type CatalogItemPick, CatalogPicker } from './catalog-picker'
import { formatCurrency, titleCase } from './shared'

/**
 * Shared `grid-template-columns` for the header row and every line row (the
 * mapping-columns.ts idiom) — one template is what keeps the qty / unit cost /
 * total columns aligned. Columns: description (fills) │ qty │ unit cost │
 * total │ actions.
 */
export const LINE_COLS = 'minmax(10rem, 1fr) 4rem 6.5rem 6.5rem 5.5rem'

// Module-level (stable-reference) attribute lists — `useSystemValues` memoizes
// on the array identity, so these must never be inline literals.
const NAME_ATTRS = ['line_item_name', 'line_item_description', 'line_item_category']
const QTY_ATTRS = ['line_item_qty']
const PRICE_ATTRS = ['line_item_unit_price']
const TOTAL_ATTRS = ['line_item_qty', 'line_item_unit_price']
const TAXABLE_ATTRS = ['line_item_taxable']

/**
 * A phantom line row that exists only in local state until its first real
 * commit — no `EntityInstance` behind it yet. `unitPriceCents` mirrors the
 * CURRENCY storage convention (integer cents), matching `line_item_unit_price`.
 */
export interface DraftLine {
  draftId: string
  name: string
  description: string | null
  category: string | null
  taxable: boolean
  qty: number
  unitPriceCents: number | null
  catalogItemRecordId: RecordId | null
  creating: boolean
}

export function freshDraft(draftId: string): DraftLine {
  return {
    draftId,
    name: '',
    description: null,
    category: null,
    taxable: true,
    qty: 1,
    unitPriceCents: null,
    catalogItemRecordId: null,
    creating: false,
  }
}

/** The document-relationship field a new line_item is stamped with, by document type. */
export function relKeyForDocumentType(documentType: 'quote' | 'work_order' | 'invoice'): string {
  return documentType === 'quote'
    ? 'line_item_quote'
    : documentType === 'invoice'
      ? 'line_item_invoice'
      : 'line_item_work_order'
}

// ─────────────────────────────────────────────────────────────────────────────
// Presentational cells — shared by real (store-bound) rows and draft rows
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Description cell view — a transparent full-width button (the formula-row
 * picker idiom) that opens the catalog combobox (§H.2), doubling as free-text
 * rename. Shows the category chip inline and the description as a second
 * muted line. Purely presentational: values + commit callbacks are props, so
 * both the store-bound real cell and the local-state draft cell render the
 * exact same markup/behavior.
 */
function LineNameCellView({
  name,
  description,
  category,
  readOnly,
  currencyCode,
  rowId,
  descriptionOpen,
  closeDescription,
  initialPickerOpen = false,
  onPickCatalogItem,
  onSelectGroup,
  onFreeText,
  onCommitDescription,
}: {
  name: string
  description: string | null
  category: string | null
  readOnly: boolean
  currencyCode: string
  rowId: string
  descriptionOpen: boolean
  closeDescription: (lineId: string) => void
  /** Fresh drafts mount with the catalog picker already open. */
  initialPickerOpen?: boolean
  onPickCatalogItem: (pick: CatalogItemPick) => void
  onSelectGroup: (pick: CatalogGroupPick) => void
  onFreeText: (text: string) => void
  onCommitDescription: (value: string | null) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(initialPickerOpen)
  const [descriptionDraft, setDescriptionDraft] = useState<string | null>(null)
  const descriptionVisible = !!description || descriptionOpen

  const commitDescription = () => {
    if (descriptionDraft === null) return
    const next = descriptionDraft.trim()
    onCommitDescription(next || null)
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
          onSelectCatalogItem={onPickCatalogItem}
          onSelectGroup={onSelectGroup}
          onFreeText={onFreeText}>
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

/** Store-bound wrapper around {@link LineNameCellView} for real (persisted) line rows. */
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

  const name = (values.line_item_name as string | undefined) ?? ''
  const description = (values.line_item_description as string | null | undefined) ?? null
  const category = (values.line_item_category as string | null | undefined) ?? null

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

  return (
    <LineNameCellView
      name={name}
      description={description}
      category={category}
      readOnly={readOnly}
      currencyCode={currencyCode}
      rowId={rowId}
      descriptionOpen={descriptionOpen}
      closeDescription={closeDescription}
      onPickCatalogItem={handlePick}
      onSelectGroup={onSelectGroup}
      onFreeText={(text) => saveFieldValue(recordId, 'line_item_name', text, FieldType.TEXT)}
      onCommitDescription={(value) =>
        saveFieldValue(recordId, 'line_item_description', value, FieldType.TEXT)
      }
    />
  )
}

/**
 * Chromeless inline number editor view — quiet at rest, editable on click (the
 * cell-treatment lock in 01-ui #1). Commits on blur/Enter, no-ops if the value
 * didn't actually change.
 */
function InlineNumberCellView({
  value,
  attr,
  readOnly,
  currencyCode,
  onCommit,
}: {
  value: number | null
  attr: 'line_item_qty' | 'line_item_unit_price'
  readOnly: boolean
  currencyCode: string
  onCommit: (next: number | null) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)

  const display =
    attr === 'line_item_unit_price'
      ? formatCurrency(value ?? null, currencyCode)
      : value !== null && value !== undefined
        ? String(value)
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
    if (next === (value ?? null)) return
    onCommit(next)
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
          value !== null && value !== undefined
            ? String(attr === 'line_item_unit_price' ? value / 100 : value)
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

/** Store-bound wrapper around {@link InlineNumberCellView} for real line rows. */
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

  const raw = (values[attr] as number | null | undefined) ?? null

  return (
    <InlineNumberCellView
      value={raw}
      attr={attr}
      readOnly={readOnly}
      currencyCode={currencyCode}
      onCommit={(next) => saveFieldValue(recordId, attr, next, fieldType)}
    />
  )
}

/** Read-only computed line total view — `computeLineTotal` over plain values. */
function LineTotalCellView({
  qty,
  unitPrice,
  currencyCode,
}: {
  qty: number
  unitPrice: number | null
  currencyCode: string
}) {
  const lineTotal = computeLineTotal(qty, unitPrice)
  return (
    <div className='w-full px-2 text-right text-muted-foreground text-sm tabular-nums'>
      {formatCurrency(lineTotal, currencyCode)}
    </div>
  )
}

/** Store-bound wrapper around {@link LineTotalCellView} for real line rows. */
function LineTotalCell({ recordId, currencyCode }: { recordId: RecordId; currencyCode: string }) {
  const { values } = useSystemValues(recordId, TOTAL_ATTRS, { autoFetch: true })

  const qty = (values.line_item_qty as number | null | undefined) ?? 1
  const unitPrice = (values.line_item_unit_price as number | null | undefined) ?? null

  return <LineTotalCellView qty={qty} unitPrice={unitPrice} currencyCode={currencyCode} />
}

/** Trailing hover actions view: description toggle · taxable toggle · delete (no confirm). */
function LineActionsCellView({
  taxable,
  rowId,
  toggleDescription,
  onToggleTaxable,
  deleteLine,
}: {
  taxable: boolean
  rowId: string
  toggleDescription: (lineId: string) => void
  onToggleTaxable: (next: boolean) => void
  deleteLine: (lineId: string) => void
}) {
  return (
    <div className='flex w-full items-center justify-end gap-1 pr-1'>
      <TreeRowButton tooltipText='Description' onClick={() => toggleDescription(rowId)}>
        <AlignLeft />
      </TreeRowButton>
      <TreeRowButton
        tooltipText={taxable ? 'Taxable — click to exempt' : 'Tax exempt — click to tax'}
        className={cn(!taxable && 'text-muted-foreground/40')}
        onClick={() => onToggleTaxable(!taxable)}>
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

/** Store-bound wrapper around {@link LineActionsCellView} for real line rows. */
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
    <LineActionsCellView
      taxable={taxable}
      rowId={rowId}
      toggleDescription={toggleDescription}
      onToggleTaxable={(next) =>
        saveFieldValue(recordId, 'line_item_taxable', next, FieldType.CHECKBOX)
      }
      deleteLine={deleteLine}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Rows
// ─────────────────────────────────────────────────────────────────────────────

/** One sortable line row — a GridTreeRow whose leading icon is the drag grip. */
export function LineRow({
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

/**
 * A phantom draft line row — same `GridTreeRow` layout as {@link LineRow}, wired
 * to local draft state instead of the field-value store. Not drag-sortable
 * (empty, disabled icon slot in place of the grip, so columns stay aligned).
 * Every commit callback routes through `createDraft`, which fires the record's
 * first `record.create` on the draft's first real edit.
 */
export function DraftLineRow({
  draft,
  currencyCode,
  descriptionOpen,
  toggleDescription,
  closeDescription,
  deleteDraft,
  createDraft,
  onSelectGroup,
}: {
  draft: DraftLine
  currencyCode: string
  descriptionOpen: boolean
  toggleDescription: (lineId: string) => void
  closeDescription: (lineId: string) => void
  deleteDraft: (draftId: string) => void
  createDraft: (draftId: string, overrides?: Partial<DraftLine>) => Promise<void>
  onSelectGroup: (draftId: string, pick: CatalogGroupPick) => void
}) {
  return (
    <GridTreeRow
      columns={LINE_COLS}
      icon={
        <span className='flex items-center justify-center opacity-0'>
          <GripVertical className='size-3.5' />
        </span>
      }
      title={
        <LineNameCellView
          name={draft.name}
          description={draft.description}
          category={draft.category}
          readOnly={false}
          currencyCode={currencyCode}
          rowId={draft.draftId}
          descriptionOpen={descriptionOpen}
          closeDescription={closeDescription}
          initialPickerOpen
          onPickCatalogItem={(pick) =>
            void createDraft(draft.draftId, {
              name: pick.name,
              description: pick.description,
              category: pick.category,
              taxable: pick.taxable,
              unitPriceCents: pick.unitPrice,
              catalogItemRecordId: pick.recordId,
            })
          }
          onSelectGroup={(pick) => onSelectGroup(draft.draftId, pick)}
          onFreeText={(text) => void createDraft(draft.draftId, { name: text })}
          onCommitDescription={(value) => void createDraft(draft.draftId, { description: value })}
        />
      }
      cells={[
        <InlineNumberCellView
          key='qty'
          value={draft.qty}
          attr='line_item_qty'
          readOnly={false}
          currencyCode={currencyCode}
          onCommit={(next) => {
            if (next === null) return
            void createDraft(draft.draftId, { qty: next })
          }}
        />,
        <InlineNumberCellView
          key='price'
          value={draft.unitPriceCents}
          attr='line_item_unit_price'
          readOnly={false}
          currencyCode={currencyCode}
          onCommit={(next) => void createDraft(draft.draftId, { unitPriceCents: next })}
        />,
        <LineTotalCellView
          key='total'
          qty={draft.qty}
          unitPrice={draft.unitPriceCents}
          currencyCode={currencyCode}
        />,
        <LineActionsCellView
          key='actions'
          taxable={draft.taxable}
          rowId={draft.draftId}
          toggleDescription={toggleDescription}
          onToggleTaxable={(next) => void createDraft(draft.draftId, { taxable: next })}
          deleteLine={deleteDraft}
        />,
      ]}
    />
  )
}
