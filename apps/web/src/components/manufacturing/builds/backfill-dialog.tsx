// apps/web/src/components/manufacturing/builds/backfill-dialog.tsx
'use client'

// The bulk builder (§7 of plans/money/tasks/44-auto-build-cutoff-and-backfill.md)
// — *"a way to create builds from orders that don't have builds, and combine
// them so we don't have thousands."*
//
// A standalone tool, not a wizard step. The cutover checklist links to it, but
// its other half of life is ordinary: a connector was off for a week, or
// auto-build was switched on late, and demand has run ahead of builds. A step
// that only exists inside an onboarding flow cannot be reached then.
//
// ## The two dates are not the same date
//
// - The **cutoff** (`inventory.autoBuildEnabledAt`) is where LIVE per-order
//   raising begins. It is a settings row and this dialog only reads it.
// - The **range** is what HISTORY to batch, and it is what actually delivers
//   *"give me the builds for everything since January 1"*.
//
// 🛑 A batch build is only safe BELOW the cutoff: above it the reconciler is
// live and a batch build does not suppress a raise, so any order up there that
// later moves gets a per-order build stacked on top of the batch one. The range
// is therefore bounded above by the cutoff, and a `to` past it is REFUSED with
// the reason, never clamped silently. The server runs the same predicate.
//
// ## Why the grouping control stays even though the owner always picks month
//
// The footer moving from 94 builds to 20 to 217 as the control changes IS the
// feature (§7.2). It makes the tradeoff visible instead of baked into a constant
// nobody can see.
//
// ## Its chrome is the shared batch-dialog chrome, and only its chrome
//
// This screen is the PROGENITOR of the shape `money/ui/batch-posting/` later
// extracted a frame from (25 §5). It now wears that frame's shell, footer,
// result page, note card, panel and enum row, so the three dialogs cannot drift
// apart cosmetically any more.
//
// 🛑 **It is deliberately NOT a `BatchPostingSource`.** The descriptor is a
// contract as much as a shape, and this dialog answers none of it: the range is
// two `Date`s bounded by the build cutoff rather than a half-open day-key
// window, the groupings are five and are filtered live by the *Create as*
// answer beside them, the exclusions table counts quantities rather than listing
// documents by date, the preflight and its consent checkbox have no analogue,
// and the result reports builds raised and left in progress rather than entries
// posted. Registering it would mean a pluggable range, a dynamic grouping list,
// an overridable exclusions block, an overridable result page and a
// source-supplied run predicate — five slots that exactly one source would ever
// set, which is the failure mode 25 §5.2 names by hand.

import { FieldType } from '@auxx/database/enums'
import {
  BACKFILL_GROUPINGS,
  type BackfillGrouping,
  type BackfillRunSummary,
  type BackfillStatus,
} from '@auxx/lib/builds/client'
import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { toastError } from '@auxx/ui/components/toast'
import { keepPreviousData } from '@tanstack/react-query'
import { TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanelRow } from '~/components/global/forms/field-panel'
import {
  BatchDialogNote,
  BatchDialogPanel,
  BatchEnumRow,
  BatchPlanSection,
  BatchPlanSkeleton,
} from '~/components/money/ui/batch-posting/batch-dialog-parts'
import {
  BatchDialogFooter,
  BatchDialogResultPage,
  BatchDialogShell,
} from '~/components/money/ui/batch-posting/batch-dialog-shell'
import { useResourceProperty } from '~/components/resources'
import { BaseType } from '~/components/workflow/types'
import { api } from '~/trpc/react'
import { BackfillExclusions } from './backfill-exclusions'
import { BackfillPeriodStrip } from './backfill-period-strip'
import { BackfillPlanTable, formatQuantity } from './backfill-plan-table'

const GROUPING_LABELS: Record<BackfillGrouping, string> = {
  order: 'One build per order',
  day: 'One build per day',
  week: 'One build per week',
  month: 'One build per month',
  range: 'One build for the whole range',
}

const STATUS_OPTIONS: readonly { value: BackfillStatus; label: string }[] = [
  { value: 'planned', label: 'Planned — work still to do' },
  { value: 'completed', label: 'Completed — this already happened' },
]

interface BackfillDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCompleted?: () => void
}

