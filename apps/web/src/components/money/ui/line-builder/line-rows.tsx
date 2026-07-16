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
// (not the tree `GridTreeRow` — we only kept its `TreeRowButton` primitive).
// Each navigable cell carries `data-line-row`/`data-line-col` so a single
// container-level keydown listener can move focus spreadsheet-style across
// name → qty → rate, adding a fresh draft when nav lands past the last row.
//
// Row anatomy: the name cell owns everything textual about the line — name
// input (`/` or the pick button opens the catalog picker), state badges
// (category / tax-exempt / optional, clickable to change), a description
// button when one exists, and the `⋯` row menu (description, optional,
// taxable, delete). Qty/rate are chromeless inline editors; total is
// computed. The drag grip floats in the left gutter, hover-revealed.

import { FieldType } from '@auxx/database/enums'
import {
  computeLineTotal,
  formatLineItemUnit,
  LINE_ITEM_UNIT_OPTIONS,
  type LineItemUnit,
  parseQuantityWithUnit,
} from '@auxx/lib/money/client'
import { AutosizeTextarea } from '@auxx/ui/components/autosize-textarea'
import { Badge, type Variant } from '@auxx/ui/components/badge'
import { Checkbox } from '@auxx/ui/components/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Kbd, KbdGroup } from '@auxx/ui/components/kbd'
import { SimpleTooltip, TooltipExplanation } from '@auxx/ui/components/tooltip'
import { TreeRowButton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  AlignLeft,
  Check,
  ChevronsUpDown,
  CircleCheck,
  CircleX,
  Ellipsis,
  GripVertical,
  PackageSearch,
  Plus,
  Tag,
  Trash2,
  X,
} from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { type RecordId, type RecordMeta, toRecordId } from '~/components/resources'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { type CatalogGroupPick, type CatalogItemPick, CatalogPicker } from './catalog-picker'
import { formatCurrency, titleCase } from './shared'
import { LINE_ROW_ACTION_EVENT, type LineRowAction } from './use-line-hotkeys'

/**
 * Shared `grid-template-columns` for the header row and every line row (the
 * mapping-columns.ts idiom) — one template is what keeps the qty / rate /
 * total columns aligned. Columns: description (fills) │ qty (sized for a
 * smart `2.375 cy` quantity+unit cell, money plan 13 §5) │ rate │ total.
 */
export const LINE_COLS = 'minmax(10rem, 1fr) 5.5rem 5.5rem 6.5rem'

// Module-level (stable-reference) attribute lists — `useSystemValues` memoizes
// on the array identity, so these must never be inline literals. Taxable rides
// with the name attrs: everything that shows it (rest badge, `⋯` menu toggle)
// lives in the name cell.
const NAME_ATTRS = [
  'line_item_name',
  'line_item_description',
  'line_item_category',
  'line_item_taxable',
]
const QTY_ATTRS = ['line_item_qty', 'line_item_unit']
const PRICE_ATTRS = ['line_item_unit_price']
const TOTAL_ATTRS = ['line_item_qty', 'line_item_unit_price']
// Optional/optionalSelected (money plan 18 §3) — quotes only; `LineRow` gates the
// fetch on `documentType === 'quote'` so non-quote surfaces never subscribe.
const OPTIONAL_ATTRS = ['line_item_optional', 'line_item_optional_selected']

/**
 * One selectable line category — the builder receives these from the
 * `line_item.category` field definition (via `useResourceFields` in
 * line-builder.tsx), so org-added categories show up alongside the seeded
 * service/material/labor set with their own labels and colors.
 */
export interface CategoryOption {
  value: string
  label: string
  color?: string
}

// Field-option colors are tailwind color names, which the Badge color variants
// mirror — anything unrecognized falls back to the neutral gray badge.
const BADGE_COLOR_VARIANTS = new Set([
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'magenta',
  'pink',
  'rose',
  'zinc',
  'gray',
])

function badgeVariantForColor(color: string | undefined): Variant {
  return color && BADGE_COLOR_VARIANTS.has(color) ? (color as Variant) : 'gray'
}

/**
 * A phantom line row that exists only in local state until its first real
 * commit — no `EntityInstance` behind it yet. `unitPriceCents` mirrors the
 * CURRENCY storage convention (integer cents), matching `line_item_unit_price`.
 * `unit`/`optional`/`optionalSelected` mirror `line_item_unit`/`line_item_optional`/
 * `line_item_optional_selected` (money plans 13 §5, 18 §3).
 */
