// apps/web/src/components/inbox/ui/inbox-reclassify-dialog.tsx

'use client'

import {
  countClassificationFailures,
  MAIL_CLASSIFY_FAILURE_REASONS,
  MAIL_RECLASSIFY_DAY_PRESETS,
  MAIL_RECLASSIFY_DEFAULT_MODE,
  MAIL_RECLASSIFY_MAX_THREADS,
  MAIL_RECLASSIFY_SAMPLE_SIZE,
  MAIL_RECLASSIFY_THREAD_PRESETS,
  type MailClassificationFailureReason,
  type MailReclassifyMode,
  type MailReclassifyRange,
  type MailReclassifySampleReport,
} from '@auxx/lib/mail-classification/client'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Label } from '@auxx/ui/components/label'
import { Progress } from '@auxx/ui/components/progress'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { ArrowRight, Layers, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { api, type RouterOutputs } from '~/trpc/react'

/**
 * "Classify existing mail" — the scope dialog (07 §3.2) and the sample results
 * that replace its body in place (07 §3.3).
 *
 * ## The three things this dialog exists to be honest about
 *
 * - **It does not run your filters.** `plans/mail-filter/07-…` R2/§2.8: a
 *   retroactive run tags and stops, because firing `assign`/`archive`/`run-agent`
 *   over a historical backlog is the late-filter-action problem. What it buys is
 *   analytics and search — labels on history, never routing. Most people read
 *   "classify existing mail" as "apply my automations to old mail", so the
 *   correction is stated at the point of action (07 invariant 11).
 * - **What it will cost, before it costs it.** The count comes from the same
 *   predicate the run pages over (07 invariant 10), so the number in the confirm
 *   is the number being consented to.
 * - **Which mode charges twice.** `Fill gaps` never re-bills; `Re-classify
 *   everything` deliberately does. This is the only place a user can accidentally
 *   pay for the same conversation twice, so the two options carry that in their
 *   own copy (07 R4).
 *
 * ## Why the SAMPLE is the primary action
 *
 * 07 R6: sample mode ships first and is the primary CTA until a taxonomy is
 * proven. ~100 conversations, distribution + abstention rate, applies nothing —
 * that is what tells you whether the vocabulary is worth running over thousands
 * of conversations at all. The full run is 07 phase 2 and is deliberately not
 * offered here yet.
 *
 * ⚠️ This dialog is only ever opened by a click on the backlog row. It must never
 * be auto-opened on opt-in (07 invariant 12) — a dialog asking for money one
 * click after a toggle reads as a dark pattern, and the row is prompt enough.
 */

/** The `Select`'s value space — a range flattened to one string. */
type RangeKey = `days:${number}` | `threads:${number}` | 'all-time'

function toRange(key: RangeKey): MailReclassifyRange {
  if (key === 'all-time') return { kind: 'all-time' }
  const [kind, value] = key.split(':')
  return kind === 'days'
    ? { kind: 'days', days: Number(value) }
    : { kind: 'threads', threads: Number(value) }
}

const DEFAULT_RANGE_KEY: RangeKey = 'days:30'

const MODE_COPY: Record<MailReclassifyMode, { label: string; description: string }> = {
  // ⚠️ 07 R4 — the cost distinction is the whole point of the copy.
  'fill-gaps': {
    label: 'Fill gaps',
    description: 'Only conversations that have never been classified. Never charges twice.',
  },
  're-classify': {
    label: 'Re-classify everything',
    description:
      'Also re-does conversations that were already classified. Use this after changing your categories. Charges again for those conversations.',
  },
}

const n = (value: number) => value.toLocaleString()

/** `5,000 of 5,000+` when capped — never a bare number that implies completeness. */
function describeCount(count: number, capped: boolean): string {
  const noun = count === 1 ? 'conversation' : 'conversations'
  // ⚠️ 07 R-Q5 declines an exact total past the cap: the count query is bounded by
  // `LIMIT cap + 1`, which is the only way it stays cheap, so anything beyond it
  // is genuinely unknown. `5,000+` is the honest wording (07 invariant 8).
  return capped ? `${n(count)} of ${n(count)}+ ${noun}` : `${n(count)} ${noun}`
}

export interface InboxReclassifyDialogProps {
  inboxId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function InboxReclassifyDialog({ inboxId, open, onOpenChange }: InboxReclassifyDialogProps) {
  const utils = api.useUtils()
  const [rangeKey, setRangeKey] = useState<RangeKey>(DEFAULT_RANGE_KEY)
  const [mode, setMode] = useState<MailReclassifyMode>(MAIL_RECLASSIFY_DEFAULT_MODE)

  // Dialogs do not carry stale state into a fresh open — and re-opening after a
  // sample must show the scope form again, not last week's numbers.
  useEffect(() => {
    if (!open) return
    setRangeKey(DEFAULT_RANGE_KEY)
    setMode(MAIL_RECLASSIFY_DEFAULT_MODE)
  }, [open])

  const range = toRange(rangeKey)

  const preview = api.mailClassification.getReclassifyPreview.useQuery(
    { inboxId, range, mode },
    { enabled: open }
  )

  // The SAME query key the backlog row polls, so the two surfaces share one poll
  // and can never disagree about whether a sample is running.
  const status = api.mailClassification.getReclassifySampleStatus.useQuery(
    { inboxId },
    {
      enabled: open,
      refetchInterval: (query) => {
        const state = query.state.data?.state
        return state === 'waiting' || state === 'active' || state === 'delayed' ? 2000 : false
      },
    }
  )

  const startSample = api.mailClassification.startReclassifySample.useMutation({
    onSuccess: () => utils.mailClassification.getReclassifySampleStatus.invalidate({ inboxId }),
    onError: (error) =>
      toastError({ title: 'Error starting the sample', description: error.message }),
  })

  // Starting a run closes the dialog: §3.1 makes the backlog row the progress
  // surface, and two progress bars for one job is how they drift apart.
  const startRun = api.mailClassification.startReclassifyRun.useMutation({
    onSuccess: () => {
      void utils.mailClassification.getReclassifyRunStatus.invalidate({ inboxId })
      onOpenChange(false)
    },
    onError: (error) => toastError({ title: 'Error starting the run', description: error.message }),
  })

  const running =
    status.data?.state === 'waiting' ||
    status.data?.state === 'active' ||
    status.data?.state === 'delayed'
  const report = status.data?.state === 'completed' ? status.data.report : undefined

  const handleSample = () => startSample.mutate({ inboxId, range, mode })
  const handleRun = () => startRun.mutate({ inboxId, range, mode })

  // ⚠️ A capped run says what it capped (07 invariant 8). A bare number implies
  // completeness, and "silent truncation reads as covered everything".
  const inScope = preview.data?.count ?? 0
  const willRun = Math.min(inScope, MAIL_RECLASSIFY_MAX_THREADS)
  const runLabel =
    willRun < inScope
      ? `Classify ${n(willRun)} of ${n(inScope)}`
      : `Classify ${n(willRun)} ${willRun === 1 ? 'conversation' : 'conversations'}`
  const startDisabled =
    preview.isPending || !preview.data?.count || preview.data.syncInProgress === true

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent position='tc' size='md'>
        <DialogHeader>
          <DialogTitle>Classify existing mail</DialogTitle>
          <DialogDescription>
            Labels conversations already in this inbox so you can search and report on them.{' '}
            {/* ⚠️ 07 invariant 11 — not optional. Without it "classify existing
                mail" reads as "apply my automations to old mail". */}
            <strong className='font-medium'>Your mail filters do not run on them</strong>. Nothing
            is assigned, archived or answered.
          </DialogDescription>
        </DialogHeader>

        {running ? (
          <SampleProgress
            processed={status.data?.processed ?? 0}
            total={status.data?.total ?? MAIL_RECLASSIFY_SAMPLE_SIZE}
          />
        ) : report ? (
          <SampleResults report={report} />
        ) : (
          <div className='space-y-4'>
            <div className='space-y-1.5'>
              <Label htmlFor='reclassify-range'>How far back</Label>
              <Select value={rangeKey} onValueChange={(value) => setRangeKey(value as RangeKey)}>
                <SelectTrigger id='reclassify-range' size='sm' className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MAIL_RECLASSIFY_DAY_PRESETS.map((days) => (
                    <SelectItem key={days} value={`days:${days}`}>
                      Last {days} days
                    </SelectItem>
                  ))}
                  {MAIL_RECLASSIFY_THREAD_PRESETS.map((threads) => (
                    <SelectItem key={threads} value={`threads:${threads}`}>
                      The {n(threads)} most recent conversations
                    </SelectItem>
                  ))}
                  <SelectItem value='all-time'>All time</SelectItem>
                </SelectContent>
              </Select>
              {/* Newest first, always (07 invariant 8) — so a cancelled or capped
                  run got the part that mattered, and "the 500 most recent" is a
                  thing a user can picture. */}
              <p className='text-xs text-muted-foreground'>
                {rangeKey === 'all-time'
                  ? 'Every conversation in this inbox, newest first. This can reach back years, so check the count below before you start.'
                  : 'Newest conversations first.'}
              </p>
            </div>

            <RadioGroup
              value={mode}
              onValueChange={(value) => setMode(value as MailReclassifyMode)}
              className='gap-2'>
              {(['fill-gaps', 're-classify'] as const).map((option) => (
                <RadioGroupItemCard
                  key={option}
                  value={option}
                  icon={option === 'fill-gaps' ? <Layers /> : <RefreshCw />}
                  label={MODE_COPY[option].label}
                  description={MODE_COPY[option].description}
                />
              ))}
            </RadioGroup>

            <PreviewLine
              isPending={preview.isPending}
              error={preview.error?.message ?? null}
              data={preview.data ?? null}
            />
          </div>
        )}

        <DialogFooter>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => onOpenChange(false)}
            disabled={startSample.isPending}>
            {running || report ? 'Close' : 'Cancel'}{' '}
            <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>

          {report ? (
            <>
              {/* Closes the loop 07 §3.3 needs: sample → see it is wrong → fix the
                  vocabulary → sample again. Without it the user has the evidence
                  and nowhere to act on it. */}
              <Button variant='ghost' size='sm' asChild>
                <Link href='/app/settings/tags'>
                  Adjust my categories <ArrowRight />
                </Link>
              </Button>
              <Button
                variant='ghost'
                size='sm'
                onClick={handleSample}
                loading={startSample.isPending}
                loadingText='Starting...'>
                Sample again
              </Button>
              <Button
                variant='outline'
                size='sm'
                onClick={handleRun}
                loading={startRun.isPending}
                loadingText='Starting...'
                disabled={startDisabled}
                data-dialog-submit>
                {runLabel} <KbdSubmit variant='outline' size='sm' />
              </Button>
            </>
          ) : running ? null : (
            <>
              {/* The sample stays the SECONDARY action even now that the run
                  exists (R6): until a taxonomy has been measured on real mail,
                  spending on thousands of threads is the worse first click. */}
              <Button
                variant='ghost'
                size='sm'
                onClick={handleSample}
                loading={startSample.isPending}
                loadingText='Starting...'
                disabled={startDisabled}>
                Try a sample of {n(preview.data?.sampleSize ?? MAIL_RECLASSIFY_SAMPLE_SIZE)}
              </Button>
              <Button
                variant='outline'
                size='sm'
                onClick={handleRun}
                loading={startRun.isPending}
                loadingText='Starting...'
                disabled={startDisabled}
                data-dialog-submit>
                {runLabel} <KbdSubmit variant='outline' size='sm' />
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type Preview = RouterOutputs['mailClassification']['getReclassifyPreview']

/**
 * `412 conversations · ~830 credits`, recomputed on every scope change.
 *
 * ⚠️ The credit figure is an ESTIMATE against the org's own default model, not a
 * quote — the real charge is metered from actual usage. When the model has no
 * registry price the router answers `null` and this says "metered per
 * conversation" rather than inventing a number.
 */
function PreviewLine({
  isPending,
  error,
  data,
}: {
  isPending: boolean
  error: string | null
  data: Preview | null
}) {
  if (isPending) return <Skeleton className='h-9 w-full rounded-lg' />
  if (error) return <p className='text-xs text-destructive'>{error}</p>
  if (!data) return null

  return (
    <div className='rounded-2xl border px-3 py-2 text-sm'>
      {data.count === 0 ? (
        <p className='text-muted-foreground'>
          Nothing to classify in this range. Try a longer range, or switch to Re-classify
          everything.
        </p>
      ) : (
        <p>
          <span className='font-medium'>{describeCount(data.count, data.capped)}</span>
          {' · '}
          <span className='text-muted-foreground'>
            {data.estimatedCredits === null
              ? 'metered per conversation'
              : `~${n(data.estimatedCredits)} credits`}
            {data.sampleCredits === null
              ? ''
              : ` · a sample of ${n(data.sampleSize)} costs ~${n(data.sampleCredits)}`}
          </span>
        </p>
      )}
      {data.capped ? (
        <p className='mt-1 text-xs text-muted-foreground'>
          One run covers at most {n(data.cap)} conversations, newest first. Run it again to reach
          further back.
        </p>
      ) : null}
      {/* 07 R-Q8 — a run started mid-backfill races the sync and misses
          everything still arriving. */}
      {data.syncInProgress ? (
        <p className='mt-1 text-xs text-warning-600'>
          This inbox is still syncing. Wait for it to finish, or the sample misses everything still
          arriving.
        </p>
      ) : null}
      <p className='mt-1 text-xs text-muted-foreground'>
        Metered per conversation. Free when you bring your own API key.
      </p>
    </div>
  )
}

function SampleProgress({ processed, total }: { processed: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0
  return (
    <div className='space-y-2'>
      <p className='text-sm'>
        Classifying {n(processed)} of {n(total || MAIL_RECLASSIFY_SAMPLE_SIZE)}…
      </p>
      <Progress value={pct} />
      <p className='text-xs text-muted-foreground'>
        Nothing is applied while sampling. No tags are added and no conversation is marked as
        classified.
      </p>
    </div>
  )
}

/**
 * The sample's distribution (07 §3.3).
 *
 * ⚠️ Two rows that MUST render even at zero, because each of them IS the finding:
 *
 * - **A label the model never chose.** `06-…` Q1 asks exactly this question, and a
 *   zero row is the answer — a label never chosen in a representative sample is a
 *   label to merge. Filtering it out deletes the evidence.
 * - **"No category".** The abstention rate is the single most informative number
 *   in the report (07 §2.11): high abstention means the vocabulary does not fit
 *   this mail, or the threshold is wrong. It is a row, never a footnote.
 *
 * Nothing was applied, so there is no undo affordance here and no "sampled" state
 * on any conversation (07 invariant 9).
 */
/** Plain-language cause for each failure arm, for the results line. */
const FAILURE_LABELS: Record<MailClassificationFailureReason, string> = {
  'no-default-model': 'no default model configured',
  'quota-exceeded': 'out of AI credits',
  unavailable: 'the provider was unavailable',
  error: 'an unexpected error',
}

function SampleResults({ report }: { report: MailReclassifySampleReport }) {
  const rows = [
    ...report.labels.map((label) => ({
      key: label.tagId,
      title: label.title,
      count: label.count,
      meanConfidence: label.meanConfidence,
      muted: false,
    })),
    {
      key: '__abstained__',
      title: 'No category',
      count: report.abstained,
      meanConfidence: 0,
      muted: true,
    },
  ]
  const max = Math.max(1, ...rows.map((row) => row.count))
  const skipped = Math.max(0, report.selected - report.inferred)
  const failures = countClassificationFailures(report.skipped)
  // Whatever `skipped` is not accounted for by a failure is a guard exit.
  const exits = Math.max(0, skipped - failures)
  const failureReasons = MAIL_CLASSIFY_FAILURE_REASONS.filter((r) => (report.skipped[r] ?? 0) > 0)
    .map((r) => FAILURE_LABELS[r])
    .join(', ')

  return (
    <div className='space-y-3'>
      <p className='text-sm'>
        Sampled {n(report.selected)} {report.selected === 1 ? 'conversation' : 'conversations'} ·{' '}
        {n(report.classified)} classified · {n(report.abstained)} no category
      </p>

      <div className='space-y-1.5'>
        {rows.map((row) => (
          <div key={row.key} className='flex items-center gap-2 text-sm'>
            <span className={`w-36 shrink-0 truncate ${row.muted ? 'text-muted-foreground' : ''}`}>
              {row.title}
            </span>
            <span className='w-8 shrink-0 text-right tabular-nums'>{n(row.count)}</span>
            <span className='h-2 min-w-0 flex-1'>
              <span
                className={`block h-2 rounded-full ${row.muted ? 'bg-muted-foreground/40' : 'bg-foreground/70'}`}
                style={{ width: `${(row.count / max) * 100}%` }}
              />
            </span>
            <span className='w-12 shrink-0 text-right text-xs text-muted-foreground tabular-nums'>
              {row.count > 0 && !row.muted ? `${Math.round(row.meanConfidence * 100)}%` : ''}
            </span>
          </div>
        ))}
      </div>

      {/* ⚠️ Failures are called out separately from guard exits, and first.
          Folding them into one "never reached the model" sentence is how a run
          where EVERY call failed rendered as `0 classified · 0 no category` —
          indistinguishable from a taxonomy that matched nothing, and read as a
          result rather than as an incident. */}
      {failures > 0 ? (
        <p className='text-xs font-medium text-destructive'>
          {n(failures)} {failures === 1 ? 'call' : 'calls'} failed and never reached a verdict
          {failureReasons ? ` (${failureReasons})` : ''}. These conversations were not sampled.
        </p>
      ) : null}

      <p className='text-xs text-muted-foreground'>
        {/* Guard exits reduce the sample; 07 §2.11 requires saying so rather than
            implying the full sample size. */}
        {exits > 0
          ? `${n(exits)} of them were skipped by the guard: already classified, or machine mail. `
          : ''}
        Nothing was applied and nothing was marked as classified, so a real run still covers all of
        these.
      </p>
    </div>
  )
}
