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
import { AutosizeTextarea } from '@auxx/ui/components/autosize-textarea'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { SimpleTooltip, TooltipExplanation } from '@auxx/ui/components/tooltip'
import { GridTreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AlignLeft, Check, CircleCheck, CircleX, GripVertical, Trash2, X } from 'lucide-react'
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
 * Primary line cell — a single-line row that owns everything about the item:
 * the catalog picker (transparent full-width button, doubling as free-text
 * rename), the category badge, a description help-tooltip (when set), and the
 * trailing description-edit affordance. Editing the description swaps the picker
 * in place for an autosize textarea with confirm/cancel — the line never grows a
 * permanent second row. Purely presentational: values + commit callbacks are
 * props, so both the store-bound real cell and the local-state draft cell render
 * the exact same markup.
 */
function LineNameCellView({
  name,
  description,
  category,
  readOnly,
  currencyCode,
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
  /** Fresh drafts mount with the catalog picker already open. */
  initialPickerOpen?: boolean
  onPickCatalogItem: (pick: CatalogItemPick) => void
  onSelectGroup: (pick: CatalogGroupPick) => void
  onFreeText: (text: string) => void
  onCommitDescription: (value: string | null) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(initialPickerOpen)
  // `null` = not editing; any string (incl. '') = the in-progress description.
  const [descriptionDraft, setDescriptionDraft] = useState<string | null>(null)
  const editing = descriptionDraft !== null

  const confirmDescription = () => {
    if (descriptionDraft === null) return
    onCommitDescription(descriptionDraft.trim() || null)
    setDescriptionDraft(null)
  }

  // Description edit mode — replaces the picker with an autosize textarea in the
  // same slot (single line at rest, grows while typing) + confirm/cancel.
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

  return (
    <div className='flex min-w-0 flex-1 items-center gap-1.5 py-1'>
      {readOnly ? (
        <>
          <span
            className={cn(
              'min-w-0 truncate px-1 text-sm',
              !name && 'text-muted-foreground italic'
            )}>
            {name || 'Untitled line'}
          </span>
          <CategoryBadge category={category} />
        </>
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
              'h-7 min-w-0 flex-1 justify-start gap-1.5 rounded-sm px-1 text-sm hover:bg-primary/5',
              !name && 'text-muted-foreground'
            )}>
            <span className='truncate'>{name || 'Add item…'}</span>
            <CategoryBadge category={category} />
          </Button>
        </CatalogPicker>
      )}

      {/* Read-only rows surface the description via the help-tooltip; editable rows
          drop it — the description-edit button below carries the text as its own
          tooltip instead. */}
      {readOnly && description && <TooltipExplanation text={description} />}

      {!readOnly && (
        <TreeRowButton
          className='ml-auto'
          tooltipText={description || 'Add description'}
          onClick={() => setDescriptionDraft(description ?? '')}>
          <AlignLeft />
        </TreeRowButton>
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

/** One sortable line row — a GridTreeRow whose leading icon is the drag grip. */
export function LineRow({
  record,
  entityDefinitionId,
  readOnly,
  currencyCode,
  deleteLine,
  onSelectGroup,
}: {
  record: RecordMeta
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
      <GridTreeRow
        columns={readOnly ? LINE_COLS_READONLY : LINE_COLS}
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
            readOnly={readOnly}
            currencyCode={currencyCode}
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
          // Read-only rows drop the actions column entirely (LINE_COLS_READONLY),
          // so `Total` sits flush right and description absorbs the freed width.
          ...(readOnly
            ? []
            : [
                <LineActionsCell
                  key='actions'
                  recordId={recordId}
                  rowId={record.id}
                  deleteLine={deleteLine}
                />,
              ]),
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
  deleteDraft,
  createDraft,
  onSelectGroup,
}: {
  draft: DraftLine
  currencyCode: string
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
          onToggleTaxable={(next) => void createDraft(draft.draftId, { taxable: next })}
          deleteLine={deleteDraft}
        />,
      ]}
    />
  )
}
