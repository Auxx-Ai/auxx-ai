// apps/web/src/components/accounting/ui/settings/recurring-template-schedule-editor.tsx
'use client'

// The detail pane of Accounting > Settings > Recurring templates (task 21 §1.6):
// how often one template repeats, and what it currently owes.
//
// 🛑 The LINES are not edited here. They are edited in the journal-entry
// drawer, which already has the account picker, the debit/credit grid and the
// balance strip - "the template drawer is the existing journal-entry drawer
// with the date field replaced by the recurrence editor" (§1.6). What this pane
// owns is the one thing the drawer cannot: a rule needs a SAVED record to hang
// off, and the drawer defers its create to the first edit.

import { describeRecurrence, type RecurrencePattern } from '@auxx/lib/recurrence/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { CalendarClock, Pencil, Repeat, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { RecurrencePatternFields } from '~/components/global/recurrence/recurrence-pattern-fields'
import { defaultCustomPattern } from '~/components/global/recurrence/recurrence-utils'
import { formatPeriodLabel } from '../ledger/format'
import type { RecurringTemplateRow } from './recurring-templates-list'

/**
 * Cancels the pane's `p-3` so `Section` sits FLUSH with it. `Section` draws
 * its own `p-3` and a full-width `border-b`, a divider meant to run edge to
 * edge (see `bank-account-editor.tsx`'s own copy of this).
 */
const SECTION_BLEED = '-mx-3'

interface RecurringTemplateScheduleEditorProps {
  row: RecurringTemplateRow | null
  weekStartIndex: 0 | 1 | 6
  weekStart: 'monday' | 'sunday' | 'saturday'
  saving: boolean
  clearing: boolean
  onSave: (pattern: RecurrencePattern) => void
  onClear: () => void
  onEditLines: () => void
}

export function RecurringTemplateScheduleEditor({
  row,
  weekStartIndex,
  weekStart,
  saving,
  clearing,
  onSave,
  onClear,
  onEditLines,
}: RecurringTemplateScheduleEditorProps) {
  // 🛑 Local draft, committed on Save - never a mutation per keystroke. The
  // recurrence editor's own contract is explicit-save (`repeat-editor.tsx`
  // does the same), and here the stakes are higher: every keystroke on a live
  // rule would move `effectiveFrom` and change what the next sweep generates.
  const [pattern, setPattern] = useState<RecurrencePattern | null>(null)

  // 🛑 Re-seed on the SELECTION changing, never on every refetch. `row` is a
  // fresh object each time the list query settles, so an effect that keyed on
  // it would wipe what is being typed the moment anything invalidated the
  // list. The ref is what makes "same template, same rule" a no-op.
  const seededKey = useRef<string | null>(null)
  const selectionKey = row ? `${row.template.id}:${row.rule?.id ?? 'none'}` : null

  useEffect(() => {
    if (seededKey.current === selectionKey) return
    seededKey.current = selectionKey
    if (!row) {
      setPattern(null)
      return
    }
    setPattern(
      (row.rule?.pattern as RecurrencePattern | undefined) ??
        defaultCustomPattern(
          row.template.date ? new Date(`${row.template.date}T12:00:00Z`) : undefined
        )
    )
  }, [selectionKey, row])

  if (!row || !pattern) {
    return (
      <div className='p-3'>
        <EmptySection
          icon={<CalendarClock className='size-5' />}
          title='Pick a template'
          description='Its schedule, and what it currently owes, show here.'
        />
      </div>
    )
  }

  const held = row.plan?.held ?? null
  const due = row.plan?.due.length ?? 0
  const dirty = JSON.stringify(pattern) !== JSON.stringify(row.rule?.pattern ?? null)

  return (
    <div className='flex flex-col p-3'>
      <Section
        title='This template'
        icon={<CalendarClock className='size-4' />}
        collapsible={false}
        className={SECTION_BLEED}>
        <div className='flex flex-col gap-2 text-sm'>
          <div className='flex flex-wrap items-center gap-2'>
            <span className='font-medium'>
              {row.template.memo?.trim() || row.template.number || 'Untitled template'}
            </span>
            <Badge variant='secondary' size='xs'>
              {row.template.lines.length} {row.template.lines.length === 1 ? 'line' : 'lines'}
            </Badge>
            {row.template.date && (
              <Badge variant='outline' size='xs'>
                Starts {row.template.date}
              </Badge>
            )}
          </div>
          <p className='text-muted-foreground text-xs'>
            A template posts nothing. The daily sweep copies it into a DRAFT entry for each month it
            owes, and you review and post those from the ledger.
          </p>
          <div>
            <Button variant='outline' size='sm' onClick={onEditLines}>
              <Pencil />
              Edit lines and memo
            </Button>
          </div>
        </div>
      </Section>

      <Section
        title='Repeats'
        icon={<Repeat className='size-4' />}
        collapsible={false}
        className={SECTION_BLEED}>
        <div className='flex flex-col gap-3'>
          <RecurrencePatternFields
            value={pattern}
            onChange={setPattern}
            weekStartIndex={weekStartIndex}
          />
          <p className='text-muted-foreground text-xs'>
            {describeRecurrence(pattern, { weekStart })}. Quarterly is every 3 months and annual is
            every 12; a monthly rule on the 31st lands on the last day of a short month.
          </p>
          <div className='flex flex-wrap items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              loading={saving}
              loadingText='Saving...'
              disabled={!dirty}
              onClick={() => onSave(pattern)}>
              {row.rule ? 'Save schedule' : 'Start repeating'}
            </Button>
            {row.rule && (
              <Button
                variant='ghost'
                size='sm'
                className='text-destructive hover:text-destructive'
                loading={clearing}
                loadingText='Removing...'
                onClick={onClear}>
                Stop repeating
              </Button>
            )}
          </div>
        </div>
      </Section>

      {/* 🛑 The held month is the one thing on this pane a person has to act
          on, and only somebody with `ledger.control` can: a locked month is an
          entry still OWED, not one skipped. The sweep is holding its cursor on
          that occurrence, so nothing is lost while they decide. */}
      {held && (
        <div className='mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30'>
          <TriangleAlert className='mt-0.5 size-4 shrink-0 text-amber-600' />
          <div className='flex flex-col gap-1'>
            <span className='font-medium'>
              Waiting on {formatPeriodLabel(held.month)}, which is closed
            </span>
            <span className='text-muted-foreground text-xs'>
              The entry for {held.occurrenceDate} and everything after it is still owed. Reopen the
              period in Accounting settings and the next sweep generates them; nothing is lost in
              the meantime.
            </span>
          </div>
        </div>
      )}

      {!held && due > 0 && (
        <div className='mt-3 rounded-lg border bg-muted/40 p-3 text-muted-foreground text-sm'>
          {due} {due === 1 ? 'entry is' : 'entries are'} due and will be generated on the next
          nightly sweep.
        </div>
      )}
    </div>
  )
}
