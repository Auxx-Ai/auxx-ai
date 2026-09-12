// apps/web/src/components/accounting/ui/journal/journal-lines.tsx

'use client'

import type { ChartAccountRow, CounterpartyType, JournalEntryLine } from '@auxx/lib/postings/client'
import { parseRecordId, toRecordId } from '@auxx/lib/resources/client'
import { Alert } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Input } from '@auxx/ui/components/input'
import { Popover, PopoverAnchor, PopoverContent } from '@auxx/ui/components/popover'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import { generateId } from '@auxx/utils'
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
import {
  CheckCircle2,
  Ellipsis,
  GripVertical,
  Plus,
  StickyNote,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { formatAccountLabel } from '~/components/accounting/ui/account-label-format'
import {
  GlAccountPickerContent,
  useChartAccounts,
} from '~/components/accounting/ui/gl-account-picker'
import { formatMinor } from '~/components/accounting/ui/ledger/format'
import { useLineNav } from '~/components/line-grid/hooks/use-line-nav'
import { CurrencyCellInput } from '~/components/money/ui/line-builder/line-rows'
import { RecordPicker } from '~/components/pickers/record-picker/record-picker'
import { useResource } from '~/components/resources'
import { RecordBadge } from '~/components/resources/ui/record-badge'

/**
 * A DEPARTURE from the ui-plan's default shape (§2.1: `LINE_SCHEMAS.journal_entry`
 * over `LineBuilder`). `LineBuilder` (`money/ui/line-builder/`) is built around
 * lines that are their OWN `EntityInstance`s - created, patched and reordered one
 * record at a time through `record.create`/`record.update`, with a whole
 * real-time/optimistic-cache machinery on top (see `line-values.ts`,
 * `line-rows.tsx` at ~2,650 lines). A journal entry's lines are not records at
 * all: `journal_entry_lines` is ONE JSON field on the `journal_entry` instance,
 * replaced wholesale on every save (`writes.ts`'s `updateJournalEntry`). Bending
 * `LineBuilder` onto a single JSON array would mean either giving every draft
 * line a fake record identity it does not have, or forking large parts of the
 * builder's internals - either one is well past a day of work for a shape
 * `LineBuilder` was never designed to hold.
 *
 * So this is a thin, purpose-built grid instead: same LOOK (a trailing phantom
 * draft row that materializes on first keystroke), reusing every piece of
 * `LineBuilder` that has no record assumptions - `useLineNav`'s spreadsheet
 * keyboard nav (`data-line-row`/`data-line-col`, now the document-agnostic
 * `line-grid` kit's) and `CurrencyCellInput`'s chromeless cell (still exported
 * from money's `line-rows.tsx`, which is where currency formatting belongs) -
 * plus a drag grip and a row `⋯` menu in `LineBuilder`'s visual idiom.
 * `LineNameCellView`, `useLineHotkeys` and `LINE_SCHEMAS` are the pieces that
 * stay out: hard-wired to catalog items or a full record schema, and do not
 * fit a plain array with no per-line record.
 */

/** One row as the grid edits it. Debit and credit are mutually exclusive UI slots. */
export interface JournalLineDraft {
  /** Client-only identity for React keys, drag-and-drop and keyboard nav. Never sent to the server. */
  key: string
  glAccountId: string | null
  memo: string
  debitMinor: number | null
  creditMinor: number | null
  /**
   * Who this line is attributable to, when its account is receivable- or
   * payable-backed (brief 13 §1.4). Nullable rather than optional: the grid
   * always has an opinion (there is or is not a counterparty), unlike the
   * wire shape where the key is simply absent.
   */
  counterpartyType: CounterpartyType | null
  counterpartyId: string | null
}

export function emptyDraftRow(): JournalLineDraft {
  return {
    key: generateId('jel'),
    glAccountId: null,
    memo: '',
    debitMinor: null,
    creditMinor: null,
    counterpartyType: null,
    counterpartyId: null,
  }
}

/**
 * Draft rows -> the wire shape (`journalEntryLine` on `routers/ledger.ts`).
 *
 * A row that has no account, or has neither a debit nor a credit amount, is
 * dropped rather than sent as a zero/empty line - that is what makes the
 * trailing phantom row safe to include in `onChange` unfiltered.
 */
export function linesFromDraftRows(rows: JournalLineDraft[]): JournalEntryLine[] {
  const lines: JournalEntryLine[] = []
  for (const row of rows) {
    if (!row.glAccountId) continue
    const hasDebit = row.debitMinor !== null && row.debitMinor > 0
    const hasCredit = row.creditMinor !== null && row.creditMinor > 0
    if (!hasDebit && !hasCredit) continue
    const direction = hasDebit ? 'debit' : 'credit'
    const amountMinor = (hasDebit ? row.debitMinor : row.creditMinor) as number
    lines.push({
      glAccountId: row.glAccountId,
      direction,
      amountMinor,
      ...(row.memo.trim() ? { memo: row.memo.trim() } : {}),
      ...(row.counterpartyType && row.counterpartyId
        ? { counterpartyType: row.counterpartyType, counterpartyId: row.counterpartyId }
        : {}),
    })
  }
  return lines
}

/** The wire shape -> draft rows, for loading a saved or reopened entry. */
export function draftRowsFromLines(lines: JournalEntryLine[]): JournalLineDraft[] {
  return lines.map((line) => ({
    key: generateId('jel'),
    glAccountId: line.glAccountId,
    memo: line.memo ?? '',
    debitMinor: line.direction === 'debit' ? line.amountMinor : null,
    creditMinor: line.direction === 'credit' ? line.amountMinor : null,
    counterpartyType: line.counterpartyType ?? null,
    counterpartyId: line.counterpartyId ?? null,
  }))
}

export interface JournalLineTotals {
  debitMinor: number
  creditMinor: number
  balanced: boolean
  differenceMinor: number
}

/** Sum of debits/credits across only the rows that would actually post. */
export function computeJournalLineTotals(rows: JournalLineDraft[]): JournalLineTotals {
  const lines = linesFromDraftRows(rows)
  const debitMinor = lines
    .filter((l) => l.direction === 'debit')
    .reduce((sum, l) => sum + l.amountMinor, 0)
  const creditMinor = lines
    .filter((l) => l.direction === 'credit')
    .reduce((sum, l) => sum + l.amountMinor, 0)
  return {
    debitMinor,
    creditMinor,
    balanced: debitMinor === creditMinor,
    differenceMinor: Math.abs(debitMinor - creditMinor),
  }
}

/**
 * Grip · Account · Debit · Credit · menu - the same column shape `LineBuilder`
 * uses (`LINE_COLS` in `line-rows.tsx`), sized for this grid's own cells.
 * Memo has no standing column - there is no room for it beside Account at
 * drawer width, so it lives behind the row menu instead (see `JournalLineRow`).
 */
const GRID_COLS = '1.5rem minmax(14rem,1fr) 7rem 7rem 2rem'

/**
 * Which counterparty kind an account's subtype demands, per brief 13 §1.4 -
 * `null` for every other subtype, which is most of the chart.
 */
function requiredCounterpartyKind(subtype: ChartAccountRow['subtype']): CounterpartyType | null {
  if (subtype === 'accounts_receivable') return 'customer'
  if (subtype === 'accounts_payable') return 'vendor'
  return null
}

/**
 * The counterparty control for one row's Account cell: a chosen record shows
 * as a compact `RecordBadge` with a clear button, and an empty slot is a small
 * text trigger that opens a single-select `RecordPicker` scoped to the
 * required entity type. Never a refusal here - brief 13 §1.4 leaves the field
 * empty until the QuickBooks export needs it.
 */
function CounterpartyCell({
  kind,
  entityDefinitionId,
  recordInstanceId,
  disabled,
  onSelect,
  onClear,
}: {
  kind: CounterpartyType
  /** Null while the `contact`/`company` resource has not hydrated yet. */
  entityDefinitionId: string | null
  recordInstanceId: string | null
  disabled?: boolean
  onSelect: (instanceId: string) => void
  onClear: () => void
}) {
  const label = kind === 'customer' ? 'Customer' : 'Vendor'

  if (recordInstanceId && entityDefinitionId) {
    return (
      <div className='flex items-center gap-1'>
        <RecordBadge recordId={toRecordId(entityDefinitionId, recordInstanceId)} size='sm' />
        <button
          type='button'
          aria-label={`Remove ${label.toLowerCase()}`}
          disabled={disabled}
          onClick={onClear}
          className='flex size-4 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50'>
          <X className='size-3' />
        </button>
      </div>
    )
  }

  return (
    <RecordPicker
      value={[]}
      onChange={() => {}}
      multi={false}
      entityDefinitionId={entityDefinitionId ?? undefined}
      disabled={disabled || !entityDefinitionId}
      onSelectSingle={(recordId) => onSelect(parseRecordId(recordId).entityInstanceId)}
      placeholder={`Search ${label.toLowerCase()}s…`}>
      <button
        type='button'
        disabled={disabled || !entityDefinitionId}
        className='w-fit text-left text-muted-foreground text-xs underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50'>
        + {label}
      </button>
    </RecordPicker>
  )
}

/**
 * The Account cell: a real, always-present `<input>` (not a button that
 * merely opens a picker) - `useLineNav` moves keyboard focus straight onto
 * it, and a plain button has nothing for a keystroke to land in. At rest it
 * shows the selected account's formatted label; on focus it clears to a live
 * search that filters the dropdown below as you type - `LineNameCellView`'s
 * reveal pattern, adapted for a value with no free-text form of its own.
 * Nothing commits except a real pick (`onChange` fires only from a
 * `CommandDetailItem.onSelect`), so a search that matches nothing, or that
 * the caller never finishes, simply reverts - never a wrong account.
 *
 * 🛑 Focus moves INTO the popover's own search box the moment it opens,
 * rather than staying pinned on the row's `<input>`. A first attempt kept
 * focus outside so `useLineNav` and the dropdown could both read the same
 * keystrokes - but `useLineNav` listens in the CAPTURE phase, so it always
 * intercepts Up/Down/Enter before cmdk's own root ever sees them, and
 * `focusCell` moving focus to the NEXT row re-opens a fresh, unfiltered
 * dropdown there instead of moving the highlight in this one. `useLineNav`
 * already has the fix for this - `isInsidePopper()` bails out entirely while
 * focus sits inside a Radix popper - and it only works when focus genuinely
 * IS inside the popper, which is exactly the LineBuilder catalog `/` picker's
 * own arrangement. The one cost is the row's `<input>` is a trigger, not the
 * typing surface itself - `readOnly`, and its own Tab/arrow-nav focus is what
 * opens the popover and immediately hands focus to the real search box.
 */
function AccountCell({
  value,
  onChange,
  disabled,
  placeholder = 'Account…',
}: {
  value: string | null
  onChange: (id: string | null) => void
  disabled?: boolean
  placeholder?: string
}) {
  const { accounts, isLoading } = useChartAccounts()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  // 🛑 Refocusing the trigger below (so the NEXT Tab/arrow-key has somewhere
  // to move from) fires that same input's own `onFocus` synchronously, which
  // would reopen the popover it was just told to close - the exact
  // close-then-refocus race the memo editor and `GlAccountPicker`'s dropped
  // `openOnFocus` attempt both hit. Suppressed for the one `.focus()` call.
  const suppressReopenRef = useRef(false)

  const selected = useMemo(() => accounts.find((a) => a.id === value) ?? null, [accounts, value])

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setSearch('')
      requestAnimationFrame(() => {
        suppressReopenRef.current = true
        inputRef.current?.focus()
        suppressReopenRef.current = false
      })
    }
  }

  function commit(id: string) {
    onChange(id)
    handleOpenChange(false)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverAnchor asChild>
        <input
          ref={inputRef}
          data-cell-focusable
          readOnly
          role='combobox'
          aria-expanded={open}
          value={selected ? formatAccountLabel(selected) : ''}
          onFocus={() => {
            if (suppressReopenRef.current) return
            setOpen(true)
          }}
          placeholder={placeholder}
          disabled={disabled}
          className='h-8 w-full min-w-0 cursor-default rounded-sm border-none bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground'
        />
      </PopoverAnchor>
      <PopoverContent
        className='min-w-[max(var(--radix-popover-trigger-width),18rem)] p-0'
        align='start'
        onCloseAutoFocus={(e) => e.preventDefault()}>
        <GlAccountPickerContent
          accounts={accounts}
          isLoading={isLoading}
          search={search}
          onSearchChange={setSearch}
          selectBy='id'
          value={value}
          onSelect={commit}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  )
}

