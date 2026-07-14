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
//
// Keyboard model (use-line-nav.ts): rows are a plain `group/tree-row grid`
// (not the tree `GridTreeRow` — we only kept its `TreeRowButton` hover-action
// primitive). Each navigable cell carries `data-line-row`/`data-line-col` so a
// single container-level keydown listener can move focus spreadsheet-style
// across name → qty → unit cost, adding a fresh draft when nav lands past the
// last row. The name cell is a free-text `<input>`: type any product name, or
// press `/` on an empty cell (or click the trailing pick icon) to open the
// catalog picker and drop in a pre-existing product.

import { FieldType } from '@auxx/database/enums'
import { computeLineTotal } from '@auxx/lib/money/client'
import { AutosizeTextarea } from '@auxx/ui/components/autosize-textarea'
import { Badge } from '@auxx/ui/components/badge'
import { SimpleTooltip, TooltipExplanation } from '@auxx/ui/components/tooltip'
import { TreeRowButton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  AlignLeft,
  Check,
  CircleCheck,
  CircleX,
  GripVertical,
  PackageSearch,
  Trash2,
  X,
} from 'lucide-react'
import { type ReactNode, useRef, useState } from 'react'
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
export const LINE_COLS = 'minmax(10rem, 1fr) 3rem 5.5rem 6.5rem 3.75rem'

/**
 * Read-only column template — the trailing actions column is dropped (no
 * hover actions when read-only), so `Total` lands flush right and the freed
 * width is absorbed by the `1fr` description column.
 */
export const LINE_COLS_READONLY = 'minmax(10rem, 1fr) 3rem 5.5rem 6.5rem'

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
// The plain grid row shell (replaces GridTreeRow)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One line's grid row — a `group/tree-row` so the hover-revealed
 * `TreeRowButton`s (grip, pick, description, taxable, delete) still fade in on
 * row hover. Owns the shared column template + the `data-line-row`/`col` tags
 * that {@link useLineNav} focus-hops between. Name/qty/price are the three
 * navigable cells (cols 0–2); total + actions ride outside the nav order.
 */
function LineGridRow({
  rowIndex,
  readOnly,
  grip,
  name,
  qty,
  price,
  total,
  actions,
}: {
  rowIndex: number
  readOnly: boolean
  grip: ReactNode
  name: ReactNode
  qty: ReactNode
  price: ReactNode
  total: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className='group/tree-row relative text-sm'>
      {/* Drag grip — lives in the left gutter, OUTSIDE the framed grid. */}
      {grip}

      {/* Hover background — a standalone layer behind the grid columns. */}
      <div className='absolute inset-0 rounded-md transition-colors group-hover/tree-row:bg-background' />

      <div
        className='relative grid min-h-9 items-stretch px-1 text-muted-foreground'
        style={{ gridTemplateColumns: readOnly ? LINE_COLS_READONLY : LINE_COLS }}>
        {/* Col 0 — name input (the grip sits in the gutter, not this column). */}
        <div data-line-row={rowIndex} data-line-col={0} className='flex min-w-0 items-center'>
          {name}
        </div>

        <div data-line-row={rowIndex} data-line-col={1} className='flex items-center'>
          {qty}
        </div>
        <div data-line-row={rowIndex} data-line-col={2} className='flex items-center'>
          {price}
        </div>
        <div className='flex items-center'>{total}</div>
        {!readOnly && <div className='flex items-center justify-end'>{actions}</div>}
      </div>
    </div>
  )
}

/**
 * Drag grip pinned into the left gutter — a small bordered box centered on the
 * frame's left edge (the `-left-2.5` offset straddles the border). Revealed only
 * on row hover; draft rows render no grip at all (they aren't sortable).
 */
