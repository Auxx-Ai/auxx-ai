// apps/web/src/components/accounting/ui/provider-sync/provider-sync-report.tsx

'use client'

// What one run of the inbound sync actually did
// (plans/accounting/tasks/55-the-inbound-sync-runs-in-a-worker.md §4.5, §4.8).
//
// 🛑 A COUNT IS NOT AN ANSWER. The run blob carries counters AND an error sample
// rather than a success boolean precisely because four different questions have
// to be answerable afterwards, and three of them are about things that did NOT
// reach the books:
//
//   1. What came across      - `created`, `skipped`, `reversed`.
//   2. What was REFUSED      - every message in `errorSample`, verbatim. An
//      entry that was refused is an entry the accountant authored and this org
//      does not have, and a silent count of them is worse than useless.
//   3. What is waiting on a PERSON - `deferred`. §7.2: the sync reopens nothing
//      on its own, ever. Somebody with `ledgerControl` decides.
//   4. Whether the run FINISHED, and whether it is still going.
//
// 🛑 Reported INLINE, never as a toast - the same rule the rest of the
// accounting module follows (ground rule 9, `entry-blockers.tsx`). A refusal
// here names a transaction on the accountant's side; a toast would take that
// away three seconds later.
//
// And a fifth, which is not about a failure at all: an entry WE authored that
// the accountant has since edited or deleted in the provider. Nothing refused
// it, nothing counted it - the sync compares and reports, and this card is the
// only place that comparison is ever seen. 🛑 It is a REPORT: no repair, no
// merge, no "fix this". Brief 20 §3.4.

import { Alert, AlertTitle } from '@auxx/ui/components/alert'
import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import { CircleAlert, Clock, Lock, TriangleAlert, Unlink } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ProviderSyncRun } from '../../hooks/use-provider-sync-run'

export interface ProviderSyncReportProps {
  /** The open walk, or null. Takes precedence over `lastRun` - it is happening now. */
  currentRun: ProviderSyncRun | null
  lastRun: ProviderSyncRun | null
  /** The open run's heartbeat has gone quiet; the chain died (§7.4). */
  stale: boolean
  /** `'QuickBooks Online'`, or whatever is connected. */
  providerLabel: string
  className?: string
}

/** One reading of a run, for the row that has one line to say it in. */
export interface ProviderSyncRunReading {
  tone: 'running' | 'neutral' | 'warn' | 'alarm'
  headline: string
  /** The consequence, in the reader's terms. Null when there is nothing to add. */
  detail: string | null
}

