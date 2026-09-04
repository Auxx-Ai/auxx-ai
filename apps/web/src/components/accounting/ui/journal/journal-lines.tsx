// apps/web/src/components/accounting/ui/journal/journal-lines.tsx

'use client'

import type { JournalEntryLine } from '@auxx/lib/postings/client'
import { Input } from '@auxx/ui/components/input'
import { CurrencyInput, CurrencyInputField } from '@auxx/ui/components/input-currency'
import { InputGroup } from '@auxx/ui/components/input-group'
import { cn } from '@auxx/ui/lib/utils'
import { generateId } from '@auxx/utils'
import { CheckCircle2, Trash2, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { GlAccountPicker } from '~/components/accounting/ui/gl-account-picker'
import { formatMinor } from '~/components/accounting/ui/ledger/format'

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
 * draft row that materializes on first keystroke, Enter moves to the next row),
 * none of `LineBuilder`'s record-per-line machinery. State lives one level up
 * (`use-journal-entry-draft.ts`) as a plain array and is saved wholesale, which
 * is exactly what the draft's own storage shape wants.
 */

/** One row as the grid edits it. Debit and credit are mutually exclusive UI slots. */
export interface JournalLineDraft {
  /** Client-only identity for React keys and keyboard nav. Never sent to the server. */
  key: string
  accountCode: string | null
  memo: string
  debitMinor: number | null
  creditMinor: number | null
}

export function emptyDraftRow(): JournalLineDraft {
  return {
    key: generateId('jel'),
    accountCode: null,
    memo: '',
    debitMinor: null,
    creditMinor: null,
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
    if (!row.accountCode) continue
    const hasDebit = row.debitMinor !== null && row.debitMinor > 0
    const hasCredit = row.creditMinor !== null && row.creditMinor > 0
    if (!hasDebit && !hasCredit) continue
    const direction = hasDebit ? 'debit' : 'credit'
    const amountMinor = (hasDebit ? row.debitMinor : row.creditMinor) as number
    lines.push({
      accountCode: row.accountCode,
      direction,
      amountMinor,
      ...(row.memo.trim() ? { memo: row.memo.trim() } : {}),
    })
  }
  return lines
}

/** The wire shape -> draft rows, for loading a saved or reopened entry. */
export function draftRowsFromLines(lines: JournalEntryLine[]): JournalLineDraft[] {
  return lines.map((line) => ({
    key: generateId('jel'),
    accountCode: line.accountCode,
    memo: line.memo ?? '',
    debitMinor: line.direction === 'debit' ? line.amountMinor : null,
    creditMinor: line.direction === 'credit' ? line.amountMinor : null,
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

/** `minmax(14rem,1fr) minmax(10rem,1fr) 7rem 7rem` from ui-plan.md §2.1, plus a delete column. */
const GRID_COLS = 'minmax(14rem,1fr) minmax(10rem,1fr) 7rem 7rem 2rem'

interface JournalLinesProps {
  /** Real (materialized) rows only - never includes the trailing phantom. */
  rows: JournalLineDraft[]
  onChange: (rows: JournalLineDraft[]) => void
  currencyCode: string
  disabled?: boolean
}

/**
 * The lines grid: Account · Memo · Debit · Credit, plus a trailing phantom row
 * that materializes into a real row the moment anything is typed into it.
 *
 * Keyboard nav is intentionally modest next to `LineBuilder`'s: Enter in a
 * Memo/Debit/Credit cell moves focus to the same column one row down (creating
 * the next phantom row along the way when the current one just materialized).
 * `GlAccountPicker` is a popover trigger with no exposed ref, so the account
 * cell is not part of the Enter chain - Tab already reaches it in DOM order.
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
    accountCode: null,
    memo: '',
    debitMinor: null,
    creditMinor: null,
  }
  const displayRows = [...rows, phantom]

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

  function removeRow(index: number) {
    onChange(rows.filter((_, i) => i !== index))
  }

  function focusNext(index: number, col: 'memo' | 'debit' | 'credit') {
    const target = document.querySelector<HTMLElement>(
      `[data-je-row="${index + 1}"][data-je-col="${col}"]`
    )
    target?.focus()
  }

  return (
    <div className='overflow-hidden rounded-lg border'>
      <div
        className='grid gap-2 border-b bg-muted/40 px-2 py-1.5 text-xs font-medium text-muted-foreground'
        style={{ gridTemplateColumns: GRID_COLS }}>
        <span>Account</span>
        <span>Memo</span>
        <span className='text-right'>Debit</span>
        <span className='text-right'>Credit</span>
        <span />
      </div>

      <div className='flex flex-col divide-y'>
        {displayRows.map((row, index) => {
          const isPhantom = index === rows.length
          return (
            <div
              key={row.key}
              className='grid items-center gap-2 px-2 py-1.5'
              style={{ gridTemplateColumns: GRID_COLS }}>
              <GlAccountPicker
                value={row.accountCode}
                onChange={(code) => patchRow(index, { accountCode: code })}
                disabled={disabled}
                placeholder='Account…'
                triggerProps={{ size: 'sm' }}
              />

              <Input
                data-je-row={index}
                data-je-col='memo'
                value={row.memo}
                onChange={(e) => patchRow(index, { memo: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    focusNext(index, 'memo')
                  }
                }}
                placeholder='Memo'
                disabled={disabled}
                className='h-8'
              />

              <CurrencyInput
                value={row.debitMinor}
                currencyCode={currencyCode}
                disabled={disabled}
                onValueChange={(next) =>
                  patchRow(index, {
                    debitMinor: next ?? null,
                    creditMinor: next ? null : row.creditMinor,
                  })
                }>
                <InputGroup className='h-8 border shadow-none'>
                  <CurrencyInputField
                    data-je-row={index}
                    data-je-col='debit'
                    className='text-right'
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        focusNext(index, 'debit')
                      }
                    }}
                  />
                </InputGroup>
              </CurrencyInput>

              <CurrencyInput
                value={row.creditMinor}
                currencyCode={currencyCode}
                disabled={disabled}
                onValueChange={(next) =>
                  patchRow(index, {
                    creditMinor: next ?? null,
                    debitMinor: next ? null : row.debitMinor,
                  })
                }>
                <InputGroup className='h-8 border shadow-none'>
                  <CurrencyInputField
                    data-je-row={index}
                    data-je-col='credit'
                    className='text-right'
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        focusNext(index, 'credit')
                      }
                    }}
                  />
                </InputGroup>
              </CurrencyInput>

              {isPhantom ? (
                <span />
              ) : (
                <button
                  type='button'
                  aria-label='Remove line'
                  disabled={disabled}
                  onClick={() => removeRow(index)}
                  className='flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50'>
                  <Trash2 className='size-3.5' />
                </button>
              )}
            </div>
          )
        })}
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
      <div
        className={cn(
          'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm',
          totals.balanced
            ? 'border-green-500/40 text-green-700 dark:text-green-400'
            : 'border-destructive/50 text-destructive'
        )}>
        {totals.balanced ? (
          <CheckCircle2 className='size-4' />
        ) : (
          <TriangleAlert className='size-4' />
        )}
        <span>
          {totals.balanced
            ? 'Balanced. Debits equal credits.'
            : `Out of balance by ${formatMinor(totals.differenceMinor, currencyCode)}.`}
        </span>
      </div>
    </div>
  )
}