export interface DraftLine {
  draftId: string
  name: string
  description: string | null
  category: string | null
  taxable: boolean
  qty: number
  unit: LineItemUnit | null
  unitPriceCents: number | null
  /** Customer-selectable upsell (quotes only) — always `false` outside quote builders. */
  optional: boolean
  /** Pre-check state; meaningful only when `optional` is true. */
  optionalSelected: boolean
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
    unit: 'each',
    unitPriceCents: null,
    optional: false,
    optionalSelected: true,
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
 * One line's grid row — a `group/tree-row` so hover-revealed chrome (the drag
 * grip) fades in on row hover. Owns the shared column template + the
 * `data-line-row`/`col` tags that {@link useLineNav} focus-hops between.
 * Name/qty/price are the three navigable cells (cols 0–2); total rides
 * outside the nav order.
 */
function LineGridRow({
  rowIndex,
  grip,
  name,
  qty,
  price,
  total,
  optional = false,
}: {
  rowIndex: number
  grip: ReactNode
  name: ReactNode
  qty: ReactNode
  price: ReactNode
  total: ReactNode
  /** Muted/indented treatment for a deselectable quote line (money plan 18 §3). */
  optional?: boolean
}) {
  return (
    <div className={cn('group/tree-row relative text-sm', optional && 'opacity-75')}>
      {/* Drag grip — lives in the left gutter, OUTSIDE the framed grid. */}
      {grip}

      {/* Hover background — a standalone layer behind the grid columns. */}
      <div className='absolute inset-0 rounded-md transition-colors group-hover/tree-row:bg-background' />

      <div
        className={cn(
          'relative grid min-h-9 items-stretch px-1 text-muted-foreground',
          optional && 'pl-3'
        )}
        style={{ gridTemplateColumns: LINE_COLS }}>
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
 * Compact category badge — a single-letter pill (S/M/L…) whose letter and
 * color derive from the field definition's option list, with the full label in
 * a tooltip. Only rendered when the line HAS a category; editable rows make
 * the badge a dropdown trigger for switching category (or clearing it).
 * The menu is controlled (`open`/`onOpenChange`) so the category shortcut and
 * the `⋯` menu's "Set category" can open it on an uncategorized line — a
 * transient `+` badge anchors the popover only while it's held open.
 * Values no longer in the option list (an org removed the option) fall back
 * to a neutral badge with the title-cased value.
 */
function CategoryBadge({
  category,
  options,
  readOnly,
  open,
  onOpenChange,
  onCommitCategory,
}: {
  category: string | null
  options: CategoryOption[]
  readOnly: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onCommitCategory: (value: string | null) => void
}) {
  const option = options.find((o) => o.value === category) ?? null
  const label = option?.label ?? (category ? titleCase(category) : null)
  const letter = label?.charAt(0).toUpperCase() ?? null

  if (readOnly) {
    if (!category) return null
    return (
      <SimpleTooltip content={label ?? undefined}>
        <Badge
          size='xs'
          variant={badgeVariantForColor(option?.color)}
          className='shrink-0 font-medium leading-tight'>
          {letter}
        </Badge>
      </SimpleTooltip>
    )
  }

  // No badge at rest without a category — the menu (and its `+` anchor badge)
  // mounts only while the shortcut / `⋯` action holds it open.
  if (!category && !open) return null

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <SimpleTooltip content={label ?? 'Set category'} allowInteraction>
        <DropdownMenuTrigger asChild>
          <Badge
            asChild
            size='xs'
            variant={category ? badgeVariantForColor(option?.color) : 'gray'}
            className='shrink-0 cursor-pointer font-medium leading-tight'>
            {/* stopPropagation: the surrounding name-cell wrapper click focuses
                the name input — a badge click must only open this menu. */}
            <button type='button' tabIndex={-1} onClick={(e) => e.stopPropagation()}>
              {category ? letter : <Plus className='size-3' />}
            </button>
          </Badge>
        </DropdownMenuTrigger>
      </SimpleTooltip>
      <DropdownMenuContent align='start'>
        {options.map((o) => (
          <DropdownMenuItem key={o.value} onSelect={() => onCommitCategory(o.value)}>
            {o.label}
            {o.value === category && <Check className='ml-auto size-3.5' />}
          </DropdownMenuItem>
        ))}
        {category && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onCommitCategory(null)}>No category</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Rest-state marker for a tax-exempt line — a struck-through `T`, tooltip-explained. */
function TaxExemptBadge({ taxable }: { taxable: boolean }) {
  if (taxable) return null
  return (
    <SimpleTooltip content='Tax exempt'>
      <Badge size='xs' variant='gray' className='shrink-0 font-medium leading-tight line-through'>
        T
      </Badge>
    </SimpleTooltip>
  )
}

/**
 * "Optional" state tag for a deselectable quote line (money plan 18 §3) — an `O`
 * badge (full word in the tooltip, matching the single-letter category badges)
 * plus an inline pre-check checkbox bound to `optionalSelected`; the checkbox's
 * tooltip carries the "Recommended" meaning a text label used to. On editable
 * rows the badge itself toggles the line back to required (the `⋯` menu's
 * "Mark as optional" is its set-side counterpart). `readOnly` disables
 * the checkbox instead of hiding it, so a read-only builder still shows the
 * customer's current selection.
 */
function OptionalLineTag({
  optionalSelected,
  readOnly,
  onToggleSelected,
  onToggleOptional,
}: {
  optionalSelected: boolean
  readOnly: boolean
  onToggleSelected: (next: boolean) => void
  onToggleOptional: (next: boolean) => void
}) {
  return (
    <span className='flex shrink-0 items-center gap-1.5'>
      {readOnly ? (
        <SimpleTooltip content='Optional — the customer chooses whether to include this line'>
          <Badge size='xs' variant='sky' className='shrink-0 font-medium leading-tight'>
            O
          </Badge>
        </SimpleTooltip>
      ) : (
        <SimpleTooltip content='Optional — click to make required'>
          <Badge
            asChild
            size='xs'
            variant='sky'
            className='shrink-0 cursor-pointer font-medium leading-tight'>
            {/* stopPropagation: the name-cell wrapper click focuses the input. */}
            <button
              type='button'
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation()
                onToggleOptional(false)
              }}>
              O
            </button>
          </Badge>
        </SimpleTooltip>
      )}
      <SimpleTooltip
        content={
          optionalSelected ? 'Recommended — pre-checked for the customer' : 'Not pre-checked'
        }>
        {/* Stops row-level click-through (e.g. a future row-click drill) from firing. */}
        <span className='flex items-center' onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={optionalSelected}
            disabled={readOnly}
            onCheckedChange={(checked) => onToggleSelected(checked === true)}
            className='size-3.5'
          />
        </span>
      </SimpleTooltip>
    </span>
  )
}

/**
 * Primary line cell — a free-text name `<input>` that owns everything about
 * the item. Type any product name (an ad-hoc line, no catalog rel); press `/`
 * on an empty cell (or click the pick button while editing) to open the
 * catalog picker and drop in a pre-existing product, which overwrites
 * name/price/category/taxable and keeps the catalog relationship.
 *
 * Cell anatomy, left to right:
 * - name text (swaps to the input on focus; pick is the one editing-only
 *   action — it rewrites the line's identity, so it belongs to the name edit)
 * - state badges at rest — only for states actually set: category (click to
 *   change), tax-exempt `T`, optional `O` + pre-check checkbox (setting
 *   category comes from a catalog pick; marking optional lives in the `⋯` menu)
 * - standing right-edge controls — a description button (only when a
 *   description exists; ADDING one lives in the `⋯` menu) and the `⋯` row
 *   menu ({@link LineRowMenu}); both in-flow, so they never overlap the
 *   editing UI
 *
 * Editing a description swaps the cell for an autosize textarea in place —
 * the line never grows a permanent second row. Purely presentational: values
 * + commit callbacks are props, so both the store-bound real cell and the
 * local-state draft cell render the exact same markup.
 */
function LineNameCellView({
  name,
  description,
  category,
  categoryOptions,
  taxable,
  readOnly,
  currencyCode,
  autoFocus = false,
  showOptionalControls,
  optional,
  optionalSelected,
  onToggleOptional,
  onToggleOptionalSelected,
  onToggleTaxable,
  onPickCatalogItem,
  onSelectGroup,
  onFreeText,
  onCommitDescription,
  onCommitCategory,
  onDelete,
}: {
  name: string
  description: string | null
  category: string | null
  categoryOptions: CategoryOption[]
  taxable: boolean
  readOnly: boolean
  currencyCode: string
  /** Focus the name input on mount — set for a freshly added draft row. */
  autoFocus?: boolean
  /** Quotes only (money plan 18 §3) — work-order/invoice builders pass `false`. */
  showOptionalControls: boolean
  optional: boolean
  optionalSelected: boolean
  onToggleOptional: (next: boolean) => void
  onToggleOptionalSelected: (next: boolean) => void
  onToggleTaxable: (next: boolean) => void
  onPickCatalogItem: (pick: CatalogItemPick) => void
  onSelectGroup: (pick: CatalogGroupPick) => void
  onFreeText: (text: string) => void
  onCommitDescription: (value: string | null) => void
  onCommitCategory: (value: string | null) => void
  /** Delete this line (real record or draft). */
  onDelete: () => void
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

  // Category menu open state lives here (not in CategoryBadge) so the row
  // shortcut can open it programmatically — including on an uncategorized
  // line, where the badge only mounts while the menu is held open.
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false)

  // The badge cluster only renders at rest (`!focused`), so opening the
  // category menu from a focused input must first commit + collapse the name
  // edit — otherwise the menu's anchor badge wouldn't be mounted.
  const openCategoryMenu = () => {
    commitName()
    setFocused(false)
    setCategoryMenuOpen(true)
  }

  // Row-action shortcuts (use-line-hotkeys.ts) arrive as CustomEvents on the
  // enclosing name cell (`[data-line-col="0"]`) — every action's state or
  // callback lives in this view, so one listener handles all five. The
  // ref-indirection keeps the mount-time listener reading fresh state/props
  // on every dispatch.
  const rootRef = useRef<HTMLDivElement>(null)
  const actionRef = useRef<(action: LineRowAction) => void>(() => {})
  actionRef.current = (action) => {
    switch (action) {
      case 'description':
        // Already editing the description — don't reset the in-progress text.
        if (descriptionDraft === null) setDescriptionDraft(description ?? '')
        break
      case 'category':
        openCategoryMenu()
        break
      case 'optional':
        if (showOptionalControls) onToggleOptional(!optional)
        break
      case 'taxable':
        onToggleTaxable(!taxable)
        break
      case 'delete':
        onDelete()
        break
    }
  }
  useEffect(() => {
    // The cell node is rendered by LineGridRow and outlives this view's
    // branch swaps (rest ↔ description editor), so binding once is safe.
    const cell = rootRef.current?.closest('[data-line-col]')
    if (!cell) return
    const onAction = (e: Event) => actionRef.current((e as CustomEvent<LineRowAction>).detail)
    cell.addEventListener(LINE_ROW_ACTION_EVENT, onAction)
    return () => cell.removeEventListener(LINE_ROW_ACTION_EVENT, onAction)
  }, [])

  // The at-rest state-badge cluster — shared verbatim by the read-only and
  // editable renders below; each badge renders only when its state is set.
  const stateBadges = (
    <>
      <CategoryBadge
        category={category}
        options={categoryOptions}
        readOnly={readOnly}
        open={categoryMenuOpen}
        onOpenChange={setCategoryMenuOpen}
        onCommitCategory={onCommitCategory}
      />
      <TaxExemptBadge taxable={taxable} />
      {showOptionalControls && optional && (
        <OptionalLineTag
          optionalSelected={optionalSelected}
          readOnly={readOnly}
          onToggleSelected={onToggleOptionalSelected}
          onToggleOptional={onToggleOptional}
        />
      )}
    </>
  )

  // Description edit mode — replaces the input with an autosize textarea in the
  // same slot (single line at rest, grows while typing) + confirm/cancel. The
  // grid nav hook leaves textareas fully native, so Enter confirms here.
  if (editing) {
    return (
      <div ref={rootRef} className='flex min-w-0 flex-1 items-center gap-1 py-1'>
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
        {stateBadges}
        {description && <TooltipExplanation text={description} />}
      </div>
    )
  }

  const value = nameDraft ?? name

  return (
    <div ref={rootRef} className='flex min-w-0 flex-1 items-center gap-1.5 py-1'>
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
        <div
          className='flex min-w-0 flex-1 items-center gap-1.5'
          onClick={() => {
            if (!focused) setFocused(true)
          }}>
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
              className='flex h-7 min-w-0 flex-1 items-center rounded-sm px-1 text-left text-sm outline-none'>
              <span className={cn('min-w-0 truncate', !name && 'text-muted-foreground/50')}>
                {name || 'Add item'}
              </span>
            </button>
          )}
          {/* State badges sit next to the label; hidden while editing. */}
          {!focused && stateBadges}
        </div>
      </CatalogPicker>

      {/* Pick is the one editing-only action (it rewrites the line's identity,
          so it belongs to the name edit). `onMouseDown` preventDefault keeps
          the input from blur-collapsing before the click handler runs. */}
      {focused && (
        <TreeRowButton
          persistent
          className='ml-auto'
          tooltipText='Pick product'
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setPickerOpen(true)}>
          <PackageSearch />
        </TreeRowButton>
      )}

      {/* Description button — a standing control, but only when the line HAS a
          description (adding one lives in the `⋯` menu) and only at rest (the
          focused input already has the pick button beside it). */}
      {!focused && description && (
        <TreeRowButton
          persistent
          tabIndex={-1}
          tooltipText={description}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setDescriptionDraft(description)}>
          <AlignLeft />
        </TreeRowButton>
      )}

      {/* The `⋯` menu — always the cell's LAST flex child so its slot is
          stable whether the cell is at rest or editing (React keeps it
          mounted across the swap, and it can never overlap the editing UI). */}
      <LineRowMenu
        taxable={taxable}
        optional={optional}
        showOptionalToggle={showOptionalControls}
        hasDescription={!!description}
        onEditDescription={() => setDescriptionDraft(description ?? '')}
        onToggleTaxable={onToggleTaxable}
        onToggleOptional={onToggleOptional}
        onDelete={onDelete}
      />
    </div>
  )
}