export function BackfillDialog({ open, onOpenChange, onCompleted }: BackfillDialogProps) {
  const [page, setPage] = useState<'plan' | 'result'>('plan')
  const [from, setFrom] = useState<string>(() => startOfYear().toISOString())
  const [to, setTo] = useState<string>(() => new Date().toISOString())
  const [grouping, setGrouping] = useState<BackfillGrouping>('month')
  const [status, setStatus] = useState<BackfillStatus>('planned')
  const [periodFilter, setPeriodFilter] = useState<string | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [result, setResult] = useState<BackfillRunSummary | null>(null)

  const buildDefId = useResourceProperty('build', 'id')
  const utils = api.useUtils()

  // A fresh dialog on every open. A range somebody abandoned yesterday would
  // silently backfill the wrong window, and a stale acknowledgement would carry
  // consent for a ledger nobody has now been shown.
  useEffect(() => {
    if (!open) return
    setPage('plan')
    setFrom(startOfYear().toISOString())
    setTo(new Date().toISOString())
    setGrouping('month')
    setStatus('planned')
    setPeriodFilter(null)
    setAcknowledged(false)
    setResult(null)
  }, [open])

  const fromDate = useMemo(() => new Date(from), [from])
  const toDate = useMemo(() => new Date(to), [to])

  // §7.3 / the `BackfillGrouping` contract: `build_completed_at` decides which
  // month-end entry reflects a build, so one build for a multi-month range
  // misstates every month it spans. Not selectable rather than disabled — a
  // control that cannot be operated is worse than one that is not offered.
  const rangeGroupingBarred = status === 'completed' && spansSeveralMonths(fromDate, toDate)
  const groupingOptions = useMemo(
    () =>
      BACKFILL_GROUPINGS.filter((value) => value !== 'range' || !rangeGroupingBarred).map(
        (value) => ({ value, label: GROUPING_LABELS[value] })
      ),
    [rangeGroupingBarred]
  )

  useEffect(() => {
    if (rangeGroupingBarred && grouping === 'range') setGrouping('month')
  }, [rangeGroupingBarred, grouping])

  const preview = api.builds.previewBackfill.useQuery(
    { from: fromDate, to: toDate, grouping, status },
    {
      enabled: open && page === 'plan',
      retry: false,
      refetchOnWindowFocus: false,
      // Without this every grouping change blanks the table, the strip and the
      // footer together — which reads as "the numbers just went away" on the one
      // screen whose whole point is watching those numbers move.
      placeholderData: keepPreviousData,
    }
  )

  // Any change to the plan invalidates a filter pinned to a period that may no
  // longer exist under the new grouping.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resetting on the inputs, not on the response
  useEffect(() => setPeriodFilter(null), [grouping, from, to])

  const data = preview.data
  const plan = data?.plan ?? null
  const preflight = data?.preflight ?? null
  const refusal = data?.refusal ?? null
  const cutoff = data?.cutoff ?? null

  const runBackfill = api.builds.runBackfill.useMutation({
    onError: (error) => toastError({ title: 'Backfill failed', description: error.message }),
  })

  const handleRun = async () => {
    if (!plan || plan.buildCount === 0) return
    try {
      const summary = await runBackfill.mutateAsync({
        from: fromDate,
        to: toDate,
        grouping,
        status,
      })
      setResult(summary)
      setPage('result')
      await Promise.all([
        utils.builds.list.invalidate(),
        buildDefId
          ? utils.record.listFiltered.invalidate({ entityDefinitionId: buildDefId })
          : Promise.resolve(),
      ])
      onCompleted?.()
    } catch {
      // onError already surfaced the toast.
    }
  }

  const stale = preview.isFetching
  const negatives = preflight?.projectedOnHand.filter((row) => row.projected < 0) ?? []
  const needsAcknowledgement = status === 'completed'
  const canRun =
    !!plan &&
    plan.buildCount > 0 &&
    !refusal &&
    !stale &&
    (!needsAcknowledgement || acknowledged) &&
    !runBackfill.isPending

  return (
    <BatchDialogShell
      open={open}
      onOpenChange={onOpenChange}
      busy={runBackfill.isPending}
      title='Backfill builds'
      description='Create builds for demand that has been ordered and never built.'
      page={page}
      onBackToPlan={() => setPage('plan')}
      planBody={
        <>
          <BatchDialogPanel resizeId='backfill-builds'>
            <FieldPanelRow
              title='From'
              type={BaseType.DATE}
              showIcon
              isRequired
              description='On the date the order was placed'>
              <FieldInputAdapter
                fieldType={FieldType.DATE}
                value={from}
                onChange={(val) => setFrom((val as string) ?? from)}
                disabled={runBackfill.isPending}
              />
            </FieldPanelRow>

            <FieldPanelRow
              title='To'
              type={BaseType.DATE}
              showIcon
              isRequired
              description={
                cutoff
                  ? `Bounded by the build cutoff, ${formatDate(cutoff)}`
                  : 'Exclusive — the day itself is not included'
              }>
              <FieldInputAdapter
                fieldType={FieldType.DATE}
                value={to}
                onChange={(val) => setTo((val as string) ?? to)}
                disabled={runBackfill.isPending}
              />
            </FieldPanelRow>

            <BatchEnumRow
              title='Group into'
              description='How much demand one build covers'
              options={groupingOptions}
              value={grouping}
              onChange={setGrouping}
              fallback='month'
              disabled={runBackfill.isPending}
            />

            <BatchEnumRow
              title='Create as'
              description='Is this history, or is it work to do?'
              options={STATUS_OPTIONS}
              value={status}
              onChange={(next) => {
                setStatus(next)
                setAcknowledged(false)
              }}
              fallback='planned'
              disabled={runBackfill.isPending}
            />
          </BatchDialogPanel>

          {rangeGroupingBarred && (
            <BatchDialogNote>
              One build for the whole range is not available here: this range spans more than one
              month, and a completed build's date decides which month-end entry reflects it.
            </BatchDialogNote>
          )}

          {refusal && <BatchDialogNote tone='warning'>{refusal}</BatchDialogNote>}

          {refusal && cutoff && toDate.getTime() > cutoff.getTime() && (
            <div>
              <Button
                variant='outline'
                size='sm'
                onClick={() => setTo(new Date(cutoff).toISOString())}>
                Use the cutoff date
              </Button>
            </div>
          )}

          {preview.error && !refusal && (
            <BatchDialogNote tone='warning'>{preview.error.message}</BatchDialogNote>
          )}

          {preview.isPending && !plan && <BatchPlanSkeleton />}

          {plan && (
            <BatchPlanSection stale={stale}>
              <BackfillPeriodStrip plan={plan} selected={periodFilter} onSelect={setPeriodFilter} />

              <BackfillPlanTable
                plan={plan}
                partNames={data?.partNames ?? {}}
                periodFilter={periodFilter}
              />

              <BackfillExclusions exclusions={plan.excluded} partNames={data?.partNames ?? {}} />

              {preflight && (
                <CompletionPreflight
                  buildCount={preflight.buildCount}
                  movementCount={preflight.movementCount}
                  unpricedParts={preflight.unpricedParts}
                  negatives={negatives}
                  acknowledged={acknowledged}
                  onAcknowledge={setAcknowledged}
                  disabled={runBackfill.isPending}
                />
              )}
            </BatchPlanSection>
          )}
        </>
      }
      planFooter={
        <BatchDialogFooter
          counts={
            plan ? (
              <>
                <strong className='font-medium text-foreground'>{plan.parts.length}</strong>{' '}
                {plan.parts.length === 1 ? 'part' : 'parts'} ·{' '}
                <strong className='font-medium text-foreground'>{plan.buildCount}</strong>{' '}
                {plan.buildCount === 1 ? 'build' : 'builds'} ·{' '}
                <strong className='font-medium text-foreground'>
                  {formatQuantity(plan.unitCount)}
                </strong>{' '}
                {plan.unitCount === 1 ? 'unit' : 'units'}
              </>
            ) : (
              'No preview yet'
            )
          }
          onCancel={() => onOpenChange(false)}
          onSubmit={handleRun}
          submitLabel={status === 'completed' ? 'Create and post' : 'Create builds'}
          loading={runBackfill.isPending}
          loadingText='Creating builds...'
          disabled={!canRun}
        />
      }
      result={
        <BackfillResult
          result={result}
          onClose={() => onOpenChange(false)}
          onBack={() => setPage('plan')}
        />
      }
    />
  )
}

