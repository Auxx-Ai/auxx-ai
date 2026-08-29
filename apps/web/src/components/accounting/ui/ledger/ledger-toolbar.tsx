// apps/web/src/components/accounting/ui/ledger/ledger-toolbar.tsx

'use client'

import type { ClosePeriod } from '@auxx/lib/postings/client'
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
import { ChevronDown, ChevronLeft, ChevronRight, Lock, Plug, PlugZap } from 'lucide-react'
import { useAccountingProviderStatus } from '~/components/accounting/hooks/use-accounting-provider-status'
import type { LedgerPeriodOption } from '~/components/accounting/hooks/use-ledger-period'
import { Tooltip } from '~/components/global/tooltip'
import { formatPeriodLabel } from './format'

type PeriodState = ClosePeriod['state']

const STATE_LABEL: Record<PeriodState, string> = {
  open: 'Open',
  posted: 'Posted',
  locked: 'Locked',
}

/** The pill's dot. Locked reads as "shut", not as a stronger Posted. */
const STATE_DOT: Record<PeriodState, string> = {
  open: 'bg-amber-500',
  posted: 'bg-green-500',
  locked: 'bg-primary-400',
}

interface LedgerToolbarProps {
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
 * The ledger's first row inside `MainPageContent`, on `BoardToolbar`'s scale
 * (`gap-1 p-1`, ghost `h-7` buttons, `Separator` dividers, tooltips).
 *
 * ```
 * [ Current ] [ ‹ ] [ March 2027 ▾ ] [ › ]  │  ● Posted · AUXX-MEI-2027-03  │  QuickBooks Online
 * ```
 *
 * ⚠️ Ordered by `BoardToolbar`'s own rule: the period nav is the STABLE PREFIX
 * and never moves, so switching months causes no layout shift; everything that
 * varies with the month's state lives after the `Separator`.
 *
 * 🛑 Post and Reverse are deliberately NOT here. They are the decision, not
 * navigation, and a consequential button in a dense ghost strip reads as a
 * minor control. They sit in the body beside the entry they act on
 * (13-accounting-ui.md section 5.1).
 */
export function LedgerToolbar({
  periodKey,
  options,
  period,
  previousPeriodKey,
  nextPeriodKey,
  resolvedPeriodKey,
  onSelectPeriod,
  disabled = false,
}: LedgerToolbarProps) {
  const state = period?.state ?? 'open'

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
        <DropdownMenuTrigger asChild disabled={disabled || options.length === 0}>
          <Button variant='ghost' size='sm' className='min-w-[9.5rem] justify-between'>
            {periodKey ? formatPeriodLabel(periodKey) : 'No months yet'}
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
                {option.period.state === 'locked' && <Lock className='size-3' />}
                {STATE_LABEL[option.period.state]}
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
          {period?.docNumber && (
            <>
              <span aria-hidden>·</span>
              <span className='font-mono'>{period.docNumber}</span>
            </>
          )}
          {period && period.revision > 0 && (
            <Badge variant='outline' size='sm'>
              Revision {period.revision}
            </Badge>
          )}
        </div>
      )}

      <Separator orientation='vertical' className='h-6' />
      <ProviderPill />

      <div className='flex-1' />
    </div>
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
function ProviderPill() {
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
