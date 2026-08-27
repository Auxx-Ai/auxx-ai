// apps/web/src/components/money/ui/line-builder/line-rows.tsx

'use client'

// Row + cell components for the line-items builder (line-builder.tsx). Split
// out once the builder file crossed the ~800-line component threshold:
// this file owns presentational cell views and the two row shells (`LineRow`
// for real records, `DraftLineRow` for phantom
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
// (category / tax-exempt / optional, clickable to change), description and
// photo buttons when the line has one/some, and the `⋯` row menu (description,
// category, images, optional, taxable, delete). Qty/rate are chromeless inline
// editors; total is computed. The drag grip floats in the left gutter,
// hover-revealed.

import { FieldType } from '@auxx/database/enums'
import {
  computeLineTotal,
  formatLineItemUnit,
  LINE_ITEM_UNIT_OPTIONS,
  type LineItemUnit,
  parseQuantityWithUnit,
} from '@auxx/lib/money/client'
import type { ResourceField } from '@auxx/lib/resources/client'
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
  Camera,
  Check,
  ChevronsUpDown,
  CircleCheck,
  CircleX,
  Ellipsis,
  GripVertical,
  Landmark,
  Link2,
  PackageSearch,
  Plus,
  Tag,
  Tags,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import type { CatalogGroup } from '~/components/money/hooks/use-catalog-groups'
import type { CatalogItem } from '~/components/money/hooks/use-catalog-items'
import { type RecordId, type RecordMeta, toRecordId } from '~/components/resources'
import { useSystemField } from '~/components/resources/hooks/use-field'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { catalogItemToLinePatch } from './catalog-group-resolver'
import { CatalogPicker } from './catalog-picker'
import { LinePhotoPopover } from './line-photo-popover'
import {
  type AmountMode,
  crossFillAmount,
  DEFAULT_LINE_VALUES,
  type DocumentType,
  hasAmountMismatch,
  type LinePatch,
  type LineValues,
  lineAttributesFor,
  lineSchemaFor,
  lineValuesFromSystemValues,
} from './line-values'
import { formatCurrency, titleCase } from './shared'
import { LINE_ROW_ACTION_EVENT, type LineRowAction } from './use-line-hotkeys'

/**
 * Shared `grid-template-columns` for the header row and every line row (the
 * mapping-columns.ts idiom) — one template is what keeps the qty / rate /
 * total columns aligned. Columns: description (fills) │ qty (sized for a
 * smart `2.375 cy` quantity+unit cell, money plan 13 §5) │ rate │ total.
 */
export const LINE_COLS = 'minmax(10rem, 1fr) 5.5rem 5.5rem 6.5rem'

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
 * Renders the editor for a line's match key, supplied by the CONSUMER.
 *
 * 🛑 A render prop rather than an import, and that is deliberate: the only match
 * key that exists is a bill line's `purchaseOrderLine`, and its picker
 * (`purchasing/purchase-order/purchase-order-line-picker.tsx`) already imports
 * `LineBuilder`. Reaching for it from here would close that loop — `money` would
 * depend on `purchasing` while `purchasing` depends on `money`.
 *
 * `scopeRecordId` is resolved by the builder from `LineSchema.matchScopeAttr`, so
 * the consumer never has to re-fetch the parent to scope its own picker.
 */
export type MatchKeyEditorRenderer = (props: {
  value: RecordId | null
  onChange: (next: RecordId | null) => void
  scopeRecordId: RecordId | null
  currencyCode: string
}) => ReactNode

/**
 * A phantom line row that exists only in local state until its first real
 * commit — no `EntityInstance` behind it yet. `unitPriceCents` mirrors the
 * CURRENCY storage convention (integer cents), matching `line_item_unit_price`.
 * `unit`/`optional`/`optionalSelected` mirror `line_item_unit`/`line_item_optional`/
 * `line_item_optional_selected` (money plans 13 §5, 18 §3).
 */
export interface DraftLine extends LineValues {
  draftId: string
  creating: boolean
  /**
   * Real row this draft renders directly under — set on catalog-group bundle
   * drafts staged from a middle row's pick, so the bundle stays together
   * instead of pinning to the list tail. Absent → tail (the default).
   */
  anchorRecordId?: string
}

export function freshDraft(draftId: string): DraftLine {
  return {
    ...DEFAULT_LINE_VALUES,
    draftId,
    creating: false,
  }
}

/**
 * The document-relationship field a new line_item is stamped with, by document
 * type. A lookup rather than a ternary chain: a missing arm here stamps the line
 * onto the WRONG document instead of failing, and the fourth type
 * (`order`, plans/products/08-order-build.md §5.6) is exactly the kind of
 * addition a chain absorbs silently.
 */
