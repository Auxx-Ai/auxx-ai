// apps/web/src/components/money/ui/batch-posting/batch-posting-dialog.tsx
'use client'

// The one bulk-posting dialog, with the source in a descriptor
// (plans/accounting/tasks/25-batch-posting-and-credit-memos.md §5.1, §5.5, §6).
//
// Preview a batch, then run it: a frequency, a range shaped by it, a read-only
// plan, the excluded rows with the number that proves each, a footer that moves
// as the frequency changes, and a result page that reports per group.
//
// ## Frequency first, and the range control follows it (§6.2)
//
// The dialog used to ask From, To, Group into. That is backwards: the grouping
// decides what a sensible range even looks like, so a month-grouped run gets a
// multi-month picker fed by the ledger's own periods (§6.3) and a day-grouped
// run gets the arbitrary `DateRangePicker`. Both ends are INCLUSIVE on this
// screen; `range.ts` makes the window half-open on the wire (§6.1).
//
// ## Why the frequency control stays even though the answer is often "day"
//
// The footer moving from 613 postings to 62 to 2 as the control changes IS the
// feature (49 §2.3 item 2, 44 §7.2). It makes the tradeoff visible instead of
// baked into a constant nobody can see. Per day is what a live month wants; per
// month is what a year of history wants, and neither is a code change.
//
// ## The plan is never sent to the server
//
// The run takes the same range and frequency the preview took and re-plans
// server-side. A client-supplied plan would let a stale preview name amounts and
// periods that no read ever produced, on an append-only ledger.
//
// ## 🛑 `source.usePreview` and `source.useRunner` are HOOKS
//
// They are called here unconditionally, once per render, in a fixed order. That
// is legal only because a descriptor is a module constant: passing a `source`
// that changes identity between renders, or building one inside a component,
// breaks the rules of hooks. Every registration is a `const` at module scope.

import { FieldType } from '@auxx/database/enums'
import { Button } from '@auxx/ui/components/button'
import { Dialog, DialogContent } from '@auxx/ui/components/dialog'
import { DialogNav, DialogNavPage, DialogNavPages } from '@auxx/ui/components/dialog-nav'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import type { MonthRangeValue } from '@auxx/ui/components/month-range-picker'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { TriangleAlert } from 'lucide-react'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { formatMinor } from '~/components/accounting/ui/ledger/format'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import { BatchPostingExclusions } from './batch-posting-exclusions'
import { BatchPostingResult } from './batch-posting-result'
import { BatchRangeControl, type InclusiveDayRange } from './batch-range-control'
import {
  dayRangeToWire,
  lastMonthKey,
  monthRangeToWire,
  startOfLastMonthDayKey,
  todayDayKey,
} from './range'
import type {
  BatchPostingGrouping,
  BatchPostingPlanShape,
  BatchPostingSource,
  BatchPostingSummaryShape,
} from './types'
import { usePostableMonths } from './use-postable-months'

/**
 * How much one posting summarises.
 *
 * Entity-neutral, so it lives in the frame; WHICH of them a source offers is on
 * the descriptor (§5.1). A total `Record` over the closed union, so a third
 * grouping stops this file compiling rather than rendering an empty option.
 */
const GROUPING_LABELS: Record<BatchPostingGrouping, string> = {
  day: 'One entry per day',
  month: 'One entry per month',
}

interface BatchPostingDialogProps<
  Plan extends BatchPostingPlanShape<Exclusion>,
  Summary extends BatchPostingSummaryShape,
  Exclusion,
> {
  /** 🛑 A module constant. See the file header. */
  source: BatchPostingSource<Plan, Summary, Exclusion>
  open: boolean
  onOpenChange: (open: boolean) => void
  onCompleted?: () => void
}

export function BatchPostingDialog<
  Plan extends BatchPostingPlanShape<Exclusion>,
  Summary extends BatchPostingSummaryShape,
  Exclusion,