/** Store-bound wrapper around {@link LineNameCellView} for real (persisted) line rows. */
function LineNameCell({
  recordId,
  categoryOptions,
  readOnly,
  currencyCode,
  showOptionalControls,
  optional,
  optionalSelected,
  onToggleOptional,
  onToggleOptionalSelected,
  onSelectGroup,
  onDelete,
}: {
  recordId: RecordId
  categoryOptions: CategoryOption[]
  readOnly: boolean
  currencyCode: string
  showOptionalControls: boolean
  optional: boolean
  optionalSelected: boolean
  onToggleOptional: (next: boolean) => void
  onToggleOptionalSelected: (next: boolean) => void
  onSelectGroup: (pick: CatalogGroupPick) => void
  onDelete: () => void
}) {
  const { values } = useSystemValues(recordId, NAME_ATTRS, { autoFetch: true })
  const { saveFieldValue, saveMultipleAsync } = useSaveFieldValue()

  const name = (values.line_item_name as string | undefined) ?? ''
  const description = (values.line_item_description as string | null | undefined) ?? null
  const category = (values.line_item_category as string | null | undefined) ?? null
  const taxable = (values.line_item_taxable as boolean | undefined) !== false

  const handlePick = (pick: CatalogItemPick) => {
    // COPY the catalog defaults onto the line (snapshot — catalog price changes
    // never rewrite documents) + keep the provenance relationship. A catalog/group
    // pick always resets the line to required (money plan 18 §3) — the same
    // "this pick overwrites the line's identity" precedent taxable already follows.
    void saveMultipleAsync(recordId, [
      { fieldId: 'line_item_name', value: pick.name, fieldType: FieldType.TEXT },
      { fieldId: 'line_item_description', value: pick.description, fieldType: FieldType.TEXT },
      { fieldId: 'line_item_category', value: pick.category, fieldType: FieldType.SINGLE_SELECT },
      { fieldId: 'line_item_taxable', value: pick.taxable, fieldType: FieldType.CHECKBOX },
      { fieldId: 'line_item_unit_price', value: pick.unitPrice, fieldType: FieldType.CURRENCY },
      { fieldId: 'line_item_unit', value: pick.defaultUnit, fieldType: FieldType.SINGLE_SELECT },
      { fieldId: 'line_item_optional', value: false, fieldType: FieldType.CHECKBOX },
      { fieldId: 'line_item_optional_selected', value: true, fieldType: FieldType.CHECKBOX },
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
      categoryOptions={categoryOptions}
      taxable={taxable}
      readOnly={readOnly}
      currencyCode={currencyCode}
      showOptionalControls={showOptionalControls}
      optional={optional}
      optionalSelected={optionalSelected}
      onToggleOptional={onToggleOptional}
      onToggleOptionalSelected={onToggleOptionalSelected}
      onToggleTaxable={(next) =>
        saveFieldValue(recordId, 'line_item_taxable', next, FieldType.CHECKBOX)
      }
      onPickCatalogItem={handlePick}
      onSelectGroup={onSelectGroup}
      onFreeText={(text) => saveFieldValue(recordId, 'line_item_name', text, FieldType.TEXT)}
      onCommitDescription={(value) =>
        saveFieldValue(recordId, 'line_item_description', value, FieldType.TEXT)
      }
      onCommitCategory={(value) =>
        saveFieldValue(recordId, 'line_item_category', value, FieldType.SINGLE_SELECT)
      }
      onDelete={onDelete}
    />
  )
}

/**
 * Chromeless inline number editor view — quiet at rest, editable on click (the
 * cell-treatment lock in 01-ui #1). Commits on blur/Enter, no-ops if the value
 * didn't actually change. Handles the rate (`line_item_unit_price`) column only —
 * quantity moved to the smart {@link QuantityCellView} (money plan 13 §5).
 */
function PriceCellView({
  value,
  readOnly,
  currencyCode,
  onCommit,
}: {
  value: number | null
  readOnly: boolean
  currencyCode: string
  onCommit: (next: number | null) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)

  const display = formatCurrency(value ?? null, currencyCode)

  const commit = () => {
    if (draft === null) return
    const trimmed = draft.trim()
    const parsed = trimmed === '' ? null : Number(trimmed)
    setDraft(null)
    if (parsed !== null && Number.isNaN(parsed)) return
    // Typed in dollars but stored as integer cents (CURRENCY convention).
    const next = parsed !== null ? Math.round(parsed * 100) : parsed
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
      onFocus={() => setDraft(value !== null && value !== undefined ? String(value / 100) : '')}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setDraft(null)
      }}
      inputMode='decimal'
      className='h-full w-full rounded-sm border-none bg-transparent px-2 text-right text-sm tabular-nums outline-none'
    />
  )
}