// ─── Completed-run preflight (§7.3) ──────────────────────────────────────

/**
 * What a `completed` run would write, before it writes any of it.
 *
 * §7.3: `planned` is "N builds". `completed` is "N builds, M stock movements, on
 * an append-only ledger correctable only by reversing." Different consent, and
 * the ledger sentence has to be in the dialog rather than in a doc.
 *
 * 🛑 The projected-stock block WARNS and does not refuse. Negative on hand is a
 * true statement about a ledger that is missing its receipts, and refusing would
 * make the backfill unusable on exactly the org that needs it most. The remedy
 * is opening stock, which is the person's call to make first.
 */
function CompletionPreflight({
  buildCount,
  movementCount,
  unpricedParts,
  negatives,
  acknowledged,
  onAcknowledge,
  disabled,
}: {
  buildCount: number
  movementCount: number
  unpricedParts: { partId: string; partName: string | null }[]
  negatives: { partId: string; partName: string | null; onHand: number; projected: number }[]
  acknowledged: boolean
  onAcknowledge: (next: boolean) => void
  disabled: boolean
}) {
  return (
    <div className='flex flex-col gap-3 rounded-md border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/30'>
      <p className='font-medium text-sm'>
        This run writes {buildCount} {buildCount === 1 ? 'build' : 'builds'} and {movementCount}{' '}
        stock {movementCount === 1 ? 'movement' : 'movements'}.
      </p>

      {unpricedParts.length > 0 && (
        <div className='text-sm'>
          <p className='flex items-start gap-1.5'>
            <TriangleAlert className='mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-500' />
            <span>
              {unpricedParts.length} {unpricedParts.length === 1 ? 'part has' : 'parts have'} no
              standard cost. A completion is refused per build when a component is unpriced, so
              those builds will be raised and left in progress.
            </span>
          </p>
          <ul className='mt-1 ps-6 text-muted-foreground text-xs'>
            {unpricedParts.slice(0, 12).map((part) => (
              <li key={part.partId}>{part.partName ?? part.partId}</li>
            ))}
            {unpricedParts.length > 12 && <li>and {unpricedParts.length - 12} more</li>}
          </ul>
        </div>
      )}

      {negatives.length > 0 && (
        <div className='text-sm'>
          <p className='flex items-start gap-1.5'>
            <TriangleAlert className='mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-500' />
            <span>
              This run takes {negatives.length}{' '}
              {negatives.length === 1 ? 'component' : 'components'} below zero. That is usually a
              ledger missing its receipts rather than a mistake here, and opening stock is the fix.
            </span>
          </p>
          <ul className='mt-1 ps-6 text-muted-foreground text-xs tabular-nums'>
            {negatives.slice(0, 12).map((row) => (
              <li key={row.partId}>
                {row.partName ?? row.partId}: {formatQuantity(row.onHand)} to{' '}
                {formatQuantity(row.projected)}
              </li>
            ))}
            {negatives.length > 12 && <li>and {negatives.length - 12} more</li>}
          </ul>
        </div>
      )}

      <label className='flex items-start gap-2 text-sm'>
        <Checkbox
          checked={acknowledged}
          onCheckedChange={(next) => onAcknowledge(next === true)}
          disabled={disabled}
          className='mt-0.5'
        />
        <span>
          I understand these movements land on an append-only ledger and can only be corrected by
          reversing them.
        </span>
      </label>
    </div>
  )
}