function GripSlot({
  attributes,
  listeners,
}: {
  attributes?: Record<string, unknown>
  listeners?: Record<string, unknown>
}) {
  return (
    <span
      {...attributes}
      {...listeners}
      className='-left-2.5 -translate-y-1/2 absolute top-1/2 flex h-5 w-5 cursor-grab items-center justify-center rounded-md border bg-background text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover/tree-row:opacity-100'>
      <GripVertical className='size-3.5' />
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Presentational cells — shared by real (store-bound) rows and draft rows
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compact category badge — a single-letter pill (S/M) colored per category
 * (service → blue, material → orange), with the full category label revealed
 * on hover. Unknown/org-added categories fall back to a neutral badge showing
 * the title-cased value. Renders nothing when there is no category.
 */
function CategoryBadge({ category }: { category: string | null }) {
  if (!category) return null

  const known: Record<string, { letter: string; variant: 'blue' | 'orange' }> = {
    service: { letter: 'S', variant: 'blue' },
    material: { letter: 'M', variant: 'orange' },
  }
  const match = known[category]
  const label = titleCase(category)

  return (
    <SimpleTooltip content={label}>
      <Badge
        size='xs'
        variant={match?.variant ?? 'gray'}
        className='shrink-0 font-medium leading-tight'>
        {match?.letter ?? label}
      </Badge>
    </SimpleTooltip>
  )
}

/**
 * Primary line cell — a free-text name `<input>` that owns everything about the
 * item. Type any product name (an ad-hoc line, no catalog rel); press `/` on an
 * empty cell (or click the trailing pick icon) to open the catalog picker and
 * drop in a pre-existing product, which overwrites name/price/category/taxable
 * and keeps the catalog relationship. The category badge sits inline; a trailing
 * description-edit affordance swaps the input for an autosize textarea in place —
 * the line never grows a permanent second row. Purely presentational: values +
 * commit callbacks are props, so both the store-bound real cell and the
 * local-state draft cell render the exact same markup.
 */
function LineNameCellView({
  name,
  description,
  category,
  readOnly,
  currencyCode,
  autoFocus = false,
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
  /** Focus the name input on mount — set for a freshly added draft row. */
  autoFocus?: boolean
  onPickCatalogItem: (pick: CatalogItemPick) => void
  onSelectGroup: (pick: CatalogGroupPick) => void
  onFreeText: (text: string) => void
  onCommitDescription: (value: string | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  // `null` = not typing; any string (incl. '') = the in-progress name edit.
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  // `null` = not editing description; any string (incl. '') = in-progress text.
  const [descriptionDraft, setDescriptionDraft] = useState<string | null>(null)
  const editing = descriptionDraft !== null
  // At rest the name is a plain text label (+ category badge); on focus it swaps
  // to the free-text input and reveals the pick/description actions. A freshly
  // added draft (`autoFocus`) opens straight into the input.
  const [focused, setFocused] = useState(autoFocus)

  const commitName = () => {
    if (nameDraft === null) return
    const trimmed = nameDraft.trim()
    setNameDraft(null)
    // Only commit a non-empty change: an emptied cell keeps its previous name
    // (mirrors the qty cell) and never spawns an empty-named draft record.
    if (trimmed && trimmed !== name) onFreeText(trimmed)
  }

  const confirmDescription = () => {
    if (descriptionDraft === null) return
    onCommitDescription(descriptionDraft.trim() || null)
    setDescriptionDraft(null)
  }

  // Description edit mode — replaces the input with an autosize textarea in the
  // same slot (single line at rest, grows while typing) + confirm/cancel. The
  // grid nav hook leaves textareas fully native, so Enter confirms here.
  if (editing) {
    return (
      <div className='flex min-w-0 flex-1 items-center gap-1 py-1'>
        <AutosizeTextarea
          value={descriptionDraft ?? ''}
          onChange={(e) => setDescriptionDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              confirmDescription()
            }
            if (e.key === 'Escape') setDescriptionDraft(null)
          }}
          autoFocus
          minHeight={28}
          maxHeight={160}
          placeholder='Description'
          className='min-w-0 flex-1 resize-none rounded-sm border-primary-200/60 bg-transparent px-2 py-1 text-muted-foreground text-xs'
        />
        <TreeRowButton persistent tooltipText='Save description' onClick={confirmDescription}>
          <Check />
        </TreeRowButton>
        <TreeRowButton
          persistent
          variant='destructive'
          tooltipText='Cancel'
          onClick={() => setDescriptionDraft(null)}>
          <X />
        </TreeRowButton>
      </div>
    )
  }

  if (readOnly) {
    return (
      <div className='flex min-w-0 flex-1 items-center gap-1.5 py-1'>
        <span
          className={cn('min-w-0 truncate px-1 text-sm', !name && 'text-muted-foreground italic')}>
          {name || 'Untitled line'}
        </span>
        <CategoryBadge category={category} />
        {description && <TooltipExplanation text={description} />}
      </div>
    )
  }

  const value = nameDraft ?? name

  return (
    <div className='flex min-w-0 flex-1 items-center gap-1.5 py-1'>
      {/* CatalogPicker stays mounted across the text↔input swap so its popover
          anchor never detaches; only its inner trigger changes shape. */}
      <CatalogPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        initialQuery={value}
        currencyCode={currencyCode}
        onSelectCatalogItem={onPickCatalogItem}
        onSelectGroup={onSelectGroup}
        onFreeText={onFreeText}
        onCloseFocus={() => inputRef.current?.focus()}>
        <div className='flex min-w-0 flex-1 items-center gap-1.5'>
          {focused ? (
            <input
              ref={inputRef}
              data-cell-focusable
              autoFocus
              value={value}
              onChange={(e) => setNameDraft(e.target.value)}
              onFocus={() => setNameDraft(name)}
              onBlur={() => {
                commitName()
                // Collapse back to text, unless the picker took focus (its own
                // input blurs us) — then stay in edit mode behind the popover.
                if (!pickerOpen) setFocused(false)
              }}
              onKeyDown={(e) => {
                // `/` on an empty cell opens the picker; typed anywhere else it's a
                // literal slash (e.g. "1/2 inch pipe").
                if (e.key === '/' && value === '') {
                  e.preventDefault()
                  setPickerOpen(true)
                }
              }}
              placeholder='Add item or press /'
              className='h-7 min-w-0 flex-1 rounded-sm border-none bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground/50'
            />
          ) : (
            <button
              type='button'
              data-cell-focusable
              onFocus={() => setFocused(true)}
              onClick={() => setFocused(true)}
              className='flex h-7 min-w-0 items-center rounded-sm px-1 text-left text-sm outline-none'>
              <span className={cn('min-w-0 truncate', !name && 'text-muted-foreground/50')}>
                {name || 'Add item'}
              </span>
            </button>
          )}
          {/* Category badge sits next to the label; hidden while editing the name. */}
          {!focused && <CategoryBadge category={category} />}
        </div>
      </CatalogPicker>

      {/* Actions only while focused. `onMouseDown` preventDefault keeps the input
          from blur-collapsing before the click handler runs. */}
      {focused && (
        <>
          <TreeRowButton
            persistent
            className='ml-auto'
            tooltipText='Pick product'
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setPickerOpen(true)}>
            <PackageSearch />
          </TreeRowButton>
          <TreeRowButton
            persistent
            tooltipText={description || 'Add description'}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setDescriptionDraft(description ?? '')}>
            <AlignLeft />
          </TreeRowButton>
        </>
      )}
    </div>
  )
}

