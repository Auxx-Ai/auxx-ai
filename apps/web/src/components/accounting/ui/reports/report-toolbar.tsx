// apps/web/src/components/accounting/ui/reports/report-toolbar.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { DateRangePicker } from '@auxx/ui/components/date-range-picker'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Separator } from '@auxx/ui/components/separator'
import { cn } from '@auxx/ui/lib/utils'
import { dayKeyOfLocalDate, localDateOfDayKey } from '@auxx/utils/calendar-day'
import { CalendarIcon, ChevronDown, FileDown, FileSpreadsheet, X } from 'lucide-react'
import type { LedgerPeriodOption } from '~/components/accounting/hooks/use-ledger-period'
import { formatPeriodLabel } from '~/components/accounting/ui/ledger/format'
import { ProviderSyncStatus } from './provider-sync-status'
import type { CompareOption } from './report-helpers'
import type { ReportRangePreset } from './report-range-presets'

const COMPARE_LABEL: Record<CompareOption, string> = {
  none: 'None',
  prior_period: 'Prior period',
  prior_year: 'Prior year',
}

const COMPARE_OPTIONS: CompareOption[] = ['none', 'prior_period', 'prior_year']

export interface ReportToolbarProps {
  /**
   * `asOf` is one period dropdown (trial balance, balance sheet, aging).
   * `range` is a day-granular `DateRangePicker` (the P&L, the general ledger).
   */
  mode: 'asOf' | 'range'
  periodOptions: LedgerPeriodOption[]
  /** `asOf` mode only. */
  periodKey?: string
  onSelectPeriod?: (periodKey: string) => void
  /** `range` mode only. Both `YYYY-MM-DD`, both ends inclusive. */
  from?: string
  to?: string
  onSelectRange?: (range: { from: string; to: string }) => void
  /** The preset sidebar for `range` mode - see `report-range-presets.ts`. */
  presets?: readonly ReportRangePreset[]
  /** The earliest day the books cover. Days before it are refused on the calendar. */
  cutoff?: string | null
  /**
   * An active narrowing, with the door back out. Rendered as a removable chip
   * beside the range: a statement narrowed to one account with nothing on
   * screen saying so reads as a ledger that has lost most of its rows.
   */
  filter?: { label: string; onClear: () => void }
  /** Omit entirely to hide the compare control - the trial balance has none. */
  compare?: CompareOption
  onSelectCompare?: (compare: CompareOption) => void
  onDownloadPdf: () => void
  onDownloadCsv: () => void
  /** The last date the statement covers, for the "Synced through" status. */
  through?: string
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
  from,
  to,
  onSelectRange,
  presets,
  cutoff,
  filter,
  compare,
  onSelectCompare,
  onDownloadPdf,
  onDownloadCsv,
  through,
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
        <DateRangePicker
          value={
            from && to ? { from: localDateOfDayKey(from), to: localDateOfDayKey(to) } : undefined
          }
          onChange={(next) =>
            onSelectRange?.({
              from: dayKeyOfLocalDate(next.from),
              to: dayKeyOfLocalDate(next.to),
            })
          }
          placeholder='Select a range...'
          presets={presets?.map((preset) => ({
            label: preset.label,
            range: () => ({
              from: localDateOfDayKey(preset.from),
              to: localDateOfDayKey(preset.to),
            }),
          }))}
          // A day before the books open has no statement to show, so it is
          // refused on the calendar rather than answered with zeroes.
          disabled={cutoff ? (day: Date) => dayKeyOfLocalDate(day) < cutoff : undefined}
          // `DateRangePicker`'s own `disabled` is a per-DAY predicate on the
          // calendar, not a switch for the control, so the whole-control
          // disable has to come through the trigger.
          trigger={({ label }) => (
            <Button variant='ghost' size='sm' className='gap-1' disabled={disabled}>
              <CalendarIcon />
              {label}
            </Button>
          )}
        />
      )}

      {filter && (
        <>
          <Separator orientation='vertical' className='h-6' />
          <Badge variant='secondary' className='gap-1 py-1'>
            {filter.label}
            <button
              type='button'
              aria-label={`Clear the ${filter.label} filter`}
              onClick={filter.onClear}
              className='rounded-sm opacity-60 hover:opacity-100'>
              <X className='size-3' />
            </button>
          </Badge>
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

      {through && <ProviderSyncStatus through={through} />}

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