// ─── Result (§7.4) ───────────────────────────────────────────────────────

/**
 * What the run actually did.
 *
 * 🛑 **A refused completion is not a failure of the run.** `buildNow` reports it
 * as the `left_in_progress` RESULT carrying the build it already raised, so this
 * has to name that arm separately — telling somebody "failed" about builds that
 * exist is what makes them press the button a second time.
 */
function BackfillResult({
  result,
  onBack,
  onClose,
}: {
  result: BackfillRunSummary | null
  onBack: () => void
  onClose: () => void
}) {
  if (!result) return null

  const created = result.created.length
  const left = result.leftInProgress.length
  const failed = result.failed.length

  return (
    <BatchDialogResultPage onBack={onBack} onClose={onClose}>
      <p>
        <strong className='font-medium'>{created}</strong>{' '}
        {created === 1 ? 'build was' : 'builds were'} created.
      </p>

      {left > 0 && (
        <div>
          <p className='flex items-start gap-1.5'>
            <TriangleAlert className='mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-500' />
            <span>
              {left} of them could not be completed and {left === 1 ? 'is' : 'are'} sitting in
              progress. They exist — do not run the backfill again for them.
            </span>
          </p>
          <ul className='mt-1 ps-6 text-muted-foreground text-xs'>
            {result.leftInProgress.slice(0, 12).map((row) => (
              <li key={row.buildId}>{row.reason}</li>
            ))}
            {left > 12 && <li>and {left - 12} more</li>}
          </ul>
        </div>
      )}

      {failed > 0 && (
        <div>
          <p>
            {failed} {failed === 1 ? 'bucket' : 'buckets'} produced nothing at all.
          </p>
          <ul className='mt-1 ps-6 text-muted-foreground text-xs'>
            {result.failed.slice(0, 12).map((row) => (
              <li key={row.bucketId}>
                {row.periodKey}: {row.reason}
              </li>
            ))}
            {failed > 12 && <li>and {failed - 12} more</li>}
          </ul>
        </div>
      )}
    </BatchDialogResultPage>
  )
}

// ─── Small pieces ────────────────────────────────────────────────────────

/** January 1 of the current year — the range the cutover actually asks for. */
function startOfYear(): Date {
  return new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1))
}

/** Does `[from, to)` cross a calendar month boundary? Mirrors the server's predicate. */
function spansSeveralMonths(from: Date, to: Date): boolean {
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return false
  const last = new Date(to.getTime() - 1)
  return (
    from.getUTCFullYear() !== last.getUTCFullYear() || from.getUTCMonth() !== last.getUTCMonth()
  )
}

function formatDate(value: Date | string): string {
  return new Date(value).toLocaleDateString()
}
