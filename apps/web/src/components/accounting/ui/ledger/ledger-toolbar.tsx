// apps/web/src/components/accounting/ui/ledger/ledger-toolbar.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Separator } from '@auxx/ui/components/separator'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown, ChevronLeft, ChevronRight, Lock } from 'lucide-react'
import type { FixturePeriodState, FixturePeriodSummary } from '~/components/accounting/fixtures'
import type { LedgerPeriodOption } from '~/components/accounting/hooks/use-ledger-period'
import { Tooltip } from '~/components/global/tooltip'
import { formatPeriodLabel } from './format'

const STATE_LABEL: Record<FixturePeriodState, string> = {
  open: 'Open',
  posted: 'Posted',
  locked: 'Locked',
}

/** The pill's dot. Locked reads as "shut", not as a stronger Posted. */
const STATE_DOT: Record<FixturePeriodState, string> = {
  open: 'bg-amber-500',
  posted: 'bg-green-500',
  locked: 'bg-primary-400',
}

interface LedgerToolbarProps {
  periodKey: string
  options: LedgerPeriodOption[]
  summary?: FixturePeriodSummary
  previousPeriodKey: string | null
  nextPeriodKey: string | null
  resolvedPeriodKey: string
  onSelectPeriod: (periodKey: string) => void
  /** Setup is not finalized: there is no month to navigate to yet. */
  disabled?: boolean
}

/**
 * The ledger's first row inside `MainPageContent`, on `BoardToolbar`'s scale
 * (`gap-1 p-1`, ghost `h-7` buttons, `Separator` dividers, tooltips).
 *
 * ```
 * [ Current ] [ ‹ ] [ March 2027 ▾ ] [ › ]  │  ● Posted · AUXX-MEI-2027-03
 * ```
 *
 * ⚠️ Ordered by `BoardToolbar`'s own rule: the period nav is the STABLE PREFIX
 * and never moves, so switching months causes no layout shift; everything that
 * varies with the month's state lives after the `Separator`.
 *
 * 🛑 Post and Reverse are deliberately NOT here. They are the decision, not
 * navigation, and a consequential button in a dense ghost strip reads as a
 * minor control. They sit in the body beside the entry they act on
 * (13-accounting-ui.md §5.1).
 */
export function LedgerToolbar({
  periodKey,
  options,
  summary,
  previousPeriodKey,
  nextPeriodKey,
  resolvedPeriodKey,
  onSelectPeriod,
  disabled = false,
}: LedgerToolbarProps) {
  const state = summary?.state ?? 'open'

  return (
    <div className='flex flex-wrap items-center gap-1 border-b p-1'>
      <Button
        variant='ghost'
        size='sm'
        disabled={disabled || periodKey === resolvedPeriodKey}
        onClick={() => onSelectPeriod(resolvedPeriodKey)}>
        Current
      </Button>

      <Tooltip content='Previous month'>
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label='Previous month'
          disabled={disabled || !previousPeriodKey}
          onClick={() => previousPeriodKey && onSelectPeriod(previousPeriodKey)}>
          <ChevronLeft />
        </Button>
      </Tooltip>

      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <Button variant='ghost' size='sm' className='min-w-[9.5rem] justify-between'>
            {formatPeriodLabel(periodKey)}
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='start' className='min-w-[13rem]'>
          {options.map((option) => (
            <DropdownMenuItem
              key={option.periodKey}
              onSelect={() => onSelectPeriod(option.periodKey)}
              className='justify-between gap-6'>
              <span className={cn(option.periodKey === periodKey && 'font-medium')}>
                {option.label}
              </span>
              <span className='flex items-center gap-1.5 text-xs text-muted-foreground'>
                {option.summary.state === 'locked' && <Lock className='size-3' />}
                {STATE_LABEL[option.summary.state]}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Tooltip content='Next month'>
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label='Next month'
          disabled={disabled || !nextPeriodKey}
          onClick={() => nextPeriodKey && onSelectPeriod(nextPeriodKey)}>
          <ChevronRight />
        </Button>
      </Tooltip>

      <Separator orientation='vertical' className='h-6' />

      {!disabled && (
        <div className='flex items-center gap-2 px-1 text-xs text-muted-foreground'>
          <span className={cn('size-1.5 rounded-full', STATE_DOT[state])} aria-hidden />
          <span className='text-foreground'>{STATE_LABEL[state]}</span>
          {summary?.docNumber && (
            <>
              <span aria-hidden>·</span>
              <span className='font-mono'>{summary.docNumber}</span>
            </>
          )}
          {summary && summary.revision > 0 && (
            <Badge variant='outline' size='sm'>
              Revision {summary.revision}
            </Badge>
          )}
        </div>
      )}

      <div className='flex-1' />
    </div>
  )
}