/** `m:ss`, so a run that has been going for four minutes reads as one. */
export function elapsedLabel(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/**
 * Turn a run into the sentence the `Sync now` row renders.
 *
 * 🛑 A `stale` open run is NOT reported as running. §7.4: a chain killed
 * mid-slice by a worker restart leaves `currentRun` open with nothing to close
 * it, so believing the blob would show a spinner for ever on a walk that is not
 * happening - and the honest thing to say is that it stopped and can be started
 * again.
 *
 * @param now epoch ms, passed in so the elapsed clock is the caller's tick
 *   rather than a `Date.now()` this function reaches for on every render
 */
export function describeProviderSyncRun(
  input: { currentRun: ProviderSyncRun | null; lastRun: ProviderSyncRun | null; stale: boolean },
  providerLabel: string,
  now: number
): ProviderSyncRunReading {
  const { currentRun, lastRun, stale } = input

  if (currentRun && !stale) {
    const chunks = currentRun.pagesProcessed
    return {
      tone: 'running',
      headline: `Reading ${providerLabel} - ${elapsedLabel(now - Date.parse(currentRun.startedAt))} elapsed`,
      detail:
        `${chunks} ${chunks === 1 ? 'month' : 'months'} read so far, ${currentRun.counters.created} ` +
        'entries written. One provider call per month - report endpoints cannot be paged, so the ' +
        'month is the only lever. Nothing is written until a month has been read whole.',
    }
  }

  if (currentRun && stale) {
    return {
      tone: 'alarm',
      headline: 'The last sync stopped without finishing',
      detail:
        `It started at ${currentRun.startedAt} and then went quiet - a worker restart mid-walk ` +
        'leaves a run with nothing to close it. Everything already brought across stays. Press ' +
        'Sync now to start again; it resumes from where the walk got to, not from the beginning.',
    }
  }

  if (!lastRun) {
    return {
      tone: 'neutral',
      headline: `${providerLabel} has not been read yet`,
      detail:
        'Depreciation, accruals, reclasses and payroll are authored there and never here. Nothing ' +
        'of that is in these books until this runs.',
    }
  }

  const finished = lastRun.finishedAt ?? lastRun.heartbeatAt
  const chunks = lastRun.pagesProcessed
  const read = `Read ${chunks} ${chunks === 1 ? 'month' : 'months'}, wrote ${lastRun.counters.created}`

  if (lastRun.status === 'failed') {
    return {
      tone: 'alarm',
      headline: `The last sync failed at ${finished}`,
      detail: lastRun.error ?? 'No reason was recorded. The details are below.',
    }
  }

  if (lastRun.status === 'partial') {
    return {
      tone: 'warn',
      headline: `Last read ${finished}, and not everything came across`,
      detail: `${read}. What was refused is below, and it is NOT in your books.`,
    }
  }

  return { tone: 'neutral', headline: `Last read ${finished}`, detail: `${read}.` }
}

/**
 * The one sample split by `tier`, because the four have four different remedies:
 * their side, ours, a person with `ledgerControl`, and - for a divergence - a
 * conversation, since nothing here repairs one.
 *
 * An untiered sample is an engine-level error and reads as a refusal.
 */
export function splitErrorSample(run: ProviderSyncRun): {
  unbalanced: ProviderSyncRun['errorSample']
  refused: ProviderSyncRun['errorSample']
  diverged: ProviderSyncRun['errorSample']
  deferred: ProviderSyncRun['errorSample']
} {
  return {
    unbalanced: run.errorSample.filter((sample) => sample.tier === 'invalid'),
    diverged: run.errorSample.filter((sample) => sample.tier === 'diverged'),
    deferred: run.errorSample.filter((sample) => sample.tier === 'skipped'),
    refused: run.errorSample.filter(
      (sample) =>
        sample.tier !== 'invalid' && sample.tier !== 'diverged' && sample.tier !== 'skipped'
    ),
  }
}

const TONE_VARIANT: Record<'neutral' | 'warn' | 'alarm', 'neutral' | 'warning' | 'destructive'> = {
  neutral: 'neutral',
  warn: 'warning',
  alarm: 'destructive',
}

/** A bordered block in the section's own vocabulary. `alarm` is only for a fault. */
function ReportCard({
  tone,
  icon,
  title,
  children,
}: {
  tone: 'neutral' | 'warn' | 'alarm'
  icon: ReactNode
  title: string
  children: ReactNode
}) {
  return (
    <Alert variant={TONE_VARIANT[tone]}>
      {/* A direct child, not nested in the title: the gutter column is opened by
          `has-[>svg]`, which only sees the Alert's own children. */}
      {icon}
      <AlertTitle>{title}</AlertTitle>
      {children}
    </Alert>
  )
}

/**
 * Everything the current or last run found, under the provider rows.
 *
 * Order is deliberate: what the run is worth reading as comes FIRST (a walk that
 * stopped early makes every number under it a partial answer), then what came
 * across, then the two lists a person has to act on.
 */
export function ProviderSyncReport({
  currentRun,
  lastRun,
  stale,
  providerLabel,
  className,
}: ProviderSyncReportProps) {
  // A stale open run is history, not progress - `describeProviderSyncRun` says
  // why - so the detail below it is read off the run that is actually stopped.
  const run = currentRun && !stale ? currentRun : (currentRun ?? lastRun)
  if (!run) return null

  const { unbalanced, refused, diverged, deferred } = splitErrorSample(run)
  // The counter is the fallback for a run recorded before the samples carried
  // the months; it is the only number available on one of those.
  const deferredCount = deferred.length || (run.counters.deferred ?? 0)
  const reversed = run.counters.reversed ?? 0

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* ── 1. What came across ─────────────────────────────────────────── */}
      <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
        <Figure
          label='Written'
          value={run.counters.created}
          hint='Entries your accountant authored'
        />
        <Figure
          label='Already there'
          value={run.counters.skipped}
          hint='Held from an earlier run'
        />
        <Figure label='Reversed' value={reversed} hint={`Gone from ${providerLabel}, backed out`} />
        <Figure label='Months read' value={run.pagesProcessed} hint='One provider call each' />
      </div>

      {run.rateLimitWaitMs > 0 && (
        <p className='text-muted-foreground text-xs'>
          <Clock className='mr-1 inline size-3' />
          {elapsedLabel(run.rateLimitWaitMs)} of this run was spent waiting on {providerLabel}'s
          rate limit. Nothing was lost to it - the walk holds its place and reads the same month
          again.
        </p>
      )}

      {/* ── 2. What was refused. Every one of them, verbatim ─────────────── */}
      {refused.length > 0 && (
        <ReportCard
          tone='alarm'
          icon={<TriangleAlert className='size-4' />}
          title={`${refused.length} ${refused.length === 1 ? 'entry was' : 'entries were'} refused and are NOT in your books`}>
          <ul className='flex list-disc flex-col gap-1.5 pl-5 text-sm'>
            {refused.map((sample) => (
              <li key={`${sample.externalId}-${sample.error}`}>{sample.error}</li>
            ))}
          </ul>
        </ReportCard>
      )}

      {/*
        Also "did not come across", and for the one reason that is never
        negotiable: an unbalanced entry in the ledger is worse than a missing
        one, because it silently breaks every statement that ties. Listed
        separately from the refusals because the remedy is on their side.
      */}
      {unbalanced.length > 0 && (
        <ReportCard
          tone='alarm'
          icon={<CircleAlert className='size-4' />}
          title={`${unbalanced.length} ${unbalanced.length === 1 ? 'entry does' : 'entries do'} not balance in ${providerLabel}`}>
          <p className='text-sm text-muted-foreground'>
            Never written. An entry whose debits and credits disagree would break every statement
            that ties, so it is left where it is and named here instead.
          </p>
          <ul className='flex flex-col gap-1 text-sm'>
            {unbalanced.map((sample) => (
              <li key={sample.externalId} className='flex flex-wrap items-center gap-x-2'>
                <Badge variant='outline' size='xs'>
                  {sample.externalId}
                </Badge>
                <span className='text-muted-foreground'>{sample.error}</span>
              </li>
            ))}
          </ul>
        </ReportCard>
      )}

      {/*
        ── 3. What no longer matches ─────────────────────────────────────
        🛑 Nothing failed here, which is why it needs saying out loud: an entry
        auxx authored has been edited or deleted in the provider, and every
        other path in this feature keys on authorship and so cannot see it.
        Reported and left alone - repairing it would give one entry two authors.
      */}
      {diverged.length > 0 && (
        <ReportCard
          tone='warn'
          icon={<Unlink className='size-4' />}
          title={`${diverged.length} ${diverged.length === 1 ? 'entry you' : 'entries you'} authored no longer ${diverged.length === 1 ? 'matches' : 'match'} ${providerLabel}`}>
          <p className='text-sm text-muted-foreground'>
            These were exported from here, and the copy in {providerLabel} has changed since.
            Nothing is altered on either side: an entry has one author, and deciding which version
            wins would give this one two. Both versions are named below so a person can settle it.
          </p>
          <ul className='flex flex-col gap-1 text-sm'>
            {diverged.map((sample) => (
              <li
                key={`${sample.externalId}-${sample.error}`}
                className='flex flex-wrap items-center gap-x-2'>
                <Badge variant='outline' size='xs'>
                  {sample.externalId}
                </Badge>
                <span className='text-muted-foreground'>{sample.error}</span>
              </li>
            ))}
          </ul>
        </ReportCard>
      )}

      {/* ── 4. What is waiting on a person ──────────────────────────────── */}
      {deferredCount > 0 && (
        <ReportCard
          tone='warn'
          icon={<Lock className='size-4' />}
          title={`${deferredCount} ${deferredCount === 1 ? 'entry is' : 'entries are'} waiting on a closed month`}>
          <p className='text-sm text-muted-foreground'>
            This is the ordinary case, not a fault: December's adjusting entry arriving in February.
            The sync reopens nothing on its own. Somebody holding ledger control has to reopen the
            month and then run this again, which keeps the reopen in the audit log next to a person.
          </p>
          {deferred.length > 0 && (
            <ul className='flex flex-col gap-1 text-sm'>
              {deferred.map((sample) => (
                <li
                  key={`${sample.externalId}-${sample.error}`}
                  className='flex flex-wrap items-center gap-x-2'>
                  <Badge variant='outline' size='xs'>
                    {sample.externalId}
                  </Badge>
                  <span className='text-muted-foreground'>{sample.error}</span>
                </li>
              ))}
            </ul>
          )}
        </ReportCard>
      )}
    </div>
  )
}

/** One count, with what it counts. A bare number here is a number nobody can act on. */
function Figure({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className='flex flex-col gap-0.5 rounded-lg border border-border bg-muted/40 p-3'>
      <span className='font-medium text-lg tabular-nums'>{value}</span>
      <span className='text-xs'>{label}</span>
      <span className='text-[11px] text-muted-foreground leading-tight'>{hint}</span>
    </div>
  )
}
