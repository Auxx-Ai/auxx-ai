// apps/web/src/components/accounting/ui/setup-wizard/connect-and-go-books-page.tsx
'use client'

import type { ConnectAndGoPrepareReport } from '@auxx/lib/accounting/connect-and-go/client'
import { isMonthKey } from '@auxx/lib/accounting/ledger/client'
import { FISCAL_YEAR_START_MONTH_OPTIONS } from '@auxx/lib/accounting/reports/client'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Section } from '@auxx/ui/components/section'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import {
  formatInTimezone,
  monthKeyOfDay,
  shiftMonthKey,
  startOfDayInstant,
  startOfMonthDay,
  startOfMonthInstant,
  todayInZone,
} from '@auxx/utils'
import { CalendarClock, TriangleAlert } from 'lucide-react'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { TimeZonePicker } from '~/components/pickers/timezone-picker'
import { BaseType } from '~/components/workflow/types'
import type { ConnectAndGoFlow } from './use-connect-and-go'

type CutoverSource = ConnectAndGoPrepareReport['proposedCutover']['source']

/** Cutover, timezone, fiscal year and export mode: how the books are framed and exported. */
export function ConnectAndGoBooksPage({
  flow,
  providerLabel,
}: {
  flow: ConnectAndGoFlow
  providerLabel: string
}) {
  const { report, draft, patchDraft } = flow
  if (!report) return null
  const locked = report.finalized || flow.finishing

  return (
    <div className='flex flex-col'>
      <Section
        title='Books'
        className='[&_[data-slot=section]]:border-b-0'
        icon={<CalendarClock className='size-4 text-muted-foreground' />}
        collapsible={false}>
        <div className='flex flex-col gap-3'>
          <FieldPanel
            orientation='responsive'
            breakpoint='md'
            resizeId='accounting-connect-and-go'
            defaultLabelWidth={170}
            className='p-0'>
            <FieldPanelRow
              title='Last month in old books'
              type={BaseType.STRING}
              showIcon
              isRequired
              description={cutoverNote(report.proposedCutover.source, providerLabel)}>
              <div className='flex items-center gap-2'>
                <div className='min-w-0 flex-1'>
                  <Select
                    value={draft.cutoffPeriod}
                    disabled={locked}
                    onValueChange={(value) => patchDraft({ cutoffPeriod: value })}>
                    <SelectTrigger variant='transparent' className='w-full ps-0 pe-1'>
                      <SelectValue placeholder='Choose a month' />
                    </SelectTrigger>
                    <SelectContent>
                      {cutoverMonthOptions(draft.cutoffPeriod).map((month) => (
                        <SelectItem key={month} value={month}>
                          {formatInTimezone(startOfMonthInstant(month, 'UTC'), 'UTC', 'MMMM yyyy')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {takeoverNote(draft.cutoffPeriod) && (
                  <span className='shrink-0 whitespace-nowrap pe-2 text-muted-foreground text-xs'>
                    {takeoverNote(draft.cutoffPeriod)}
                  </span>
                )}
              </div>
            </FieldPanelRow>
            <FieldPanelRow
              title='Book timezone'
              type={BaseType.STRING}
              showIcon
              isRequired
              description='The IANA timezone your books are kept in. There is no UTC fallback.'>
              <TimeZonePicker
                selected={draft.bookTimeZone || undefined}
                disabled={locked}
                onChange={(zone) => patchDraft({ bookTimeZone: zone })}
                triggerProps={{ variant: 'transparent', className: 'w-full ps-0 pe-1' }}
              />
            </FieldPanelRow>
            <FieldPanelRow
              title='Fiscal year starts'
              type={BaseType.ENUM}
              showIcon
              description={
                report.company?.fiscalYearStartMonth
                  ? `As set in ${providerLabel}.`
                  : 'The month your fiscal year turns over.'
              }>
              <Select
                value={String(draft.fiscalYearStartMonth)}
                disabled={locked}
                onValueChange={(value) => patchDraft({ fiscalYearStartMonth: Number(value) })}>
                <SelectTrigger variant='transparent' className='w-full ps-0 pe-1'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FISCAL_YEAR_START_MONTH_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldPanelRow>
            <FieldPanelRow
              title='Export mode'
              type={BaseType.ENUM}
              showIcon
              description={`Transaction sends ${providerLabel} one object per posting; Summary sends one per period, store and payment rail.`}>
              <Select
                value={draft.exportMode}
                disabled={flow.finishing}
                onValueChange={(value) =>
                  patchDraft({ exportMode: value === 'summary' ? 'summary' : 'transaction' })
                }>
                <SelectTrigger variant='transparent' className='w-full ps-0 pe-1'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='transaction'>Transaction</SelectItem>
                  <SelectItem value='summary'>Summary</SelectItem>
                </SelectContent>
              </Select>
            </FieldPanelRow>
          </FieldPanel>
          {flow.booksInvalid && (
            <p className='text-muted-foreground text-xs'>{flow.booksInvalid}</p>
          )}
          <Alert variant='warning'>
            <TriangleAlert />
            <AlertDescription>
              Everything after the cutover is posted and exported by Auxx.ai. If another app already
              writes your Shopify sales into {providerLabel} (its native app, Synder, A2X), stop it
              at the cutover, or those sales are counted twice. Everything on or before the cutover
              comes in as the opening entry and is never posted order by order.
            </AlertDescription>
          </Alert>
        </div>
      </Section>
    </div>
  )
}

/** This month back three years, plus the draft's own month when it is older. */
function cutoverMonthOptions(selected: string): string[] {
  const thisMonth = monthKeyOfDay(todayInZone('UTC'))
  const months = Array.from({ length: 37 }, (_, index) => shiftMonthKey(thisMonth, -index))
  return isMonthKey(selected) && !months.includes(selected) ? [...months, selected] : months
}

/** The first day Auxx.ai owns: the day after the last month of the old books. */
function takeoverNote(cutoffPeriod: string): string | null {
  if (!isMonthKey(cutoffPeriod)) return null
  const firstDay = startOfMonthDay(shiftMonthKey(cutoffPeriod, 1))
  return `Auxx.ai starts ${formatInTimezone(startOfDayInstant(firstDay, 'UTC'), 'UTC', 'MM/dd/yy')}`
}

function cutoverNote(source: CutoverSource, providerLabel: string): string {
  if (source === 'current') return 'Already set.'
  if (source === 'lock_date')
    return `Suggested: the month your books are closed through in ${providerLabel}.`
  return 'Suggested: the last full month.'
}