export function relKeyForDocumentType(documentType: DocumentType): string {
  return lineSchemaFor(documentType).relKey
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
  totalNavigable = false,
  optional = false,
}: {
  rowIndex: number
  grip: ReactNode
  name: ReactNode
  qty: ReactNode
  price: ReactNode
  total: ReactNode
  /**
   * Whether the amount cell joins the spreadsheet nav order as col 3 — true only
   * where it is an input (`amountMode: 'stored'`). Tagging it unconditionally
   * would give the other five documents a fourth cell with nothing focusable in
   * it, and `focusCell` would land on a dead column. `colCount` in
   * `line-builder.tsx` moves with this.
   */
  totalNavigable?: boolean
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
        <div
          data-line-row={totalNavigable ? rowIndex : undefined}
          data-line-col={totalNavigable ? 3 : undefined}
          className='flex items-center'>
          {total}
        </div>
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
  attributes?: ReturnType<typeof useSortable>['attributes']
  listeners?: ReturnType<typeof useSortable>['listeners']
}) {
  return (
    <span
      {...attributes}
      {...listeners}
      // z-10: the row's grid div is a later positioned sibling — without a
      // z-index it hit-tests above the grip's inner half, eating drag starts.
      className='-left-2.5 -translate-y-1/2 absolute top-1/2 z-10 flex h-5 w-5 cursor-grab items-center justify-center rounded-md border bg-background text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover/tree-row:opacity-100'>
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
 * - state badges at rest — only for states actually set: tax-exempt `T`,
 *   optional `O` + pre-check checkbox (marking optional lives in the `⋯` menu)
 * - standing right-edge controls — a description button (only when a
 *   description exists; ADDING one lives in the `⋯` menu), the category badge
 *   (click to change; pinned here rather than drifting with the name text,
 *   since the `⋯` menu beside it is the one control that's (almost) always
 *   drawn), and the `⋯` row menu ({@link LineRowMenu}); all in-flow, so they
 *   never overlap the editing UI
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
  catalogItems,
  catalogGroups,
  catalogItemMap,
  catalogLoading,
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
  photoChip,
  hasPhotos = false,
  onOpenPhotos,
}: {
  name: string
  description: string | null
  category: string | null
  categoryOptions: CategoryOption[]
  taxable: boolean
  readOnly: boolean
  currencyCode: string
  catalogItems: CatalogItem[]
  catalogGroups: CatalogGroup[]
  catalogItemMap: Map<string, CatalogItem>
  catalogLoading: boolean
  /** Focus the name input on mount — set for a freshly added draft row. */
  autoFocus?: boolean
  /** Quotes only (money plan 18 §3) — work-order/invoice builders pass `false`. */
  showOptionalControls: boolean
  optional: boolean
  optionalSelected: boolean
  onToggleOptional: (next: boolean) => void
  onToggleOptionalSelected: (next: boolean) => void
  onToggleTaxable: (next: boolean) => void
  onPickCatalogItem: (item: CatalogItem) => void
  onSelectGroup: (group: CatalogGroup) => void
  onFreeText: (text: string) => void
  onCommitDescription: (value: string | null) => void
  onCommitCategory: (value: string | null) => void
  /** Delete this line (real record or draft). */
  onDelete: () => void
  /**
   * Scouting-photo popover (line-photo-popover.tsx, plans 37b §4 / 40) —
   * `undefined` on a phantom draft row (no `EntityInstance` to attach photos
   * to yet). Its trigger only mounts when the line has photos or the popover
   * is held open, so the slot renders nothing at rest on a photo-less line.
   */
  photoChip?: ReactNode
  /** Whether the line has photos — drives the `⋯` menu's Add/Edit images label. */
  hasPhotos?: boolean
  /**
   * Open the photo popover (plan 40) — `undefined` hides the `⋯` menu item and
   * disables the ⇧P shortcut (draft rows, orgs missing the registry field).
   */
  onOpenPhotos?: () => void
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
      case 'photos':
        onOpenPhotos?.()
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

  // Category sits on its own — pinned next to the `⋯` menu (the only
  // right-edge control that's (almost) always drawn) instead of drifting with
  // the name text like the other state badges.
  const categoryBadge = (
    <CategoryBadge
      category={category}
      options={categoryOptions}
      readOnly={readOnly}
      open={categoryMenuOpen}
      onOpenChange={setCategoryMenuOpen}
      onCommitCategory={onCommitCategory}
    />
  )

  // The at-rest state-badge cluster — shared verbatim by the read-only and
  // editable renders below; each badge renders only when its state is set.
  const stateBadges = (
    <>
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
        {photoChip}
        {categoryBadge}
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
        items={catalogItems}
        groups={catalogGroups}
        itemMap={catalogItemMap}
        isLoading={catalogLoading}
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

      {/* Scouting-photo popover (plans 37b §4 / 40) — undefined on draft rows;
          renders nothing at rest without photos (adding lives in the `⋯` menu). */}
      {!focused && photoChip}

      {/* Category badge — pinned beside the `⋯` menu (see `categoryBadge`
          above) rather than drifting with the name text. */}
      {!focused && categoryBadge}

      {/* The `⋯` menu — always the cell's LAST flex child so its slot is
          stable whether the cell is at rest or editing (React keeps it
          mounted across the swap, and it can never overlap the editing UI). */}
      <LineRowMenu
        taxable={taxable}
        optional={optional}
        showOptionalToggle={showOptionalControls}
        hasDescription={!!description}
        hasCategory={!!category}
        hasPhotos={hasPhotos}
        onEditDescription={() => setDescriptionDraft(description ?? '')}
        // Deferred one frame: the category menu / photo popover is a second
        // Radix layer — opening it while the `⋯` menu is still tearing down
        // would let the closing layer's dismiss handling swallow it.
        onSetCategory={() => requestAnimationFrame(openCategoryMenu)}
        onOpenPhotos={onOpenPhotos ? () => requestAnimationFrame(() => onOpenPhotos()) : undefined}
        onToggleTaxable={onToggleTaxable}
        onToggleOptional={onToggleOptional}
        onDelete={onDelete}
      />
    </div>
  )
}

/**
 * Chromeless inline number editor view — quiet at rest, editable on click (the
 * cell-treatment lock in 01-ui #1). Commits on blur/Enter, no-ops if the value
 * didn't actually change. Handles the rate (`line_item_unit_price`) column only —
 * quantity moved to the smart {@link QuantityCellView} (money plan 13 §5).
 */
function PriceCellView(props: {
  value: number | null
  readOnly: boolean
  currencyCode: string
  onCommit: (next: number | null) => void
}) {
  return <CurrencyCellInput {...props} />
}

/**
 * The shared chromeless currency editor behind {@link PriceCellView} and the
 * `stored` branch of {@link LineTotalCellView} — typed in dollars, stored as
 * integer cents. Extracted rather than copied when the amount column became
 * editable: two inputs over the same storage convention that round differently
 * is how a rate and an amount stop agreeing.
 */
function CurrencyCellInput({
  value,
  readOnly,
  currencyCode,
  onCommit,
  ariaLabel,
}: {
  value: number | null
  readOnly: boolean
  currencyCode: string
  onCommit: (next: number | null) => void
  ariaLabel?: string
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
      aria-label={ariaLabel}
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
  unitEditable,
  readOnly,
  onCommit,
}: {
  quantity: number
  unit: LineItemUnit | null
  /**
   * Whether the unit is this row's to change — `schema.capabilities.unit`.
   *
   * 🛑 On a purchasing line it is FALSE, and the unit shown comes from the PART
   * (`part_unit`), not the line: `purchase_order_line` has no unit attribute, so
   * a pick here would go through `linePatchToFieldValues`, which drops the key,
   * and appear to work while changing nothing. It is on the part by design — a
   * line ordered in `box` and received in `ea` would make the received-vs-ordered
   * roll-up compare two different units. A PO does not get to choose the unit its
   * part is stocked in, so the cell renders it without a dropdown.
   */
  unitEditable: boolean
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
    // Where the unit is not this row's to change, a typed `5 ea` still commits the
    // 5 — the parsed unit is discarded rather than flashing the cell invalid.
    const nextUnit = unitEditable ? parsed.unit : unit
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
      {unitEditable && (
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
      )}
    </div>
  )
}

/**
 * The amount cell — read-only on five documents, an input on the sixth
 * (plans/purchasing/04-vendor-bill-lines-and-the-amount-cell.md §3).
 *
 * `derived`: `computeLineTotal` over the row's qty and rate. The stored
 * `…_line_total` behind it is `creatable: false` with the server totals hook as
 * its only writer, so there is nothing here to type into.
 *
 * `stored`: the vendor bill. The amount is TRANSCRIBED, so it is an input, and
 * `crossFillAmount` fills whichever of rate/amount was left blank.
 *
 * 🛑 When `qty × rate` disagrees with the typed amount the cell MARKS it and
 * changes nothing. That disagreement is the vendor's own arithmetic — the exact
 * discrepancy the three-way match exists to surface — so a cell that quietly
 * reconciled the two would be deleting the finding.
 */
function LineTotalCellView({
  amountMode,
  qty,
  unitPrice,
  lineTotal,
  mismatch,
  readOnly,
  currencyCode,
  onCommit,
}: {
  amountMode: AmountMode
  qty: number
  unitPrice: number | null
  /** The transcribed amount — `stored` mode only; ignored when `derived`. */
  lineTotal: number | null
  mismatch: boolean
  readOnly: boolean
  currencyCode: string
  onCommit: (next: number | null) => void
}) {
  if (amountMode === 'derived') {
    return (
      <div className='w-full px-2 text-right text-muted-foreground text-sm tabular-nums'>
        {formatCurrency(computeLineTotal(qty, unitPrice), currencyCode)}
      </div>
    )
  }

  return (
    <div className='flex h-full w-full items-center justify-end gap-1'>
      {mismatch && (
        <SimpleTooltip
          content={`Quantity x rate is ${formatCurrency(
            computeLineTotal(qty, unitPrice),
            currencyCode
          )}. Billed as shown — left exactly as the vendor wrote it.`}>
          <TriangleAlert className='size-3.5 shrink-0 text-warning-600' />
        </SimpleTooltip>
      )}
      <CurrencyCellInput
        value={lineTotal}
        readOnly={readOnly}
        currencyCode={currencyCode}
        onCommit={onCommit}
        ariaLabel='Amount'
      />
    </div>
  )
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
 * the line-level actions: description, category, images (real rows only —
 * a draft has no record to attach photos to), optional toggle (quotes only),
 * taxable toggle, match key and GL account (buy-side lines that carry them),
 * delete — each item shows its row shortcut (use-line-hotkeys.ts). The drag grip
 * stays drag-only.
 *
 * ⚠️ This menu is where a line's OPTIONAL vocabulary lives, by convention: a
 * concept the row does not always carry is revealed here, and only becomes a
 * standing control in the cell once it is set. A bill line's match key and GL
 * account are the two newest members of that set — neither earns a grid column,
 * and adding one would have widened `LINE_COLS` for every document
 * (plans/purchasing/04-vendor-bill-lines-and-the-amount-cell.md §2).
 */
function LineRowMenu({
  taxable,
  optional,
  showOptionalToggle,
  showCategory = true,
  showTaxable = true,
  showMatchKey = false,
  showGlAccount = false,
  hasDescription,
  hasCategory,
  hasPhotos,
  hasMatchKey = false,
  hasGlAccount = false,
  onEditDescription,
  onSetCategory,
  onOpenPhotos,
  onToggleTaxable,
  onToggleOptional,
  onSetMatchKey,
  onSetGlAccount,
  onDelete,
}: {
  taxable: boolean
  optional: boolean
  showOptionalToggle: boolean
  /**
   * `schema.capabilities.category` / `.taxable`. A purchasing line has neither
   * field, so the item would write through `linePatchToFieldValues`, which drops
   * the key — the click would appear to work and change nothing.
   */
  showCategory?: boolean
  showTaxable?: boolean
  /** `schema.attrs.purchaseOrderLineRecordId !== null` — a bill line's match key. */
  showMatchKey?: boolean
  /** `schema.attrs.glAccount !== null`. */
  showGlAccount?: boolean
  hasDescription: boolean
  hasCategory: boolean
  hasPhotos: boolean
  hasMatchKey?: boolean
  hasGlAccount?: boolean
  onEditDescription: () => void
  onSetCategory: () => void
  /** `undefined` hides the images item (draft rows, missing registry field). */
  onOpenPhotos?: () => void
  onToggleTaxable: (next: boolean) => void
  onToggleOptional: (next: boolean) => void
  onSetMatchKey?: () => void
  onSetGlAccount?: () => void
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
        {showCategory && (
          <DropdownMenuItem onSelect={onSetCategory}>
            <Tags />
            {hasCategory ? 'Change category' : 'Add category'}
            <MenuShortcut keys={['⇧', 'L']} />
          </DropdownMenuItem>
        )}
        {onOpenPhotos && (
          <DropdownMenuItem onSelect={onOpenPhotos}>
            <Camera />
            {hasPhotos ? 'Edit images' : 'Add images'}
            <MenuShortcut keys={['⇧', 'P']} />
          </DropdownMenuItem>
        )}
        {showOptionalToggle && (
          <DropdownMenuItem onSelect={() => onToggleOptional(!optional)}>
            <Tag />
            {optional ? 'Make required' : 'Mark as optional'}
            <MenuShortcut keys={['⇧', 'O']} />
          </DropdownMenuItem>
        )}
        {showTaxable && (
          <DropdownMenuItem onSelect={() => onToggleTaxable(!taxable)}>
            {taxable ? <CircleX /> : <CircleCheck />}
            {taxable ? 'Mark tax exempt' : 'Mark taxable'}
            <MenuShortcut keys={['⇧', 'X']} />
          </DropdownMenuItem>
        )}
        {showMatchKey && onSetMatchKey && (
          <DropdownMenuItem onSelect={onSetMatchKey}>
            <Link2 />
            {hasMatchKey ? 'Change purchase order line' : 'Link purchase order line'}
            <MenuShortcut keys={['⇧', 'K']} />
          </DropdownMenuItem>
        )}
        {showGlAccount && onSetGlAccount && (
          <DropdownMenuItem onSelect={onSetGlAccount}>
            <Landmark />
            {hasGlAccount ? 'Change GL account' : 'Set GL account'}
            <MenuShortcut keys={['⇧', 'G']} />
          </DropdownMenuItem>
        )}
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

// ─────────────────────────────────────────────────────────────────────────────
// Buy-side leading cell
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The leading cell for a purchasing line: a `part` relation picker where the
 * sell-side cell puts its free-text name + catalog picker.
 *
 * 🛑 This is not a styling variant of {@link LineNameCellView}. A purchasing line's
 * identity IS its part — `purchase_order_line.part` is `required: true` and leg 2
 * of the natural key `(purchaseOrder, part)`, which is what stops a re-sent order
 * doubling its lines. So the part pick is what MATERIALIZES a draft row, exactly
 * as the catalog pick does on the sell side; a description typed first accumulates
 * on the draft and is written with the part in one create. Committing on the
 * description instead would send a create the server must reject.
 *
 * ⚠️ Its ANATOMY, though, is deliberately the sell-side one, and the first cut got
 * that wrong: it stacked a permanently-visible description input under the picker,
 * which is precisely what {@link LineNameCellView} documents itself as avoiding —
 * *"the line never grows a permanent second row"*. Purchasing rows rendered at
 * double height beside every other document's, and the cell had no `⋯` menu at
 * all, so a purchasing line could not be deleted from the grid and none of the
 * row shortcuts reached it. Now: description is a standing button only once set,
 * adding one lives in the `⋯` menu, and editing swaps the cell in place.
 *
 * The field definition is sourced live rather than stubbed so the picker gets a
 * real `RelationshipConfig` — and with it "create new part" — the same way the
 * PO line dialog did it.
 *
 * A VENDOR BILL line reaches the same cell with two extra concepts a purchase
 * order line does not have — `purchaseOrderLine` (the three-way match key) and
 * `glAccount`. Both follow the `⋯` convention rather than taking a column:
 * revealed from the menu, edited in the cell's single swap slot, and rendered as
 * a standing chip only once set
 * (plans/purchasing/04-vendor-bill-lines-and-the-amount-cell.md §2).
 */
function LinePartCellView({
  partAttribute,
  partRecordId,
  description,
  matchKeyAttribute,
  matchKeyRecordId,
  matchScopeRecordId,
  renderMatchKeyEditor,
  currencyCode,
  glAccountAttribute,
  glAccount,
  readOnly,
  onPickPart,
  onCommitDescription,
  onPickMatchKey,
  onCommitGlAccount,
  onDelete,
}: {
  /** `purchase_order_line_part` / `vendor_bill_line_part`, from the schema. */
  partAttribute: string
  partRecordId: RecordId | null
  description: string | null
  /** `schema.attrs.purchaseOrderLineRecordId` — `null` on a line with no match key. */
  matchKeyAttribute: string | null
  matchKeyRecordId: RecordId | null
  /** Resolved by the builder from `schema.matchScopeAttr`; scopes the picker. */
  matchScopeRecordId: RecordId | null
  renderMatchKeyEditor?: MatchKeyEditorRenderer
  currencyCode: string
  /** `schema.attrs.glAccount` — `null` on a line with no GL account. */
  glAccountAttribute: string | null
  glAccount: string | null
  readOnly: boolean
  onPickPart: (recordId: RecordId | null) => void
  onCommitDescription: (value: string | null) => void
  onPickMatchKey: (recordId: RecordId | null) => void
  onCommitGlAccount: (value: string | null) => void
  /** Delete this line (real record or draft). */
  onDelete: () => void
}) {
  const partField = useSystemField(partAttribute)
  /**
   * The cell's single edit slot. One state rather than one per field, because the
   * three editors all REPLACE the cell: two of them open at once would render two
   * autofocused controls into the same slot.
   *
   * `null` = at rest. A `value` carries the in-progress text (incl. `''`); the
   * match key has none — its picker writes through on select.
   */
  const [edit, setEdit] = useState<
    { field: 'description' | 'glAccount'; value: string } | { field: 'matchKey' } | null
  >(null)

  // The match key is only editable where the consumer supplied an editor for it;
  // see MatchKeyEditorRenderer for why this is a render prop and not an import.
  const showMatchKey = !!matchKeyAttribute && !!renderMatchKeyEditor && !readOnly
  const showGlAccount = !!glAccountAttribute && !readOnly

  const confirmText = () => {
    if (!edit || edit.field === 'matchKey') return
    const trimmed = edit.value.trim() || null
    setEdit(null)
    if (edit.field === 'description') onCommitDescription(trimmed)
    else onCommitGlAccount(trimmed)
  }

  // Row-action shortcuts (use-line-hotkeys.ts) arrive as CustomEvents on the
  // enclosing name cell — same contract as LineNameCellView. Only the actions a
  // purchasing line actually has are handled; the rest are no-ops rather than
  // writes to fields the entity does not carry.
  const rootRef = useRef<HTMLDivElement>(null)
  const actionRef = useRef<(action: LineRowAction) => void>(() => {})
  actionRef.current = (action) => {
    if (action === 'description') {
      // Already editing the description — don't reset the in-progress text.
      if (edit?.field !== 'description') setEdit({ field: 'description', value: description ?? '' })
      return
    }
    if (action === 'glAccount') {
      if (showGlAccount && edit?.field !== 'glAccount') {
        setEdit({ field: 'glAccount', value: glAccount ?? '' })
      }
      return
    }
    if (action === 'matchKey') {
      if (showMatchKey) setEdit({ field: 'matchKey' })
      return
    }
    if (action === 'delete') onDelete()
  }
  useEffect(() => {
    const cell = rootRef.current?.closest('[data-line-col]')
    if (!cell) return
    const onAction = (e: Event) => actionRef.current((e as CustomEvent<LineRowAction>).detail)
    cell.addEventListener(LINE_ROW_ACTION_EVENT, onAction)
    return () => cell.removeEventListener(LINE_ROW_ACTION_EVENT, onAction)
  }, [])

  // Description edit mode — replaces the cell with an autosize textarea in the
  // same slot, exactly as the sell-side cell does.
  if (edit?.field === 'description') {
    return (
      <div ref={rootRef} className='flex min-w-0 flex-1 items-center gap-1 py-1'>
        <AutosizeTextarea
          value={edit.value}
          onChange={(e) => setEdit({ field: 'description', value: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              confirmText()
            }
            if (e.key === 'Escape') setEdit(null)
          }}
          autoFocus
          minHeight={28}
          maxHeight={160}
          placeholder='What the supplier calls it'
          className='min-w-0 flex-1 resize-none rounded-sm border-primary-200/60 bg-transparent px-2 py-1 text-muted-foreground text-xs'
        />
        <TreeRowButton persistent tooltipText='Save description' onClick={confirmText}>
          <Check />
        </TreeRowButton>
        <TreeRowButton
          persistent
          variant='destructive'
          tooltipText='Cancel'
          onClick={() => setEdit(null)}>
          <X />
        </TreeRowButton>
      </div>
    )
  }

  // GL account edit mode — an account CODE ('2160', '5090'), free text by
  // registry (`vendor_bill_line.glAccount` is TEXT with a `2160` placeholder),
  // so a plain input rather than the options menu the category badge uses.
  if (edit?.field === 'glAccount') {
    return (
      <div ref={rootRef} className='flex min-w-0 flex-1 items-center gap-1 py-1'>
        <input
          aria-label='GL account'
          value={edit.value}
          onChange={(e) => setEdit({ field: 'glAccount', value: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              confirmText()
            }
            if (e.key === 'Escape') setEdit(null)
          }}
          autoFocus
          placeholder='2160'
          className='h-7 min-w-0 flex-1 rounded-sm border border-primary-200/60 bg-transparent px-2 text-sm tabular-nums outline-none'
        />
        <TreeRowButton persistent tooltipText='Save GL account' onClick={confirmText}>
          <Check />
        </TreeRowButton>
        <TreeRowButton
          persistent
          variant='destructive'
          tooltipText='Cancel'
          onClick={() => setEdit(null)}>
          <X />
        </TreeRowButton>
      </div>
    )
  }

  // Match-key edit mode — the consumer's picker fills the cell, and writes
  // through on select rather than on a Save button, so there is nothing to
  // cancel: the ✓ only closes the slot.
  if (edit?.field === 'matchKey' && renderMatchKeyEditor) {
    return (
      <div ref={rootRef} className='flex min-w-0 flex-1 items-center gap-1 py-1'>
        <div className='min-w-0 flex-1'>
          {renderMatchKeyEditor({
            value: matchKeyRecordId,
            onChange: onPickMatchKey,
            scopeRecordId: matchScopeRecordId,
            currencyCode,
          })}
        </div>
        <TreeRowButton persistent tooltipText='Done' onClick={() => setEdit(null)}>
          <Check />
        </TreeRowButton>
      </div>
    )
  }

  if (readOnly) {
    return (
      <div className='flex min-w-0 flex-1 items-center gap-1.5 py-1'>
        <span className='min-w-0 truncate px-1 text-sm'>
          {partField?.label ?? 'Part'}
          {partRecordId ? '' : ' —'}
        </span>
        {description && <TooltipExplanation text={description} />}
        {matchKeyRecordId && (
          <SimpleTooltip content='Matched to a purchase order line'>
            <Link2 className='size-3.5 shrink-0 text-muted-foreground' />
          </SimpleTooltip>
        )}
        {glAccount && <GlAccountChip code={glAccount} />}
      </div>
    )
  }

  return (
    <div ref={rootRef} className='flex min-w-0 flex-1 items-center gap-1.5 py-1'>
      <FieldInputAdapter
        fieldType={partField?.fieldType ?? FieldType.RELATIONSHIP}
        fieldOptions={partField?.options}
        // `PickerTrigger` takes no data attributes, so the grid's nav hook matches
        // this trigger on `[role="combobox"]` instead — see use-line-nav.ts.
        triggerProps={{
          className: 'h-7 min-w-0 flex-1 border-none bg-transparent px-1 shadow-none',
        }}
        value={partRecordId ? [partRecordId] : []}
        onChange={(next) => {
          const ids = next as RecordId[]
          onPickPart(ids[0] ?? null)
        }}
        placeholder='Select part...'
      />

      {/* Description button — a standing control, but only when the line HAS a
          description; ADDING one lives in the `⋯` menu. Mirrors the sell side. */}
      {description && (
        <TreeRowButton
          persistent
          tabIndex={-1}
          tooltipText={description}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setEdit({ field: 'description', value: description })}>
          <AlignLeft />
        </TreeRowButton>
      )}

      {/* Match-key chip — the same standing-control-once-set rule as the
          description button. Its tooltip does NOT name the linked line, and that
          is not an omission: `vendor_bill_line.part` is stamped FROM the PO line,
          so the part already rendered two controls to the left is the very label
          the picker would show. Resolving it again would be one extra fetch per
          row to print what the row is already printing. */}
      {showMatchKey && matchKeyRecordId && (
        <TreeRowButton
          persistent
          tabIndex={-1}
          tooltipText='Matched to a purchase order line — click to change'
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setEdit({ field: 'matchKey' })}>
          <Link2 />
        </TreeRowButton>
      )}

      {showGlAccount && glAccount && (
        <GlAccountChip
          code={glAccount}
          onClick={() => setEdit({ field: 'glAccount', value: glAccount })}
        />
      )}

      {/* Always the cell's LAST flex child, so its slot is stable across the
          rest ↔ editor swaps. Category / taxable / images / optional are all off:
          a purchasing line carries none of those fields. */}
      <LineRowMenu
        taxable={false}
        optional={false}
        showOptionalToggle={false}
        showCategory={false}
        showTaxable={false}
        showMatchKey={showMatchKey}
        showGlAccount={showGlAccount}
        hasDescription={!!description}
        hasCategory={false}
        hasPhotos={false}
        hasMatchKey={!!matchKeyRecordId}
        hasGlAccount={!!glAccount}
        onEditDescription={() => setEdit({ field: 'description', value: description ?? '' })}
        onSetCategory={() => {}}
        onToggleTaxable={() => {}}
        onToggleOptional={() => {}}
        onSetMatchKey={showMatchKey ? () => setEdit({ field: 'matchKey' }) : undefined}
        onSetGlAccount={
          showGlAccount ? () => setEdit({ field: 'glAccount', value: glAccount ?? '' }) : undefined
        }
        onDelete={onDelete}
      />
    </div>
  )
}

/** The account code as a standing chip — set-only, like the category badge. */
function GlAccountChip({ code, onClick }: { code: string; onClick?: () => void }) {
  const content = (
    <span className='shrink-0 rounded-sm bg-primary-100 px-1.5 py-0.5 text-[10px] text-muted-foreground leading-none tabular-nums dark:bg-primary-100/60'>
      {code}
    </span>
  )
  if (!onClick) return <SimpleTooltip content='GL account'>{content}</SimpleTooltip>
  return (
    <SimpleTooltip content='GL account — click to change'>
      <button
        type='button'
        tabIndex={-1}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        className='shrink-0 rounded-sm hover:brightness-95'>
        {content}
      </button>
    </SimpleTooltip>
  )
}

/**
 * The stock unit of measure to show beside a purchasing line's quantity, read
 * from the line's PART rather than the line (`part_unit` — see `PART_FIELDS.unit`).
 *
 * Falls back to `each` when the part carries no unit. That is not a guess: every
 * quantity in the inventory chain — `part_quantity_on_hand`, `stock_movement_quantity`,
 * BOM quantities, ordered/received — is already a bare count of discrete units, so
 * `each` is the semantics those numbers ALREADY have, simply made visible. The
 * field ships `defaultValue: 'each'` and there is no backfill, so existing parts
 * read through this fallback until someone sets one.
 *
 * `null` (no part picked yet) skips the fetch and still yields `each`, which is
 * what keeps a draft row and the persisted row it becomes reading identically —
 * the mismatch that `1 ea` vs `1` used to be.
 */
function usePartUnit(partRecordId: RecordId | null): LineItemUnit {
  const { values } = useSystemValues(partRecordId ?? ('' as RecordId), PART_UNIT_ATTRS, {
    autoFetch: !!partRecordId,
    enabled: !!partRecordId,
  })
  // SINGLE_SELECT reads back as a single-element array in some paths and a scalar
  // in others (`useSystemValues` collapses it) — tolerate both.
  const raw = values.part_unit
  const value = Array.isArray(raw) ? raw[0] : raw
  return (typeof value === 'string' ? (value as LineItemUnit) : null) ?? 'each'
}

const PART_UNIT_ATTRS = ['part_unit'] as const

/** One sortable line row — a grid row whose leading slot is the drag grip. */
export function LineRow({
  record,
  rowIndex,
  entityDefinitionId,
  categoryOptions,
  photosField,
  readOnly,
  currencyCode,
  documentType,
  catalogItems,
  catalogGroups,
  catalogItemMap,
  catalogLoading,
  matchScopeRecordId,
  renderMatchKeyEditor,
  onUpdateLine,
  deleteLine,
  onSelectGroup,
}: {
  record: RecordMeta
  rowIndex: number
  entityDefinitionId: string
  categoryOptions: CategoryOption[]
  /** `line_item.photos` field def (plan 37b §4) — `null` skips the photo chip
   * entirely (pre-migration org). */
  photosField: ResourceField | null
  readOnly: boolean
  currencyCode: string
  documentType: DocumentType
  catalogItems: CatalogItem[]
  catalogGroups: CatalogGroup[]
  catalogItemMap: Map<string, CatalogItem>
  catalogLoading: boolean
  /** Resolved from `schema.matchScopeAttr` by the builder; scopes the match picker. */
  matchScopeRecordId: RecordId | null
  renderMatchKeyEditor?: MatchKeyEditorRenderer
  onUpdateLine: (recordId: RecordId, patch: LinePatch) => void
  deleteLine: (lineId: string) => void
  onSelectGroup: (recordId: RecordId, group: CatalogGroup) => void
}) {
  const recordId = toRecordId(entityDefinitionId, record.id)
  const schema = lineSchemaFor(documentType)
  const showOptional = schema.capabilities.optional
  const { values } = useSystemValues(recordId, lineAttributesFor(schema), { autoFetch: false })
  const line = lineValuesFromSystemValues(values, schema)
  const partUnit = usePartUnit(schema.capabilities.partPicker ? line.partRecordId : null)
  // FILE is array-return (plan 37b §3) — the photos attribute reads back as an array
  // of `{ ref, caption?, internal? }` envelopes (or is absent/empty when there are
  // none). A document whose lines carry no photos field has no attribute to read.
  const rawPhotos = schema.photosAttr ? values[schema.photosAttr] : undefined
  const photoCount = Array.isArray(rawPhotos) ? rawPhotos.length : 0
  // Photo popover open state lives here (not in LinePhotoPopover) so the `⋯`
  // menu's "Add images" and the ⇧P shortcut can open it (plan 40).
  const [photosOpen, setPhotosOpen] = useState(false)
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
        optional={line.optional}
        grip={readOnly ? null : <GripSlot attributes={attributes} listeners={listeners} />}
        name={
          schema.capabilities.partPicker && schema.attrs.partRecordId ? (
            <LinePartCellView
              partAttribute={schema.attrs.partRecordId}
              partRecordId={line.partRecordId}
              description={line.description}
              matchKeyAttribute={schema.attrs.purchaseOrderLineRecordId}
              matchKeyRecordId={line.purchaseOrderLineRecordId}
              matchScopeRecordId={matchScopeRecordId}
              renderMatchKeyEditor={renderMatchKeyEditor}
              currencyCode={currencyCode}
              glAccountAttribute={schema.attrs.glAccount}
              glAccount={line.glAccount}
              readOnly={readOnly}
              onPickPart={(partRecordId) => onUpdateLine(recordId, { partRecordId })}
              onCommitDescription={(description) => onUpdateLine(recordId, { description })}
              onPickMatchKey={(purchaseOrderLineRecordId) =>
                onUpdateLine(recordId, { purchaseOrderLineRecordId })
              }
              onCommitGlAccount={(glAccount) => onUpdateLine(recordId, { glAccount })}
              onDelete={() => deleteLine(record.id)}
            />
          ) : (
            <LineNameCellView
              name={line.name}
              description={line.description}
              category={line.category}
              categoryOptions={categoryOptions}
              taxable={line.taxable}
              readOnly={readOnly}
              currencyCode={currencyCode}
              catalogItems={catalogItems}
              catalogGroups={catalogGroups}
              catalogItemMap={catalogItemMap}
              catalogLoading={catalogLoading}
              showOptionalControls={showOptional}
              optional={line.optional}
              optionalSelected={line.optionalSelected}
              onToggleOptional={(optional) => onUpdateLine(recordId, { optional })}
              onToggleOptionalSelected={(optionalSelected) =>
                onUpdateLine(recordId, { optionalSelected })
              }
              onToggleTaxable={(taxable) => onUpdateLine(recordId, { taxable })}
              onPickCatalogItem={(item) => onUpdateLine(recordId, catalogItemToLinePatch(item))}
              onSelectGroup={(group) => onSelectGroup(recordId, group)}
              onFreeText={(name) => onUpdateLine(recordId, { name })}
              onCommitDescription={(description) => onUpdateLine(recordId, { description })}
              onCommitCategory={(category) => onUpdateLine(recordId, { category })}
              onDelete={() => deleteLine(record.id)}
              photoChip={
                photosField ? (
                  <LinePhotoPopover
                    recordId={recordId}
                    field={photosField}
                    photoCount={photoCount}
                    readOnly={readOnly}
                    open={photosOpen}
                    onOpenChange={setPhotosOpen}
                  />
                ) : undefined
              }
              hasPhotos={photoCount > 0}
              onOpenPhotos={photosField && !readOnly ? () => setPhotosOpen(true) : undefined}
            />
          )
        }
        qty={
          <QuantityCellView
            quantity={line.qty}
            // A purchasing line's unit is the PART's; the schema's own `unit`
            // attribute is `null` there, so `line.unit` is always null too.
            unit={schema.capabilities.partPicker ? partUnit : line.unit}
            unitEditable={schema.capabilities.unit}
            readOnly={readOnly}
            onCommit={(next) => {
              const patch: LinePatch = {}
              if (next.quantity !== line.qty) patch.qty = next.quantity
              if (next.unit !== line.unit) patch.unit = next.unit
              onUpdateLine(recordId, patch)
            }}
          />
        }
        price={
          <PriceCellView
            value={line.unitPriceCents}
            readOnly={readOnly}
            currencyCode={currencyCode}
            // 🛑 The rate and the amount are the ONE pair that cross-fills, and
            // only on a `stored` document. `crossFillAmount` fills a blank
            // sibling and never rewrites one that already has a value — see its
            // own doc for why correcting the pair would delete the finding.
            onCommit={(unitPriceCents) =>
              onUpdateLine(recordId, crossFillAmount({ unitPriceCents }, line, schema))
            }
          />
        }
        totalNavigable={schema.amountMode === 'stored'}
        total={
          <LineTotalCellView
            amountMode={schema.amountMode}
            qty={line.qty}
            unitPrice={line.unitPriceCents}
            lineTotal={line.lineTotal}
            mismatch={hasAmountMismatch(line, schema)}
            readOnly={readOnly}
            currencyCode={currencyCode}
            onCommit={(lineTotal) =>
              onUpdateLine(recordId, crossFillAmount({ lineTotal }, line, schema))
            }
          />
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
  categoryOptions,
  currencyCode,
  documentType,
  catalogItems,
  catalogGroups,
  catalogItemMap,
  catalogLoading,
  matchScopeRecordId,
  renderMatchKeyEditor,
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
  documentType: DocumentType
  catalogItems: CatalogItem[]
  catalogGroups: CatalogGroup[]
  catalogItemMap: Map<string, CatalogItem>
  catalogLoading: boolean
  matchScopeRecordId: RecordId | null
  renderMatchKeyEditor?: MatchKeyEditorRenderer
  deleteDraft: (draftId: string) => void
  createDraft: (draftId: string, overrides?: LinePatch) => Promise<void>
  onSelectGroup: (draftId: string, group: CatalogGroup) => void
}) {
  const schema = lineSchemaFor(documentType)
  const showOptional = schema.capabilities.optional
  const partUnit = usePartUnit(schema.capabilities.partPicker ? draft.partRecordId : null)

  return (
    <LineGridRow
      rowIndex={rowIndex}
      optional={showOptional && draft.optional}
      grip={null}
      name={
        schema.capabilities.partPicker && schema.attrs.partRecordId ? (
          <LinePartCellView
            partAttribute={schema.attrs.partRecordId}
            partRecordId={draft.partRecordId}
            description={draft.description}
            matchKeyAttribute={schema.attrs.purchaseOrderLineRecordId}
            matchKeyRecordId={draft.purchaseOrderLineRecordId}
            matchScopeRecordId={matchScopeRecordId}
            renderMatchKeyEditor={renderMatchKeyEditor}
            currencyCode={currencyCode}
            glAccountAttribute={schema.attrs.glAccount}
            glAccount={draft.glAccount}
            readOnly={false}
            // On a PURCHASE ORDER the part IS the line's identity, so picking one
            // is what fires the draft's first `record.create` — carrying any
            // description already typed. On a bill it is not
            // (`capabilities.draftRequiresPart`), and any of these commits can
            // materialize the row. See LinePartCellView and `createDraft`.
            onPickPart={(partRecordId) => void createDraft(draft.draftId, { partRecordId })}
            // Also routed through `createDraft`, which accumulates rather than
            // creating while a required part is still unset — every draft-state
            // write goes through `mutateDrafts`, never a direct mutation.
            onCommitDescription={(description) => void createDraft(draft.draftId, { description })}
            onPickMatchKey={(purchaseOrderLineRecordId) =>
              void createDraft(draft.draftId, { purchaseOrderLineRecordId })
            }
            onCommitGlAccount={(glAccount) => void createDraft(draft.draftId, { glAccount })}
            onDelete={() => deleteDraft(draft.draftId)}
          />
        ) : (
          <LineNameCellView
            name={draft.name}
            description={draft.description}
            category={draft.category}
            categoryOptions={categoryOptions}
            taxable={draft.taxable}
            readOnly={false}
            currencyCode={currencyCode}
            catalogItems={catalogItems}
            catalogGroups={catalogGroups}
            catalogItemMap={catalogItemMap}
            catalogLoading={catalogLoading}
            autoFocus={autoFocus}
            showOptionalControls={showOptional}
            optional={draft.optional}
            optionalSelected={draft.optionalSelected}
            onToggleOptional={(next) => void createDraft(draft.draftId, { optional: next })}
            onToggleOptionalSelected={(next) =>
              void createDraft(draft.draftId, { optionalSelected: next })
            }
            onToggleTaxable={(next) => void createDraft(draft.draftId, { taxable: next })}
            onPickCatalogItem={(item) =>
              void createDraft(draft.draftId, catalogItemToLinePatch(item))
            }
            onSelectGroup={(group) => onSelectGroup(draft.draftId, group)}
            onFreeText={(text) => void createDraft(draft.draftId, { name: text })}
            onCommitDescription={(value) => void createDraft(draft.draftId, { description: value })}
            onCommitCategory={(value) => void createDraft(draft.draftId, { category: value })}
            onDelete={() => deleteDraft(draft.draftId)}
          />
        )
      }
      qty={
        <QuantityCellView
          quantity={draft.qty}
          unit={schema.capabilities.partPicker ? partUnit : draft.unit}
          unitEditable={schema.capabilities.unit}
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
          onCommit={(next) =>
            void createDraft(
              draft.draftId,
              crossFillAmount({ unitPriceCents: next }, draft, schema)
            )
          }
        />
      }
      totalNavigable={schema.amountMode === 'stored'}
      total={
        <LineTotalCellView
          amountMode={schema.amountMode}
          qty={draft.qty}
          unitPrice={draft.unitPriceCents}
          lineTotal={draft.lineTotal}
          mismatch={hasAmountMismatch(draft, schema)}
          readOnly={false}
          currencyCode={currencyCode}
          onCommit={(lineTotal) =>
            void createDraft(draft.draftId, crossFillAmount({ lineTotal }, draft, schema))
          }
        />
      }
    />
  )
}
