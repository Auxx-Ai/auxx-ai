// apps/web/src/components/accounting/ui/ledger/ledger-toolbar.tsx

'use client'

import type { ClosePeriod } from '@auxx/lib/accounting/ledger/client'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Separator } from '@auxx/ui/components/separator'
import { cn } from '@auxx/ui/lib/utils'
import { CalendarCheck2, ChevronDown, ChevronLeft, ChevronRight, Plug, PlugZap } from 'lucide-react'
import { useAccountingProviderStatus } from '~/components/accounting/hooks/use-accounting-provider-status'
import type { LedgerPeriodOption } from '~/components/accounting/hooks/use-ledger-period'
import { Tooltip } from '~/components/global/tooltip'
import { formatPeriodLabel } from './format'

type PeriodState = ClosePeriod['state']

const STATE_LABEL: Record<PeriodState, string> = {
  open: 'Open',
  locked: 'Reviewed',
}

/** The pill's dot. */
const STATE_DOT: Record<PeriodState, string> = {
  open: 'bg-amber-500',
  locked: 'bg-primary-400',
}

interface LedgerPeriodControlsProps {
  periodKey: string
  options: LedgerPeriodOption[]
  period?: ClosePeriod
  previousPeriodKey: string | null
  nextPeriodKey: string | null
  resolvedPeriodKey: string
  onSelectPeriod: (periodKey: string) => void
  /** Setup is not finalized: there is no month to navigate to yet. */
  disabled?: boolean
}

/**
 * CLOSEOUT's half of the module topbar, published through
 * `useRegisterModuleToolbar` (81-one-accounting-shell.md §4).
 *
 * ```
 * [ Current ] [ ‹ ] [ March 2027 ▾ ] [ › ]  │  ● Open
 * ```
 *
 * ⚠️ Ordered by `BoardToolbar`'s own rule: the period nav is the STABLE PREFIX
 * and never moves, so switching months causes no layout shift; everything that
 * varies with the month's state lives after the `Separator`.
 *
 * 🛑 Closeout ONLY. Every Outbox tab reads with no month bound, so a month and a
 * period state over that list are both false claims — which is the complaint
 * 81-one-accounting-shell.md was opened to settle.
 *
 * 🛑 Post and Reverse are deliberately NOT here. They are the decision, not
 * navigation, and a consequential button in a dense ghost strip reads as a
 * minor control. They sit in the body beside the entry they act on
 * (13-accounting-ui.md section 5.1).
 */
export function LedgerPeriodControls({
  periodKey,
  options,
  period,
  previousPeriodKey,
  nextPeriodKey,
  resolvedPeriodKey,
  onSelectPeriod,
  disabled = false,
}: LedgerPeriodControlsProps) {
  const state = period?.state ?? 'open'

  return (
    <>
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

      {/* 🛑 The month lives HERE and nowhere else on this route. The Outbox's
          Build control has a month dropdown of its own because building freezes
          one month's posted entries; that is a different question. */}
      <MonthDropdown
        periodKey={periodKey}
        options={options}
        disabled={disabled}
        onSelectPeriod={onSelectPeriod}
      />

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
        </div>
      )}
    </>
  )
}

interface MonthDropdownProps {
  periodKey: string
  options: LedgerPeriodOption[]
  onSelectPeriod: (periodKey: string) => void
  disabled?: boolean
  /** Rendered instead of the month when nothing has resolved. */
  emptyLabel?: string
  className?: string
}

/** The month list, shared by Closeout's period nav and the Outbox's Build control. */
export function MonthDropdown({
  periodKey,
  options,
  onSelectPeriod,
  disabled = false,
  emptyLabel = 'No months yet',
  className,
}: MonthDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled || options.length === 0}>
        <Button
          variant='ghost'
          size='sm'
          className={cn('min-w-[9.5rem] justify-between', className)}>
          {periodKey ? formatPeriodLabel(periodKey) : emptyLabel}
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
              {option.period.state === 'locked' && <CalendarCheck2 className='size-3' />}
              {STATE_LABEL[option.period.state]}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Whether an accounting system is connected, beside the controls that push to
 * one.
 *
 * 🛑 "None connected" is INFORMATION, not a warning, and this is the surface
 * most likely to turn it into one. Decision `P1` makes an unconnected org a
 * first-class outcome: the entry is still built, balanced and persisted, and the
 * post result is `not_connected` rather than a failure. So no destructive
 * colour, no alert icon, no "action required" - it reads exactly like the state
 * pill beside it, because it is exactly as ordinary
 * (14-drive-the-close.md section 4.3).
 *
 * ⚠️ Renders nothing while the two app queries are still resolving. They land
 * separately, so `connected` is false for a beat after `installed` turns true,
 * and an ungated pill flashes "none connected" on every cold load.
 */
export function ProviderPill() {
  const provider = useAccountingProviderStatus()
  if (provider.loading) return null

  const Icon = provider.connected ? PlugZap : Plug

  return (
    <Tooltip
      content={
        provider.connected
          ? 'Posted entries are mirrored into this accounting system and carry a link back to it.'
          : 'Entries are still built, balanced and recorded here. There is simply nowhere to push them.'
      }>
      <span className='flex items-center gap-1.5 px-1 text-xs text-muted-foreground'>
        <Icon className='size-3.5' aria-hidden />
        {provider.connected ? provider.providerLabel : 'No accounting system'}
      </span>
    </Tooltip>
  )
}