interface JournalLineRowProps {
  row: JournalLineDraft
  rowIndex: number
  /** The trailing blank row - no grip, no menu, nothing to act on yet. */
  isPhantom: boolean
  disabled?: boolean
  currencyCode: string
  account: ChartAccountRow | undefined
  contactEntityDefinitionId: string | null
  companyEntityDefinitionId: string | null
  editingMemo: boolean
  onEditMemo: () => void
  onStopEditingMemo: () => void
  onPatch: (patch: Partial<JournalLineDraft>) => void
  onAccountChange: (glAccountId: string | null) => void
  onRemove: () => void
}

/**
 * One line's grid row. `useSortable` is called unconditionally (with
 * `disabled` for the phantom) rather than only for real rows, because
 * materializing the phantom keeps its React key - the SAME component instance
 * flips from `isPhantom: true` to `false` between renders, and a hook cannot
 * appear only on one side of that.
 */
function JournalLineRow({
  row,
  rowIndex,
  isPhantom,
  disabled,
  currencyCode,
  account,
  contactEntityDefinitionId,
  companyEntityDefinitionId,
  editingMemo,
  onEditMemo,
  onStopEditingMemo,
  onPatch,
  onAccountChange,
  onRemove,
}: JournalLineRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.key,
    disabled: isPhantom || disabled,
  })

  const requiredKind = requiredCounterpartyKind(account?.subtype ?? null)
  const hasMemo = row.memo.trim().length > 0

  // 🛑 `autoFocus` alone loses this race: `onEditMemo` fires from inside the
  // `⋯` menu's `onSelect`, and Radix's own focus cleanup for that closing
  // menu runs a tick later and steals focus back to `<body>` even with
  // `onCloseAutoFocus` prevented on the menu content. Deferring one frame -
  // the same fix `line-rows.tsx` uses before opening a second Radix layer
  // from this same menu - lets that cleanup finish first.
  const memoInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!editingMemo) return
    const frame = requestAnimationFrame(() => memoInputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [editingMemo])

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('group/tree-row relative text-sm', isDragging && 'z-10 opacity-80')}>
      {/* Hover background - a standalone layer behind the grid columns, same
          treatment `LineGridRow` uses. */}
      <div className='absolute inset-0 rounded-md transition-colors group-hover/tree-row:bg-background' />

      <div
        className='relative grid min-h-9 items-stretch gap-2 px-1'
        style={{ gridTemplateColumns: GRID_COLS }}>
        <div className='flex items-center justify-center'>
          {!isPhantom && (
            <button
              type='button'
              aria-label='Reorder line'
              disabled={disabled}
              {...attributes}
              {...listeners}
              className='flex size-5 cursor-grab items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity group-hover/tree-row:opacity-100 disabled:opacity-0'>
              <GripVertical className='size-3.5' />
            </button>
          )}
        </div>

        <div
          data-line-row={rowIndex}
          data-line-col={0}
          className='flex min-w-0 flex-col justify-center gap-1'>
          {editingMemo ? (
            <Input
              ref={memoInputRef}
              value={row.memo}
              onChange={(e) => onPatch({ memo: e.target.value })}
              onBlur={onStopEditingMemo}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') {
                  e.preventDefault()
                  onStopEditingMemo()
                }
              }}
              placeholder='Memo'
              disabled={disabled}
              className='h-8'
            />
          ) : (
            <>
              <div className='flex items-center gap-1'>
                <div className='min-w-0 flex-1'>
                  <AccountCell
                    value={row.glAccountId}
                    onChange={onAccountChange}
                    disabled={disabled}
                    placeholder='Account…'
                  />
                </div>
                {hasMemo && (
                  <SimpleTooltip content={row.memo}>
                    <button
                      type='button'
                      aria-label='Edit memo'
                      disabled={disabled}
                      onClick={onEditMemo}
                      className='flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent disabled:opacity-50'>
                      <StickyNote className='size-3.5' />
                    </button>
                  </SimpleTooltip>
                )}
              </div>
              {requiredKind && (
                <CounterpartyCell
                  kind={requiredKind}
                  entityDefinitionId={
                    requiredKind === 'customer'
                      ? contactEntityDefinitionId
                      : companyEntityDefinitionId
                  }
                  recordInstanceId={row.counterpartyId}
                  disabled={disabled}
                  onSelect={(id) => onPatch({ counterpartyType: requiredKind, counterpartyId: id })}
                  onClear={() => onPatch({ counterpartyType: null, counterpartyId: null })}
                />
              )}
            </>
          )}
        </div>

        <div data-line-row={rowIndex} data-line-col={1} className='flex items-center'>
          <CurrencyCellInput
            value={row.debitMinor}
            readOnly={!!disabled}
            currencyCode={currencyCode}
            ariaLabel='Debit'
            // Commit per keystroke, not just on blur - `onPatch` is cheap
            // local state (the whole entry saves wholesale on Save draft), and
            // the balance strip below should move as you type, not only once
            // you tab away.
            live
            onCommit={(next) =>
              onPatch({ debitMinor: next, creditMinor: next ? null : row.creditMinor })
            }
          />
        </div>

        <div data-line-row={rowIndex} data-line-col={2} className='flex items-center'>
          <CurrencyCellInput
            value={row.creditMinor}
            readOnly={!!disabled}
            currencyCode={currencyCode}
            ariaLabel='Credit'
            live
            onCommit={(next) =>
              onPatch({ creditMinor: next, debitMinor: next ? null : row.debitMinor })
            }
          />
        </div>

        <div className='flex items-center justify-center'>
          {!isPhantom && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type='button'
                  aria-label='Line actions'
                  disabled={disabled}
                  className='flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-accent disabled:opacity-50'>
                  <Ellipsis className='size-3.5' />
                </button>
              </DropdownMenuTrigger>
              {/* `onCloseAutoFocus` prevented: without it Radix returns focus to
                  this (mouse-only) trigger right after the menu closes, which
                  steals the memo input's `autoFocus` a tick after it mounts -
                  `LineRowMenu` guards the same way for its description field. */}
              <DropdownMenuContent align='end' onCloseAutoFocus={(e) => e.preventDefault()}>
                <DropdownMenuItem onSelect={onEditMemo}>
                  <StickyNote />
                  {hasMemo ? 'Edit memo' : 'Add memo'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant='destructive' onSelect={onRemove}>
                  <Trash2 />
                  Delete line
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </div>
  )
}