/** Store-bound wrapper around {@link PriceCellView} for real line rows. */
function PriceCell({
  recordId,
  readOnly,
  currencyCode,
}: {
  recordId: RecordId
  readOnly: boolean
  currencyCode: string
}) {
  const { values } = useSystemValues(recordId, PRICE_ATTRS, { autoFetch: true })
  const { saveFieldValue } = useSaveFieldValue()

  const raw = (values.line_item_unit_price as number | null | undefined) ?? null

  return (
    <PriceCellView
      value={raw}
      readOnly={readOnly}
      currencyCode={currencyCode}
      onCommit={(next) =>
        saveFieldValue(recordId, 'line_item_unit_price', next, FieldType.CURRENCY)
      }
    />
  )
}

/** Formats a quantity without trailing zeros, up to 3 decimal places (`2.375`, `5`, `12`). */
function formatQtyNumber(qty: number): string {
  return String(Number(qty.toFixed(3)))
}

/** `12 hr`, `5 sf`, or bare `5` when the line has no unit — money plan 13 §5's compact form. */
function formatQtyDisplay(qty: number, unit: LineItemUnit | null): string {
  const suffix = formatLineItemUnit(unit, 'compact')
  return suffix ? `${formatQtyNumber(qty)} ${suffix}` : formatQtyNumber(qty)
}

