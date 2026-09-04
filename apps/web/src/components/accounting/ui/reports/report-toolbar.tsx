// apps/web/src/components/accounting/ui/reports/report-toolbar.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Separator } from '@auxx/ui/components/separator'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown, FileDown, FileSpreadsheet } from 'lucide-react'
import type { LedgerPeriodOption } from '~/components/accounting/hooks/use-ledger-period'
import { formatPeriodLabel } from '~/components/accounting/ui/ledger/format'
import type { CompareOption } from './report-helpers'

const COMPARE_LABEL: Record<CompareOption, string> = {
  none: 'None',
  prior_period: 'Prior period',
  prior_year: 'Prior year',
}

const COMPARE_OPTIONS: CompareOption[] = ['none', 'prior_period', 'prior_year']

export interface ReportToolbarProps {
  /** `asOf` is one period dropdown (trial balance, balance sheet). `range` is two (the P&L). */
  mode: 'asOf' | 'range'
  periodOptions: LedgerPeriodOption[]
  /** `asOf` mode only. */
  periodKey?: string
  onSelectPeriod?: (periodKey: string) => void
  /** `range` mode only. */
  fromPeriodKey?: string
  toPeriodKey?: string
  onSelectFrom?: (periodKey: string) => void
  onSelectTo?: (periodKey: string) => void
  /** Omit entirely to hide the compare control - the trial balance has none. */
  compare?: CompareOption
  onSelectCompare?: (compare: CompareOption) => void
  onDownloadPdf: () => void
  onDownloadCsv: () => void
  isDownloadingPdf?: boolean
  disabled?: boolean
}

/**
 * The reports toolbar (`plans/accounting/ui-plan.md` §2.4, §4.5), on
 * `ledger-toolbar.tsx`'s own scale: `gap-1 p-1`, ghost `h-7` buttons,
 * `Separator` dividers. The period control(s) come first, an optional
 * compare dropdown after a separator, then PDF/CSV on the right after a
 * trailing separator - matching the ASCII layout `ui-plan.md` §2.4 draws.
 */
export function ReportToolbar({
  mode,
  periodOptions,
  periodKey,
  onSelectPeriod,
  fromPeriodKey,
  toPeriodKey,
  onSelectFrom,
  onSelectTo,
  compare,
  onSelectCompare,
  onDownloadPdf,
  onDownloadCsv,
  isDownloadingPdf = false,
  disabled = false,
}: ReportToolbarProps) {
  return (
    <div className='flex flex-wrap items-center gap-1 border-b p-1'>
      {mode === 'asOf' && (
        <PeriodDropdown
          label='As of'
          periodOptions={periodOptions}
          selected={periodKey}
          onSelect={onSelectPeriod}
          disabled={disabled}
        />
      )}

      {mode === 'range' && (
        <>
          <PeriodDropdown
            label='From'
            periodOptions={periodOptions}
            selected={fromPeriodKey}
            onSelect={onSelectFrom}
            disabled={disabled}
          />
          <PeriodDropdown
            label='To'
            periodOptions={periodOptions}
            selected={toPeriodKey}
            onSelect={onSelectTo}
            disabled={disabled}
          />
        </>
      )}

      {compare !== undefined && (
        <>
          <Separator orientation='vertical' className='h-6' />
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={disabled}>
              <Button variant='ghost' size='sm' className='gap-1'>
                Compare: {COMPARE_LABEL[compare]}
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='start'>
              {COMPARE_OPTIONS.map((option) => (
                <DropdownMenuItem key={option} onSelect={() => onSelectCompare?.(option)}>
                  <span className={cn(option === compare && 'font-medium')}>
                    {COMPARE_LABEL[option]}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}

      <div className='flex-1' />

      <Separator orientation='vertical' className='h-6' />
      <Button variant='ghost' size='sm' loading={isDownloadingPdf} onClick={onDownloadPdf}>
        <FileDown />
        PDF
      </Button>
      <Button variant='ghost' size='sm' onClick={onDownloadCsv}>
        <FileSpreadsheet />
        CSV
      </Button>
    </div>
  )
}

function PeriodDropdown({
  label,
  periodOptions,
  selected,
  onSelect,
  disabled,
}: {
  label: string
  periodOptions: LedgerPeriodOption[]
  selected?: string
  onSelect?: (periodKey: string) => void
  disabled?: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled || periodOptions.length === 0}>
        <Button variant='ghost' size='sm' className='min-w-[10rem] justify-between gap-1'>
          <span className='text-muted-foreground'>{label}</span>
          {selected ? formatPeriodLabel(selected) : 'Select...'}
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='min-w-[13rem]'>
        {periodOptions.map((option) => (
          <DropdownMenuItem key={option.periodKey} onSelect={() => onSelect?.(option.periodKey)}>
            <span className={cn(option.periodKey === selected && 'font-medium')}>
              {option.label}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