interface JournalLinesProps {
  /** Real (materialized) rows only - never includes the trailing phantom. */
  rows: JournalLineDraft[]
  onChange: (rows: JournalLineDraft[]) => void
  currencyCode: string
  disabled?: boolean
}

/**
 * The lines grid: a drag grip, Account (Memo lives behind its row menu, see
 * below), Debit, Credit, plus a trailing phantom row that materializes into a
 * real row the moment anything is typed into it.
 *
 * Keyboard nav is `LineBuilder`'s own `useLineNav` - it has no record
 * assumptions, just `data-line-row`/`data-line-col` cells, so it works
 * unmodified here. `GlAccountPicker` is a `PickerTrigger asCombobox`
 * (`role="combobox"`), which is exactly what `useLineNav`'s focus matcher
 * already looks for.
 */
export function JournalLines({ rows, onChange, currencyCode, disabled }: JournalLinesProps) {
  // The phantom row's key is held in state, not regenerated every render, so
  // materializing it (below) keeps the SAME React key on the row that was just
  // typed into - only the NEXT phantom gets a fresh one. Regenerating on every
  // render would change the key the instant the row stopped being blank, which
  // unmounts and remounts the input and drops focus mid-keystroke.
  const [phantomKey, setPhantomKey] = useState(() => generateId('jel'))
  const phantom: JournalLineDraft = {
    key: phantomKey,
    glAccountId: null,
    memo: '',
    debitMinor: null,
    creditMinor: null,
    counterpartyType: null,
    counterpartyId: null,
  }
  const displayRows = [...rows, phantom]

  /** Which row (by key) is currently showing the memo editor in its Account cell. */
  const [editingMemoKey, setEditingMemoKey] = useState<string | null>(null)

  const { accounts } = useChartAccounts()
  const { resource: contactResource } = useResource('contact')
  const { resource: companyResource } = useResource('company')

  const rowsContainerRef = useRef<HTMLDivElement>(null)

  function patchRow(index: number, patch: Partial<JournalLineDraft>) {
    if (index === rows.length) {
      // The phantom row: typing into it materializes it as a new real row,
      // keeping the same key, and a fresh phantom takes its place below it.
      onChange([...rows, { ...phantom, ...patch }])
      setPhantomKey(generateId('jel'))
      return
    }
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  /**
   * Brief 13 §1.4: a row's account decides whether it may carry a
   * counterparty at all, and which kind. Picking a new account that does not
   * require the kind already on the row clears it - switching straight from
   * an A/R account to an A/P one must not leave a customer id sitting under
   * `counterpartyType: 'vendor'`.
   */
  function handleAccountChange(index: number, glAccountId: string | null) {
    const account = glAccountId ? accounts.find((a: ChartAccountRow) => a.id === glAccountId) : null
    const requiredKind = requiredCounterpartyKind(account?.subtype ?? null)
    const row = index === rows.length ? phantom : rows[index]
    const keepsCounterparty = row && requiredKind === row.counterpartyType
    patchRow(index, {
      glAccountId,
      ...(keepsCounterparty ? {} : { counterpartyType: null, counterpartyId: null }),
    })
  }

  function removeRow(index: number) {
    const removedKey = rows[index]?.key
    onChange(rows.filter((_, i) => i !== index))
    if (editingMemoKey === removedKey) setEditingMemoKey(null)
  }

  /** Header "+" button - materializes today's phantom row as-is, same as `LineBuilder`'s `addLine`. */
  function addBlankRow() {
    patchRow(rows.length, {})
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = rows.findIndex((row) => row.key === active.id)
    const newIndex = rows.findIndex((row) => row.key === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    onChange(arrayMove(rows, oldIndex, newIndex))
  }

  // Spreadsheet keyboard nav across the rows container (account → debit →
  // credit). `onAddRow` is a no-op: the trailing phantom is always already
  // there as "the next blank line," so nav past it has nothing to add.
  useLineNav({
    containerRef: rowsContainerRef,
    rowCount: displayRows.length,
    colCount: 3,
    onAddRow: () => {},
    readOnly: !!disabled,
  })

  return (
    <div
      data-slot='line-builder-frame'
      className='rounded-lg border border-primary-200/50 dark:border-[#1e2227]'>
      {/* Header - same grid template as the rows, so the labels sit over
          their columns, `LineBuilder`'s own header treatment. */}
      <div
        className='sticky top-0 z-10 grid rounded-t-lg border-primary-200/50 border-b bg-primary-50 px-1 py-2 text-muted-foreground text-sm dark:border-[#1e2227] dark:bg-background'
        style={{ gridTemplateColumns: GRID_COLS }}>
        <div />
        <div className='flex items-center gap-1 pl-2'>
          Account
          {!disabled && (
            <SimpleTooltip content='Add line item' side='right'>
              <Button
                variant='ghost'
                size='icon-xs'
                className='ml-1 size-5 rounded-md bg-primary-100 hover:bg-primary-200 dark:bg-background'
                onClick={addBlankRow}
                aria-label='Add line item'>
                <Plus className='size-3' />
              </Button>
            </SimpleTooltip>
          )}
        </div>
        <div className='px-2 text-right'>Debit</div>
        <div className='px-2 text-right'>Credit</div>
        <div />
      </div>

      <div ref={rowsContainerRef}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          modifiers={[restrictToVerticalAxis]}>
          <SortableContext
            items={rows.map((row) => row.key)}
            strategy={verticalListSortingStrategy}
            disabled={disabled}>
            {displayRows.map((row, index) => {
              const isPhantom = index === rows.length
              const account = row.glAccountId
                ? accounts.find((a: ChartAccountRow) => a.id === row.glAccountId)
                : undefined
              return (
                <JournalLineRow
                  key={row.key}
                  row={row}
                  rowIndex={index}
                  isPhantom={isPhantom}
                  disabled={disabled}
                  currencyCode={currencyCode}
                  account={account}
                  contactEntityDefinitionId={contactResource?.id ?? null}
                  companyEntityDefinitionId={companyResource?.id ?? null}
                  editingMemo={editingMemoKey === row.key}
                  onEditMemo={() => setEditingMemoKey(row.key)}
                  onStopEditingMemo={() => setEditingMemoKey(null)}
                  onPatch={(patch) => patchRow(index, patch)}
                  onAccountChange={(id) => handleAccountChange(index, id)}
                  onRemove={() => removeRow(index)}
                />
              )
            })}
          </SortableContext>
        </DndContext>
      </div>
    </div>
  )
}

/**
 * The Debits / Credits / Difference verdict strip, copied from
 * `ledger/entry-journal.tsx`'s totals footer to match its look exactly.
 */
export function JournalLinesTotals({
  rows,
  currencyCode,
}: {
  rows: JournalLineDraft[]
  currencyCode: string
}) {
  const totals = computeJournalLineTotals(rows)

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex items-center justify-end gap-6 text-sm'>
        <span className='text-muted-foreground'>
          Debits{' '}
          <span className='font-mono tabular-nums text-foreground'>
            {formatMinor(totals.debitMinor, currencyCode)}
          </span>
        </span>
        <span className='text-muted-foreground'>
          Credits{' '}
          <span className='font-mono tabular-nums text-foreground'>
            {formatMinor(totals.creditMinor, currencyCode)}
          </span>
        </span>
      </div>
      <Alert variant={totals.balanced ? 'success' : 'destructive'}>
        {totals.balanced ? <CheckCircle2 /> : <TriangleAlert />}
        <span>
          {totals.balanced
            ? 'Balanced. Debits equal credits.'
            : `Out of balance by ${formatMinor(totals.differenceMinor, currencyCode)}.`}
        </span>
      </Alert>
    </div>
  )
}