/**
 * Smart quantity cell (money plan 13 §5) — rests as compact text (`12 hr`, `5 sf`, bare `5`
 * when unitless). On focus it becomes a raw text input holding the exact compact string;
 * the input is NEVER rewritten while focused (no caret jumps) — only `parseQuantityWithUnit`
 * on blur/Enter/Tab can change what's committed. A recognized parse saves quantity + unit
 * TOGETHER (`onCommit`) so realtime observers never see a half-updated pair; an unrecognized
 * parse restores the last committed display and flashes a brief destructive tint, persisting
 * nothing. A hover/click-revealed dropdown trigger (mouse/touch only — not in the Tab order,
 * the ONLY way to clear a unit) offers "No unit" + every fixed unit; picking one preserves
 * quantity. Unit-only changes never touch `computeDocumentTotals` — that reads qty/rate only.
 */
function QuantityCellView({
  quantity,
  unit,
  readOnly,
  onCommit,
}: {
  quantity: number
  unit: LineItemUnit | null
  readOnly: boolean
  onCommit: (next: { quantity: number; unit: LineItemUnit | null }) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const invalidTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const display = formatQtyDisplay(quantity, unit)

  const flashInvalid = () => {
    setInvalid(true)
    if (invalidTimeoutRef.current) clearTimeout(invalidTimeoutRef.current)
    invalidTimeoutRef.current = setTimeout(() => setInvalid(false), 1200)
  }

  const commit = () => {
    if (draft === null) return
    const raw = draft
    setDraft(null)
    const parsed = parseQuantityWithUnit(raw, { quantity, unit })
    if (!parsed.ok) {
      flashInvalid()
      return
    }
    const nextQuantity = parsed.quantity ?? quantity
    const nextUnit = parsed.unit
    if (nextQuantity === quantity && nextUnit === unit) return
    onCommit({ quantity: nextQuantity, unit: nextUnit })
  }

  const pickUnitOnly = (nextUnit: LineItemUnit | null) => {
    if (nextUnit === unit) return
    onCommit({ quantity, unit: nextUnit })
  }

  if (readOnly) {
    return <div className='w-full px-2 text-right text-sm tabular-nums'>{display}</div>
  }

  return (
    <div className='group/qty relative flex h-full w-full items-center'>
      <input
        value={draft ?? display}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setDraft(display)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setDraft(null)
        }}
        inputMode='text'
        className={cn(
          'h-full w-full rounded-sm border-none bg-transparent py-1 pr-5 pl-2 text-right text-sm tabular-nums outline-none transition-colors',
          invalid && 'bg-destructive/10 ring-1 ring-destructive/60'
        )}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type='button'
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            className='-translate-y-1/2 absolute top-1/2 right-0.5 rounded-sm p-0.5 text-muted-foreground opacity-0 outline-none hover:bg-primary-100 focus:opacity-100 group-hover/qty:opacity-100'>
            <ChevronsUpDown className='size-3' />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='max-h-64 overflow-y-auto'>
          <DropdownMenuItem onSelect={() => pickUnitOnly(null)}>No unit</DropdownMenuItem>
          <DropdownMenuSeparator />
          {LINE_ITEM_UNIT_OPTIONS.map((option) => (
            <DropdownMenuItem key={option.value} onSelect={() => pickUnitOnly(option.value)}>
              {option.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/** Store-bound wrapper around {@link QuantityCellView} for real line rows. */
function QuantityCell({ recordId, readOnly }: { recordId: RecordId; readOnly: boolean }) {
  const { values } = useSystemValues(recordId, QTY_ATTRS, { autoFetch: true })
  const { saveMultipleAsync } = useSaveFieldValue()

  const qty = (values.line_item_qty as number | null | undefined) ?? 1
  const unit = (values.line_item_unit as LineItemUnit | null | undefined) ?? null

  return (
    <QuantityCellView
      quantity={qty}
      unit={unit}
      readOnly={readOnly}
      onCommit={(next) => {
        // Only the fields that actually changed — a combined save so realtime
        // observers never see qty/unit half-updated relative to each other.
        const changed: Array<{ fieldId: string; value: unknown; fieldType: FieldType }> = []
        if (next.quantity !== qty) {
          changed.push({
            fieldId: 'line_item_qty',
            value: next.quantity,
            fieldType: FieldType.NUMBER,
          })
        }
        if (next.unit !== unit) {
          changed.push({
            fieldId: 'line_item_unit',
            value: next.unit,
            fieldType: FieldType.SINGLE_SELECT,
          })
        }
        if (changed.length > 0) void saveMultipleAsync(recordId, changed)
      }}
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

/** Right-aligned shortcut hint in a `⋯` menu item — the platform modifier + literal keys. */
function MenuShortcut({ keys }: { keys: string[] }) {
  return (
    <KbdGroup variant='outline' size='sm' className='ml-auto'>
      <Kbd shortcut='meta' />
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </KbdGroup>
  )
}

/**
 * Row-level `⋯` actions menu — rendered by {@link LineNameCellView} as the
 * name cell's last flex child, so it sits at the column's right edge without
 * ever overlapping the editing buttons. Always visible (it occupies its flex
 * slot either way), styled like the other row action buttons; mouse/touch
 * only (`tabIndex={-1}`, mirroring the qty unit-dropdown precedent). Holds
 * the line-level actions: optional toggle (quotes only), taxable toggle,
 * delete — each item shows its row shortcut (use-line-hotkeys.ts). The drag
 * grip stays drag-only.
 */
function LineRowMenu({
  taxable,
  optional,
  showOptionalToggle,
  hasDescription,
  onEditDescription,
  onToggleTaxable,
  onToggleOptional,
  onDelete,
}: {
  taxable: boolean
  optional: boolean
  showOptionalToggle: boolean
  hasDescription: boolean
  onEditDescription: () => void
  onToggleTaxable: (next: boolean) => void
  onToggleOptional: (next: boolean) => void
  onDelete: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* `onMouseDown` preventDefault: opening the menu must not blur (and
            collapse) a focused name input — mirrors the pick/description
            buttons. Radix opens on pointerdown, which fires before mousedown,
            so the menu still opens. */}
        <TreeRowButton
          persistent
          tabIndex={-1}
          tooltipText='Line actions'
          className='ml-auto'
          onMouseDown={(e) => e.preventDefault()}>
          <Ellipsis />
        </TreeRowButton>
      </DropdownMenuTrigger>
      {/* `onCloseAutoFocus` prevented: the trigger is mouse-only (tabIndex -1),
          and restoring focus to it would steal the description textarea's
          autofocus right after "Add description" is selected. */}
      <DropdownMenuContent align='end' onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuItem onSelect={onEditDescription}>
          <AlignLeft />
          {hasDescription ? 'Edit description' : 'Add description'}
          <MenuShortcut keys={['⇧', 'D']} />
        </DropdownMenuItem>
        {showOptionalToggle && (
          <DropdownMenuItem onSelect={() => onToggleOptional(!optional)}>
            <Tag />
            {optional ? 'Make required' : 'Mark as optional'}
            <MenuShortcut keys={['⇧', 'O']} />
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => onToggleTaxable(!taxable)}>
          {taxable ? <CircleX /> : <CircleCheck />}
          {taxable ? 'Mark tax exempt' : 'Mark taxable'}
          <MenuShortcut keys={['⇧', 'X']} />
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant='destructive' onSelect={onDelete}>
          <Trash2 />
          Delete line
          <MenuShortcut keys={['⌫']} />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
  categoryOptions,
  readOnly,
  currencyCode,
  documentType,
  deleteLine,
  onSelectGroup,
}: {
  record: RecordMeta
  rowIndex: number
  entityDefinitionId: string
  categoryOptions: CategoryOption[]
  readOnly: boolean
  currencyCode: string
  documentType: 'quote' | 'work_order' | 'invoice'
  deleteLine: (lineId: string) => void
  onSelectGroup: (recordId: RecordId, pick: CatalogGroupPick) => void
}) {
  const recordId = toRecordId(entityDefinitionId, record.id)
  const isQuote = documentType === 'quote'
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: record.id,
    disabled: readOnly,
  })

  // Optional/optionalSelected (money plan 18 §3) — read once here so the row's
  // muted/indented treatment and both cells that expose it (name badge/checkbox,
  // actions toggle) stay in agreement. Gated on `isQuote`: work-order/invoice
  // builders never fetch or show any of it.
  const { values: optionalValues } = useSystemValues(recordId, OPTIONAL_ATTRS, {
    autoFetch: isQuote,
    enabled: isQuote,
  })
  const { saveFieldValue } = useSaveFieldValue()
  const optional = isQuote && (optionalValues.line_item_optional as boolean | undefined) === true
  const optionalSelected =
    !isQuote || (optionalValues.line_item_optional_selected as boolean | undefined) !== false

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && 'relative z-10 opacity-80')}>
      <LineGridRow
        rowIndex={rowIndex}
        optional={optional}
        grip={readOnly ? null : <GripSlot attributes={attributes} listeners={listeners} />}
        name={
          <LineNameCell
            recordId={recordId}
            categoryOptions={categoryOptions}
            readOnly={readOnly}
            currencyCode={currencyCode}
            showOptionalControls={isQuote}
            optional={optional}
            optionalSelected={optionalSelected}
            onToggleOptional={(next) =>
              saveFieldValue(recordId, 'line_item_optional', next, FieldType.CHECKBOX)
            }
            onToggleOptionalSelected={(next) =>
              saveFieldValue(recordId, 'line_item_optional_selected', next, FieldType.CHECKBOX)
            }
            onSelectGroup={(pick) => onSelectGroup(recordId, pick)}
            onDelete={() => deleteLine(record.id)}
          />
        }
        qty={<QuantityCell recordId={recordId} readOnly={readOnly} />}
        price={<PriceCell recordId={recordId} readOnly={readOnly} currencyCode={currencyCode} />}
        total={<LineTotalCell recordId={recordId} currencyCode={currencyCode} />}
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
  categoryOptions,
  currencyCode,
  documentType,
  deleteDraft,
  createDraft,
  onSelectGroup,
}: {
  draft: DraftLine
  rowIndex: number
  /** Focus the name input on mount — set for the just-added draft. */
  autoFocus: boolean
  categoryOptions: CategoryOption[]
  currencyCode: string
  documentType: 'quote' | 'work_order' | 'invoice'
  deleteDraft: (draftId: string) => void
  createDraft: (draftId: string, overrides?: Partial<DraftLine>) => Promise<void>
  onSelectGroup: (draftId: string, pick: CatalogGroupPick) => void
}) {
  const isQuote = documentType === 'quote'

  return (
    <LineGridRow
      rowIndex={rowIndex}
      optional={isQuote && draft.optional}
      grip={null}
      name={
        <LineNameCellView
          name={draft.name}
          description={draft.description}
          category={draft.category}
          categoryOptions={categoryOptions}
          taxable={draft.taxable}
          readOnly={false}
          currencyCode={currencyCode}
          autoFocus={autoFocus}
          showOptionalControls={isQuote}
          optional={draft.optional}
          optionalSelected={draft.optionalSelected}
          onToggleOptional={(next) => void createDraft(draft.draftId, { optional: next })}
          onToggleOptionalSelected={(next) =>
            void createDraft(draft.draftId, { optionalSelected: next })
          }
          onToggleTaxable={(next) => void createDraft(draft.draftId, { taxable: next })}
          onPickCatalogItem={(pick) =>
            void createDraft(draft.draftId, {
              name: pick.name,
              description: pick.description,
              category: pick.category,
              taxable: pick.taxable,
              unitPriceCents: pick.unitPrice,
              unit: pick.defaultUnit,
              catalogItemRecordId: pick.recordId,
              optional: false,
              optionalSelected: true,
            })
          }
          onSelectGroup={(pick) => onSelectGroup(draft.draftId, pick)}
          onFreeText={(text) => void createDraft(draft.draftId, { name: text })}
          onCommitDescription={(value) => void createDraft(draft.draftId, { description: value })}
          onCommitCategory={(value) => void createDraft(draft.draftId, { category: value })}
          onDelete={() => deleteDraft(draft.draftId)}
        />
      }
      qty={
        <QuantityCellView
          quantity={draft.qty}
          unit={draft.unit}
          readOnly={false}
          onCommit={(next) =>
            void createDraft(draft.draftId, { qty: next.quantity, unit: next.unit })
          }
        />
      }
      price={
        <PriceCellView
          value={draft.unitPriceCents}
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
    />
  )
}
