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
import { format } from 'date-fns'
import { CalendarIcon, ChevronDown, FileDown, FileSpreadsheet, X } from 'lucide-react'
import { DateTimePicker } from '~/components/pickers/date-time-picker'
import { ProviderSyncStatus } from './provider-sync-status'
import type { CompareOption } from './report-helpers'
import type { ReportAsOfPreset, ReportRangePreset } from './report-range-presets'

const COMPARE_LABEL: Record<CompareOption, string> = {
  none: 'None',
  prior_period: 'Prior period',
  prior_year: 'Prior year',
}

const COMPARE_OPTIONS: CompareOption[] = ['none', 'prior_period', 'prior_year']

export interface ReportToolbarProps {
  /**
   * `asOf` is one day-granular `DateTimePicker` in `mode='date'` (trial
   * balance, balance sheet, aging). `range` is a `DateRangePicker` (the P&L,
   * the general ledger).
   *
   * 🛑 `asOf` used to be a dropdown over the org's close periods, which could
   * only ever name a month END - so the default as-of was the last day of the
   * current month, a date in the FUTURE. An as-of statement takes whichever day
   * it is asked for, exactly as QuickBooks does (`tasks/57` §7.3, §8.4).
   */
  mode: 'asOf' | 'range'
  /** `asOf` mode only. `YYYY-MM-DD`. */
  asOf?: string
  onSelectAsOf?: (day: string) => void
  /** The preset rail for `asOf` mode - see `report-range-presets.ts`. */
  asOfPresets?: readonly ReportAsOfPreset[]
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
  asOf,
  onSelectAsOf,
  asOfPresets,
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
  // `DateTimePicker` has no notion of an ACTIVE preset, so the label is worked
  // out here: naming the preset back ("As of Last month end") beats restating a
  // date the reader just picked by name. Same idea as `DateRangePicker`'s own
  // `activePresetLabel`, which it does internally.
  const asOfLabel = asOf
    ? (asOfPresets?.find((preset) => preset.date === asOf)?.label ??
      format(localDateOfDayKey(asOf), 'PPP'))
    : 'Select a date...'

  return (
    <div className='flex flex-wrap items-center gap-1 border-b p-1'>
      {mode === 'asOf' && (
        <DateTimePicker
          mode='date'
          // Commit on the first click: an as-of statement takes one day, so a
          // confirm step would be a second click to agree with yourself.
          noConfirm
          showPresets={!!asOfPresets?.length}
          value={asOf ? localDateOfDayKey(asOf) : undefined}
          onChange={(next) => next && onSelectAsOf?.(dayKeyOfLocalDate(next))}
          presets={asOfPresets?.map((preset) => ({
            value: preset.date,
            label: preset.label,
            getDate: () => localDateOfDayKey(preset.date),
          }))}
          // Same floor as `range` mode: a day before the books open has no
          // statement to show, so it is refused on the calendar rather than
          // answered with zeroes.
          disabledDates={cutoff ? (day: Date) => dayKeyOfLocalDate(day) < cutoff : undefined}
          disabled={disabled}>
          <Button variant='ghost' size='sm' className='gap-1' disabled={disabled}>
            <CalendarIcon />
            <span className='text-muted-foreground'>As of</span>
            {asOfLabel}
          </Button>
        </DateTimePicker>
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
