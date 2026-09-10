// apps/web/src/components/money/ui/fulfillment-posting/post-fulfillments-dialog.tsx
'use client'

// The bulk fulfillment posting (§2.3 of
// plans/money/tasks/49-bulk-fulfillment-posting.md), *"getting thousands of
// Shopify orders into the ledger without a click per order."*
//
// Copied structurally from `manufacturing/builds/backfill-dialog.tsx`, which is
// the house shape for *preview a batch, then run it*: a range, a grouping, a
// read-only plan, the excluded rows with the number that proves each, a footer
// that moves as the grouping changes, and a result page that reports per group.
//
// ## Why the grouping control stays even though the answer is always "day"
//
// The footer moving from 613 postings to 62 to 2 as the control changes IS the
// feature (§2.3 item 2, 44 §7.2). It makes the tradeoff visible instead of baked
// into a constant nobody can see. Per day is what a live month wants; per month
// is what a year of history wants, and neither is a code change.
//
// ## The range is on SHIP date, and it is half-open
//
// Revenue is recognised when goods ship (§2.3 item 1), so the window is on the
// shipment log's `shippedAt` and never on when the order was placed or keyed.
// `to` is EXCLUSIVE: the day itself is not included, which is what makes two
// consecutive runs cover a month without overlapping.
//
// ## The plan is never sent to the server
//
// `runFulfillmentPosting` takes the same range and grouping the preview took and
// re-plans server-side. A client-supplied plan would let a stale preview name
// amounts and periods that no read ever produced, on an append-only ledger.

import { FieldType } from '@auxx/database/enums'
import {
  FULFILLMENT_POSTING_GROUPINGS,
  type FulfillmentPostingGrouping,
  type FulfillmentPostingRunSummary,
} from '@auxx/lib/money/client'
import { Button } from '@auxx/ui/components/button'
import { Dialog, DialogContent } from '@auxx/ui/components/dialog'
import { DialogNav, DialogNavPage, DialogNavPages } from '@auxx/ui/components/dialog-nav'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { keepPreviousData } from '@tanstack/react-query'
import { TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { formatMinor } from '~/components/accounting/ui/ledger/format'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import { FulfillmentExclusions } from './fulfillment-exclusions'
import { FulfillmentPlanTable } from './fulfillment-plan-table'

/**
 * How much one posting summarises.
 *
 * A total `Record` over the closed union, so a fourth grouping stops this file
 * compiling rather than rendering an empty option.
 */
const GROUPING_LABELS: Record<FulfillmentPostingGrouping, string> = {
  day: 'One entry per day',
  week: 'One entry per week',
  month: 'One entry per month',
}

/** Driven off the exported vocabulary, so a fourth grouping arrives in the select on its own. */
const GROUPING_OPTIONS: Array<{ value: string; label: string }> = FULFILLMENT_POSTING_GROUPINGS.map(
  (value) => ({ value, label: GROUPING_LABELS[value] })
)

interface PostFulfillmentsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCompleted?: () => void
}

