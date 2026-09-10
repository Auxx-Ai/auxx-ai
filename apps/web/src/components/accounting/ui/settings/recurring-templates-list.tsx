// apps/web/src/components/accounting/ui/settings/recurring-templates-list.tsx
'use client'

// The left column of Accounting > Settings > Recurring templates (task 21 §1.6).
// `payment-gateways-list.tsx`'s flat shape - a template has nothing to group by.
//
// 🛑 The cadence AND the held month are on the ROW, not only in the editor.
// "Which of my templates is stuck because February is closed" is the one
// question this screen exists to answer, and a state that can only be found by
// clicking through every row in turn stays unfinished. Same argument the
// gateway list makes for its clearing-account badge.

import { describeRecurrence, type RecurrencePattern } from '@auxx/lib/recurrence/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { InputSearch } from '@auxx/ui/components/input-search'
import { EmptySection } from '@auxx/ui/components/section'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { cn } from '@auxx/ui/lib/utils'
import { CalendarClock, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { formatPeriodLabel } from '../ledger/format'

/** One row, as `ledger.recurringTemplate.list` returns it. */
export interface RecurringTemplateRow {
  template: {
    id: string
    number: string | null
    memo: string | null
    date: string | null
    lines: unknown[]
  }
  rule: { id: string; pattern: unknown; anchor: string } | null
  plan: { due: unknown[]; held: { occurrenceDate: string; month: string } | null } | null
}

interface RecurringTemplatesListProps {
  templates: RecurringTemplateRow[]
  /** The org's `organization.weekStart`, so a weekly cadence reads in their order. */
  weekStart: 'monday' | 'sunday' | 'saturday'
  isLoading: boolean
  selectedId: string | null
  onSelect: (id: string | null) => void
  onAdd: () => void
}

export function RecurringTemplatesList({
  templates,
  weekStart,
  isLoading,
  selectedId,
  onSelect,
  onAdd,
}: RecurringTemplatesListProps) {
  const [search, setSearch] = useState('')

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return templates
    return templates.filter(
      (row) =>
        (row.template.memo ?? '').toLowerCase().includes(needle) ||
        (row.template.number ?? '').toLowerCase().includes(needle)
    )
  }, [templates, search])

  const addButton = (
    <Button variant='outline' size='sm' className='shrink-0' onClick={onAdd}>
      <Plus />
      New template
    </Button>
  )

  return (
    <div className='flex flex-col gap-3 p-3'>
      {templates.length > 0 && (
        <div className='flex items-center gap-2'>
          <InputSearch
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder='Search templates...'
            className='flex-1'
          />
          {addButton}
        </div>
      )}

      {isLoading ? (
        <EmptySection loading />
      ) : templates.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title='No recurring templates yet'
          description={
            <>
              A template is a journal entry that repeats - a monthly depreciation figure, an accrual
              reversal, a prepaid schedule. It posts nothing itself; a daily sweep copies it into a
              draft for each month it owes, and you review and post those.
            </>
          }
          button={addButton}
        />
      ) : visible.length === 0 ? (
        <EmptySection icon={<CalendarClock className='size-5' />} title='No matches' />
      ) : (
        <div className={cn('flex flex-col gap-0.5', TREE_SECONDARY_NOTRUNCATE)}>
          <TreeRowList
            items={visible}
            getKey={(row: RecurringTemplateRow) => row.template.id}
            renderRow={(row: RecurringTemplateRow) => (
              <TreeRow
                icon={<CalendarClock className='size-4 text-muted-foreground' />}
                title={
                  <span className='truncate text-sm'>
                    {row.template.memo?.trim() || row.template.number || 'Untitled template'}
                  </span>
                }
                onToggleOpen={() => onSelect(row.template.id)}
                rowClassName={cn(
                  'bg-primary-100/50 hover:bg-primary-100',
                  selectedId === row.template.id && 'bg-primary-100 ring-1 ring-primary-200'
                )}
                secondary={
                  <span className='flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs'>
                    <Badge variant='outline' size='xs'>
                      {row.rule
                        ? describeRecurrence(row.rule.pattern as RecurrencePattern, { weekStart })
                        : 'No schedule'}
                    </Badge>
                    <Badge variant='secondary' size='xs'>
                      {row.template.lines.length}{' '}
                      {row.template.lines.length === 1 ? 'line' : 'lines'}
                    </Badge>
                    {/* 🛑 The held month, in the list. An entry the books are
                        owed and cannot have is the whole reason this screen has
                        a status column at all. */}
                    {row.plan?.held && (
                      <Badge variant='amber' size='xs'>
                        Waiting on {formatPeriodLabel(row.plan.held.month)}
                      </Badge>
                    )}
                    {!row.plan?.held && (row.plan?.due.length ?? 0) > 0 && (
                      <Badge variant='outline' size='xs'>
                        {row.plan?.due.length} due
                      </Badge>
                    )}
                  </span>
                }
              />
            )}
          />
        </div>
      )}
    </div>
  )
}