/** Store-bound wrapper around {@link LineNameCellView} for real (persisted) line rows. */
function LineNameCell({
  recordId,
  readOnly,
  currencyCode,
  onSelectGroup,
}: {
  recordId: RecordId
  readOnly: boolean
  currencyCode: string
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
        if (e.key === 'Escape') setDraft(null)
      }}
      inputMode='decimal'
      className='h-full w-full rounded-sm border-none bg-transparent px-2 text-right text-sm tabular-nums outline-none'
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

/**
 * Trailing actions cell — taxable toggle (persistent when exempt, so the
 * exemption reads at rest) then delete. Description editing lives in the primary
 * cell ({@link LineNameCellView}); this column holds the two remaining actions
 * for both real rows and drafts.
 */
function LineActionsCellView({
  taxable,
  rowId,
  onToggleTaxable,
  deleteLine,
}: {
  taxable: boolean
  rowId: string
  onToggleTaxable: (next: boolean) => void
  deleteLine: (lineId: string) => void
}) {
  return (
    <div className='flex w-full items-center justify-end gap-0.5 pr-1'>
      <TreeRowButton
        persistent={!taxable}
        tooltipText={taxable ? 'Taxable — click to exempt' : 'Tax exempt — click to tax'}
        className={cn(!taxable && 'text-muted-foreground/50')}
        onClick={() => onToggleTaxable(!taxable)}>
        {taxable ? <CircleCheck /> : <CircleX />}
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
  deleteLine,
}: {
  recordId: RecordId
  rowId: string
  deleteLine: (lineId: string) => void
}) {
  const { values } = useSystemValues(recordId, TAXABLE_ATTRS, { autoFetch: true })
  const { saveFieldValue } = useSaveFieldValue()

  const taxable = (values.line_item_taxable as boolean | undefined) !== false

  return (
    <LineActionsCellView
      taxable={taxable}
      rowId={rowId}
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

/** One sortable line row — a grid row whose leading slot is the drag grip. */
export function LineRow({
  record,
  rowIndex,
  entityDefinitionId,
  readOnly,
  currencyCode,
  deleteLine,
  onSelectGroup,
}: {
  record: RecordMeta
  rowIndex: number
  entityDefinitionId: string
  readOnly: boolean
  currencyCode: string
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
      <LineGridRow
        rowIndex={rowIndex}
        readOnly={readOnly}
        grip={readOnly ? null : <GripSlot attributes={attributes} listeners={listeners} />}
        name={
          <LineNameCell
            recordId={recordId}
            readOnly={readOnly}
            currencyCode={currencyCode}
            onSelectGroup={(pick) => onSelectGroup(recordId, pick)}
          />
        }
        qty={
          <InlineNumberCell
            recordId={recordId}
            attr='line_item_qty'
            fieldType={FieldType.NUMBER}
            readOnly={readOnly}
            currencyCode={currencyCode}
          />
        }
        price={
          <InlineNumberCell
            recordId={recordId}
            attr='line_item_unit_price'
            fieldType={FieldType.CURRENCY}
            readOnly={readOnly}
            currencyCode={currencyCode}
          />
        }
        total={<LineTotalCell recordId={recordId} currencyCode={currencyCode} />}
        actions={
          readOnly ? undefined : (
            <LineActionsCell recordId={recordId} rowId={record.id} deleteLine={deleteLine} />
          )
        }
      />
    </div>
  )
}

/**
 * A phantom draft line row — same grid layout as {@link LineRow}, wired to local
 * draft state instead of the field-value store. Not drag-sortable (empty,
 * disabled grip slot in place of the handle, so columns stay aligned). Every
 * commit callback routes through `createDraft`, which fires the record's first
 * `record.create` on the draft's first real edit.
 */
export function DraftLineRow({
  draft,
  rowIndex,
  autoFocus,
  currencyCode,
  deleteDraft,
  createDraft,
  onSelectGroup,
}: {
  draft: DraftLine
  rowIndex: number
  /** Focus the name input on mount — set for the just-added draft. */
  autoFocus: boolean
  currencyCode: string
  deleteDraft: (draftId: string) => void
  createDraft: (draftId: string, overrides?: Partial<DraftLine>) => Promise<void>
  onSelectGroup: (draftId: string, pick: CatalogGroupPick) => void
}) {
  return (
    <LineGridRow
      rowIndex={rowIndex}
      readOnly={false}
      grip={null}
      name={
        <LineNameCellView
          name={draft.name}
          description={draft.description}
          category={draft.category}
          readOnly={false}
          currencyCode={currencyCode}
          autoFocus={autoFocus}
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
      qty={
        <InlineNumberCellView
          value={draft.qty}
          attr='line_item_qty'
          readOnly={false}
          currencyCode={currencyCode}
          onCommit={(next) => {
            if (next === null) return
            void createDraft(draft.draftId, { qty: next })
          }}
        />
      }
      price={
        <InlineNumberCellView
          value={draft.unitPriceCents}
          attr='line_item_unit_price'
          readOnly={false}
          currencyCode={currencyCode}
          onCommit={(next) => void createDraft(draft.draftId, { unitPriceCents: next })}
        />
      }
      total={
        <LineTotalCellView
          qty={draft.qty}
          unitPrice={draft.unitPriceCents}
          currencyCode={currencyCode}
        />
      }
      actions={
        <LineActionsCellView
          taxable={draft.taxable}
          rowId={draft.draftId}
          onToggleTaxable={(next) => void createDraft(draft.draftId, { taxable: next })}
          deleteLine={deleteDraft}
        />
      }
    />
  )
}