export function PostFulfillmentsDialog({
  open,
  onOpenChange,
  onCompleted,
}: PostFulfillmentsDialogProps) {
  const [page, setPage] = useState<'plan' | 'result'>('plan')
  const [from, setFrom] = useState<string>(() => startOfLastMonth())
  const [to, setTo] = useState<string>(() => today())
  const [grouping, setGrouping] = useState<FulfillmentPostingGrouping>('day')
  const [result, setResult] = useState<FulfillmentPostingRunSummary | null>(null)

  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'

  const utils = api.useUtils()

  // A fresh dialog on every open. A range somebody abandoned yesterday would
  // silently post the wrong window onto a ledger that only reversing undoes.
  useEffect(() => {
    if (!open) return
    setPage('plan')
    setFrom(startOfLastMonth())
    setTo(today())
    setGrouping('day')
    setResult(null)
  }, [open])

  // 🛑 The date input speaks instants (`2026-08-01T00:00:00.000Z`); the range is
  // a pair of CALENDAR DAYS the server cuts in the book time zone. Narrowed here
  // rather than in the input so the picker keeps round-tripping its own value.
  const fromKey = dayKey(from)
  const toKey = dayKey(to)

  const preview = api.money.previewFulfillmentPosting.useQuery(
    { from: fromKey, to: toKey, grouping },
    {
      enabled: open && page === 'plan',
      retry: false,
      refetchOnWindowFocus: false,
      // Without this every grouping change blanks the table, the excluded block
      // and the footer together, which reads as "the numbers just went away" on
      // the one screen whose whole point is watching those numbers move.
      placeholderData: keepPreviousData,
    }
  )

  const plan = preview.data?.plan ?? null

  // Gateway names keyed by clearing account id, so a shipment routed through a
  // `payment_gateway` record reads as "Affirm" rather than "Gateway clearing"
  // (brief 13 §5.3). Two rails may share one clearing account; the last one
  // listed wins the label, which is a display choice and never a posting one.
  const gatewaysQuery = api.paymentGateway.list.useQuery(undefined, { enabled: open })
  const gatewayNames = useMemo(() => {
    const names: Record<string, string> = {}
    for (const gateway of gatewaysQuery.data ?? []) {
      names[gateway.clearingGlAccountId] = gateway.name
    }
    return names
  }, [gatewaysQuery.data])
  const refusal = preview.data?.refusal ?? null

  const post = api.money.runFulfillmentPosting.useMutation({
    onError: (error) =>
      toastError({ title: 'Could not post fulfillments', description: error.message }),
  })

  const handleRun = async () => {
    if (!plan || plan.footer.postings === 0) return
    try {
      const summary = await post.mutateAsync({ from: fromKey, to: toKey, grouping })
      setResult(summary)
      setPage('result')
      // The run writes `GlPosting` rows and stamps every shipment behind them,
      // and nothing on the ledger page or an order's ledger card learns about
      // either on its own.
      await Promise.all([
        utils.ledger.invalidate(),
        utils.money.orderFulfillmentPostings.invalidate(),
        utils.money.previewFulfillmentPosting.invalidate(),
      ])
      onCompleted?.()
    } catch {
      // onError already surfaced the toast.
    }
  }

  const stale = preview.isFetching
  const canRun = !!plan && plan.footer.postings > 0 && !refusal && !stale && !post.isPending

  return (
    <Dialog open={open} onOpenChange={(next) => !post.isPending && onOpenChange(next)}>
      <DialogContent size='content' position='tc' innerClassName='p-0'>
        <DialogNav
          title='Post fulfillments'
          description='Recognise the revenue for everything that has shipped and has no entry yet.'
          crumbs={[
            {
              label: 'Post fulfillments',
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
                    resizeId='post-fulfillments'
                    defaultLabelWidth={180}>
                    <FieldPanelRow
                      title='From'
                      type={BaseType.DATE}
                      showIcon
                      isRequired
                      description='On the date the shipment left, not the date the order was placed'>
                      <FieldInputAdapter
                        fieldType={FieldType.DATE}
                        value={from}
                        onChange={(value) => setFrom((value as string) ?? from)}
                        disabled={post.isPending}
                      />
                    </FieldPanelRow>

                    <FieldPanelRow
                      title='To'
                      type={BaseType.DATE}
                      showIcon
                      isRequired
                      description='Exclusive, the day itself is not included'>
                      <FieldInputAdapter
                        fieldType={FieldType.DATE}
                        value={to}
                        onChange={(value) => setTo((value as string) ?? to)}
                        disabled={post.isPending}
                      />
                    </FieldPanelRow>

                    <FieldPanelRow
                      title='Group into'
                      type={BaseType.ENUM}
                      showIcon
                      isRequired
                      description='How many shipments one entry summarises'>
                      <FieldInputAdapter
                        fieldType={FieldType.SINGLE_SELECT}
                        fieldOptions={{ options: GROUPING_OPTIONS }}
                        value={grouping}
                        onChange={(value) =>
                          setGrouping(
                            ((value as string[])[0] as FulfillmentPostingGrouping) ?? 'day'
                          )
                        }
                        disabled={post.isPending}
                      />
                    </FieldPanelRow>
                  </FieldPanel>

                  {/* A refusal is a card, not a toast (ground rule 9): the book
                      time zone being unset is a settings task with an address,
                      and a sentence that disappears cannot carry one. */}
                  {refusal && <Note tone='warning'>{refusal}</Note>}

                  {preview.error && !refusal && <Note tone='warning'>{preview.error.message}</Note>}

                  {preview.isPending && !plan && <PlanSkeleton />}

                  {plan && (
                    <div
                      className={
                        stale
                          ? 'flex flex-col gap-4 opacity-60 transition-opacity'
                          : 'flex flex-col gap-4 transition-opacity'
                      }>
                      <FulfillmentPlanTable
                        plan={plan}
                        currencyCode={currencyCode}
                        gatewayNames={gatewayNames}
                      />

                      <FulfillmentExclusions exclusions={plan.exclusions} />

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
                  from 613 postings to 62 to 2 as the grouping changes is how the
                  tradeoff becomes visible instead of a constant nobody sees. */}
              <div className='flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5'>
                <p className='text-muted-foreground text-sm tabular-nums'>
                  {plan ? (
                    <>
                      <strong className='font-medium text-foreground'>
                        {plan.footer.postings}
                      </strong>{' '}
                      {plan.footer.postings === 1 ? 'posting' : 'postings'} ·{' '}
                      <strong className='font-medium text-foreground'>
                        {plan.footer.shipments}
                      </strong>{' '}
                      {plan.footer.shipments === 1 ? 'shipment' : 'shipments'} ·{' '}
                      <strong className='font-medium text-foreground'>{plan.footer.orders}</strong>{' '}
                      {plan.footer.orders === 1 ? 'order' : 'orders'} ·{' '}
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
                    disabled={post.isPending}>
                    Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
                  </Button>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={handleRun}
                    loading={post.isPending}
                    loadingText='Posting...'
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
            <PostResult
              result={result}
              onBack={() => setPage('plan')}
              onClose={() => onOpenChange(false)}
            />
          </DialogNavPage>
        </DialogNavPages>
      </DialogContent>
    </Dialog>
  )
}

// ─── Result ───────────────────────────────────────────────────────────────

/**
 * What the run actually did, per group.
 *
 * 🛑 **Skipped is not failed and neither is an error.** `postEntry` never throws:
 * `already_posted` means the day is in the books already, and a locked period
 * means somebody closed the month. Reporting either as a failure is what makes
 * people press the button a second time, which on this screen would be asking
 * for the same revenue twice.
 */
function PostResult({
  result,
  onBack,
  onClose,
}: {
  result: FulfillmentPostingRunSummary | null
  onBack: () => void
  onClose: () => void
}) {
  const shipmentsPosted = useMemo(
    () => (result?.posted ?? []).reduce((total, row) => total + row.shipments, 0),
    [result]
  )

  if (!result) return null

  const posted = result.posted.length
  const skipped = result.skipped.length
  const failed = result.failed.length

  return (
    <div className='flex flex-col'>
      <ScrollArea viewportClassName='max-h-[70vh]' allowScrollChaining>
        <div className='flex flex-col gap-3 p-4 text-sm'>
          <p>
            <strong className='font-medium'>{posted}</strong>{' '}
            {posted === 1 ? 'entry was' : 'entries were'} posted, covering {shipmentsPosted}{' '}
            {shipmentsPosted === 1 ? 'shipment' : 'shipments'}.
          </p>

          {posted > 0 && (
            <ul className='ps-4 text-muted-foreground text-xs tabular-nums'>
              {result.posted.slice(0, 24).map((row) => (
                <li key={row.groupKey}>
                  <span className='font-mono'>{row.docNumber}</span> · {row.groupKey} ·{' '}
                  {row.shipments} {row.shipments === 1 ? 'shipment' : 'shipments'}
                </li>
              ))}
              {posted > 24 && <li>and {posted - 24} more</li>}
            </ul>
          )}

          {skipped > 0 && (
            <div>
              <p>
                {skipped} {skipped === 1 ? 'group was' : 'groups were'} skipped. Nothing was written
                for {skipped === 1 ? 'it' : 'them'}, and nothing is wrong.
              </p>
              <ul className='mt-1 ps-4 text-muted-foreground text-xs'>
                {result.skipped.slice(0, 24).map((row) => (
                  <li key={row.groupKey}>
                    {row.groupKey}: {row.status}, {row.reason}
                  </li>
                ))}
                {skipped > 24 && <li>and {skipped - 24} more</li>}
              </ul>
            </div>
          )}

          {failed > 0 && (
            <div>
              <p className='flex items-start gap-1.5'>
                <TriangleAlert className='mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-500' />
                <span>
                  {failed} {failed === 1 ? 'group' : 'groups'} wrote nothing at all. They stay
                  unposted and come back in the next preview.
                </span>
              </p>
              <ul className='mt-1 ps-6 text-muted-foreground text-xs'>
                {result.failed.slice(0, 24).map((row) => (
                  <li key={row.groupKey}>
                    {row.groupKey}: {row.reason}
                  </li>
                ))}
                {failed > 24 && <li>and {failed - 24} more</li>}
              </ul>
            </div>
          )}

          {result.exclusions.length > 0 && (
            <p className='text-muted-foreground text-xs'>
              {result.exclusions.length}{' '}
              {result.exclusions.length === 1 ? 'shipment was' : 'shipments were'} excluded from
              this run. They are listed with their reasons on the preview.
            </p>
          )}
        </div>
      </ScrollArea>

      <div className='flex shrink-0 items-center justify-end gap-2 border-t px-4 py-2.5'>
        <Button type='button' variant='ghost' size='sm' onClick={onBack}>
          Back to the preview
        </Button>
        <Button variant='outline' size='sm' onClick={onClose} data-dialog-submit>
          Done <KbdSubmit variant='outline' size='sm' />
        </Button>
      </div>
    </div>
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

/** The instant shape `FieldInputAdapter`'s DATE input round-trips. */
function dayIso(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, '0')
  const m = String(month + 1).padStart(2, '0')
  const d = String(day).padStart(2, '0')
  return `${y}-${m}-${d}T00:00:00.000Z`
}

/** The first day of the previous month, the window a monthly close asks for. */
function startOfLastMonth(): string {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  return dayIso(first.getFullYear(), first.getMonth(), 1)
}

/** Today in the viewer's own zone. The server re-cuts the day in book time. */
function today(): string {
  const now = new Date()
  return dayIso(now.getFullYear(), now.getMonth(), now.getDate())
}

/** `2026-08-01T00:00:00.000Z` becomes `2026-08-01`, which is what the range is. */
function dayKey(value: string): string {
  return value.slice(0, 10)
}