>({ source, open, onOpenChange, onCompleted }: BatchPostingDialogProps<Plan, Summary, Exclusion>) {
  const [page, setPage] = useState<'plan' | 'result'>('plan')
  const [grouping, setGrouping] = useState<BatchPostingGrouping>(source.defaultGrouping)
  const [monthRange, setMonthRange] = useState<MonthRangeValue | null>(null)
  const [dayRange, setDayRange] = useState<InclusiveDayRange>(() => ({
    from: startOfLastMonthDayKey(),
    to: todayDayKey(),
  }))
  const [result, setResult] = useState<Summary | null>(null)

  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'

  const { months, selectable, isLoading: monthsLoading } = usePostableMonths()

  // A fresh dialog on every open. A range somebody abandoned yesterday would
  // silently post the wrong window onto a ledger that only reversing undoes.
  useEffect(() => {
    if (!open) return
    setPage('plan')
    setGrouping(source.defaultGrouping)
    setMonthRange(null)
    setDayRange({ from: startOfLastMonthDayKey(), to: todayDayKey() })
    setResult(null)
  }, [open, source.defaultGrouping])

  // Derived rather than seeded: the period list is a query, so the month a
  // `useState` initialiser could name would be a month nothing had loaded yet.
  const effectiveMonthRange = useMemo(() => {
    if (monthRange) return monthRange
    if (selectable.length === 0) return null
    const preferred = lastMonthKey()
    const key = selectable.includes(preferred)
      ? preferred
      : (selectable[selectable.length - 1] as string)
    return { from: key, to: key }
  }, [monthRange, selectable])

  const range = useMemo(() => {
    if (grouping === 'month') {
      if (!effectiveMonthRange) return null
      return monthRangeToWire(effectiveMonthRange.from, effectiveMonthRange.to)
    }
    return dayRangeToWire(dayRange.from, dayRange.to)
  }, [grouping, effectiveMonthRange, dayRange])

  const preview = source.usePreview({ range, grouping, enabled: open && page === 'plan' })
  const runner = source.useRunner()

  const plan = preview.plan
  const refusal = preview.refusal

  // Gateway names keyed by clearing account id, so a member routed through a
  // `payment_gateway` record reads as "Affirm" rather than "Gateway clearing"
  // (brief 13 §5.3). SHARED across sources (§6.5): both render a routed clearing
  // account. Two rails may share one clearing account; the last one listed wins
  // the label, which is a display choice and never a posting one.
  const gatewaysQuery = api.paymentGateway.list.useQuery(undefined, { enabled: open })
  const gatewayNames = useMemo(() => {
    const names: Record<string, string> = {}
    for (const gateway of gatewaysQuery.data ?? []) {
      names[gateway.clearingGlAccountId] = gateway.name
    }
    return names
  }, [gatewaysQuery.data])

  const groupingOptions = useMemo(
    () => source.groupings.map((value) => ({ value, label: GROUPING_LABELS[value] })),
    [source.groupings]
  )

  const handleRun = async () => {
    if (!plan || !range || plan.footer.postings === 0) return
    try {
      const summary = await runner.run({ range, grouping })
      setResult(summary)
      setPage('result')
      onCompleted?.()
    } catch (error) {
      toastError({
        title: source.errorTitle,
        description: error instanceof Error ? error.message : 'Something went wrong',
      })
    }
  }

  const stale = preview.isFetching
  const canRun =
    !!plan && !!range && plan.footer.postings > 0 && !refusal && !stale && !runner.isPending

  return (
    <Dialog open={open} onOpenChange={(next) => !runner.isPending && onOpenChange(next)}>
      <DialogContent size='content' position='tc' innerClassName='p-0'>
        <DialogNav
          title={source.title}
          description={source.description}
          crumbs={[
            {
              label: source.title,
              onClick: page === 'result' ? () => setPage('plan') : undefined,
            },
            ...(page === 'result' ? [{ label: 'Result' }] : []),
          ]}
        />

        <DialogNavPages value={page}>
          <DialogNavPage value='plan' size='3xl'>
            <div className='flex flex-col'>
              <ScrollArea viewportClassName='max-h-[70vh]' allowScrollChaining>
                <div className='flex flex-col gap-4 p-4'>
                  <FieldPanel
                    className='p-0'
                    orientation='responsive'
                    breakpoint='md'
                    resizeId='batch-posting'
                    defaultLabelWidth={180}>
                    {/* 🛑 Frequency FIRST (§6.2). The range control below is
                        chosen by this answer. */}
                    <FieldPanelRow
                      title='Frequency'
                      type={BaseType.ENUM}
                      showIcon
                      isRequired
                      description={source.groupingDescription}>
                      <FieldInputAdapter
                        fieldType={FieldType.SINGLE_SELECT}
                        fieldOptions={{ options: groupingOptions }}
                        value={grouping}
                        onChange={(value) =>
                          setGrouping(
                            ((value as string[])[0] as BatchPostingGrouping) ??
                              source.defaultGrouping
                          )
                        }
                        disabled={runner.isPending}
                      />
                    </FieldPanelRow>

                    <FieldPanelRow
                      title={grouping === 'month' ? 'Months' : 'Dates'}
                      type={BaseType.DATE}
                      showIcon
                      isRequired
                      description={source.rangeDescription}>
                      <BatchRangeControl
                        grouping={grouping}
                        monthRange={effectiveMonthRange}
                        onMonthRange={setMonthRange}
                        dayRange={dayRange}
                        onDayRange={setDayRange}
                        months={months}
                        monthsLoading={monthsLoading}
                        disabled={runner.isPending}
                      />
                    </FieldPanelRow>
                  </FieldPanel>

                  {/* A refusal is a card, not a toast (ground rule 9): the book
                      time zone being unset is a settings task with an address,
                      and a sentence that disappears cannot carry one. */}
                  {refusal && <Note tone='warning'>{refusal}</Note>}

                  {preview.errorMessage && !refusal && (
                    <Note tone='warning'>{preview.errorMessage}</Note>
                  )}

                  {/* `range` null means there is nothing to preview yet (the
                      periods are still loading, or there are none). The control
                      above already says so; a skeleton here would imply a
                      request that was never made. */}
                  {range && preview.isPending && !plan && <PlanSkeleton />}

                  {plan && (
                    <div
                      className={
                        stale
                          ? 'flex flex-col gap-4 opacity-60 transition-opacity'
                          : 'flex flex-col gap-4 transition-opacity'
                      }>
                      {plan.groups.length === 0 ? (
                        <p className='rounded-md border border-dashed px-3 py-6 text-center text-muted-foreground text-sm'>
                          {source.emptyPlanNote}
                        </p>
                      ) : (
                        source.renderPlanTable({ plan, currencyCode, gatewayNames })
                      )}

                      <BatchPostingExclusions
                        rows={plan.exclusions.map(source.exclusionRow)}
                        columns={source.exclusionColumns}
                        copy={source.exclusionCopy}
                      />

                      {plan.footer.postings > 0 && (
                        <Note>
                          Posting writes {plan.footer.postings}{' '}
                          {plan.footer.postings === 1 ? 'entry' : 'entries'} onto an append-only
                          ledger. They can only be corrected by reversing them, never by editing
                          them.
                        </Note>
                      )}
                    </div>
                  )}
                </div>
              </ScrollArea>

              {/* 🛑 The footer is the feature, not decoration. Watching it go
                  from 613 postings to 62 to 2 as the frequency changes is how
                  the tradeoff becomes visible instead of a constant nobody
                  sees. */}
              <div className='flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5'>
                <p className='text-muted-foreground text-sm tabular-nums'>
                  {plan ? (
                    <>
                      <strong className='font-medium text-foreground'>
                        {plan.footer.postings}
                      </strong>{' '}
                      {plan.footer.postings === 1 ? 'posting' : 'postings'}
                      {source.footerCounts(plan).map((count) => (
                        <Fragment key={count.plural}>
                          {' · '}
                          <strong className='font-medium text-foreground'>{count.value}</strong>{' '}
                          {count.value === 1 ? count.singular : count.plural}
                        </Fragment>
                      ))}
                      {' · '}
                      <strong className='font-medium text-foreground'>
                        {formatMinor(plan.footer.totalMinor, currencyCode)}
                      </strong>
                    </>
                  ) : (
                    'No preview yet'
                  )}
                </p>

                <div className='flex items-center gap-2'>
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    onClick={() => onOpenChange(false)}
                    disabled={runner.isPending}>
                    Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
                  </Button>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={handleRun}
                    loading={runner.isPending}
                    loadingText={source.runningLabel}
                    disabled={!canRun}
                    data-dialog-submit>
                    Post {plan?.footer.postings ?? 0}{' '}
                    {plan?.footer.postings === 1 ? 'entry' : 'entries'}{' '}
                    <KbdSubmit variant='outline' size='sm' />
                  </Button>
                </div>
              </div>
            </div>
          </DialogNavPage>

          <DialogNavPage value='result' size='3xl'>
            <BatchPostingResult
              result={result}
              membersPosted={
                result ? source.membersPosted(result) : { value: 0, singular: '', plural: '' }
              }
              postedRows={result ? source.postedRows(result) : []}
              excludedNoun={source.excludedNoun}
              onBack={() => setPage('plan')}
              onClose={() => onOpenChange(false)}
            />
          </DialogNavPage>
        </DialogNavPages>
      </DialogContent>
    </Dialog>
  )
}

// ─── Small pieces ─────────────────────────────────────────────────────────

function Note({ children, tone }: { children: React.ReactNode; tone?: 'warning' }) {
  return (
    <p
      className={
        tone === 'warning'
          ? 'flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50/60 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950/30'
          : 'rounded-md border bg-muted/40 px-3 py-2 text-muted-foreground text-sm'
      }>
      {tone === 'warning' && (
        <TriangleAlert className='mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-500' />
      )}
      <span>{children}</span>
    </p>
  )
}

function PlanSkeleton() {
  return (
    <div className='flex flex-col gap-2'>
      <Skeleton className='h-9 w-full' />
      <Skeleton className='h-9 w-full' />
      <Skeleton className='h-9 w-full' />
    </div>
  )
}
