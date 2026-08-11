// apps/web/src/components/inbox/ui/inbox-reclassify-row.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Progress } from '@auxx/ui/components/progress'
import { toastError } from '@auxx/ui/components/toast'
import { useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { InboxReclassifyDialog } from './inbox-reclassify-dialog'

/**
 * The backlog row on the AI classification card (07 §3.1).
 *
 * ## This row IS the discovery mechanism
 *
 * The classifier only ever sees mail as it arrives. A first-connect backfill
 * publishes no `message:received` at all, and mail that arrived before the inbox
 * was opted in exited at guard 3a — both leave a permanent hole with no
 * completion event left to hang a prompt on (07 §2.9). Two triggers were
 * considered; this is the first and the durable one:
 *
 * - it appears the instant the toggle is enabled, which is the moment of highest
 *   intent — the user just decided they want this inbox classified;
 * - it **persists**, unlike a dismissible prompt, so it cannot be dismissed into
 *   oblivion.
 *
 * ⚠️ And it is the WHOLE prompt: the cost dialog is never auto-opened on opt-in
 * (07 invariant 12). A dialog asking for money one click after a toggle reads as
 * a dark pattern.
 *
 * ## Composition
 *
 * No existing primitive is a "stat + action" row — `FieldPanelRow` is for forms,
 * `StatCard` is for dashboard metrics, `ListCard` is a grid tile. So this is a
 * plain bordered row matching `ToggleCard`'s `rounded-xl border px-3 py-2.5`
 * (`docs/ui-design-guide.md`, "When none of these fit").
 *
 * ⚠️ Deliberately NOT an `Alert`: this is a normal affordance, not a warning, and
 * the card already uses `Alert` directly above for the genuine
 * credits-exhausted warning (07 §3.1).
 *
 * While a sample is running the same row becomes the progress surface, with the
 * cancel that 07 §2.5 requires.
 */
export function InboxReclassifyRow({ inboxId }: { inboxId: string }) {
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  const [dialogOpen, setDialogOpen] = useState(false)

  const backlog = api.mailClassification.getBacklog.useQuery({ inboxId })

  // Same query key the dialog polls — one poll, and the two surfaces can never
  // disagree about whether a sample is running.
  const status = api.mailClassification.getReclassifySampleStatus.useQuery(
    { inboxId },
    {
      refetchInterval: (query) => {
        const state = query.state.data?.state
        return state === 'waiting' || state === 'active' || state === 'delayed' ? 2000 : false
      },
    }
  )

  const cancelSample = api.mailClassification.cancelReclassifySample.useMutation({
    onSuccess: (result) => {
      void utils.mailClassification.getReclassifySampleStatus.invalidate({ inboxId })
      // A queued sample is removed outright; one already mid-flight is not.
      // Saying nothing would leave a click that visibly did nothing, which reads
      // as broken — this is a refusal, not a success, so it is a toast.
      if (!result.removed) {
        toastError({
          title: 'The sample is already running',
          description:
            'It cannot be stopped mid-run, but it only classifies about 100 conversations and applies nothing.',
        })
      }
    },
    onError: (error) =>
      toastError({ title: 'Error stopping the sample', description: error.message }),
  })

  // The RUN, polled on the same cadence as the sample. Kept as its own query
  // rather than folded into one status endpoint: a sample and a run can each be
  // the last thing that happened, and collapsing them would make "which finished
  // last" decide what the user is told.
  const runStatus = api.mailClassification.getReclassifyRunStatus.useQuery(
    { inboxId },
    {
      refetchInterval: (query) => {
        const state = query.state.data?.state
        return state === 'waiting' || state === 'active' || state === 'delayed' ? 2000 : false
      },
    }
  )

  const cancelRun = api.mailClassification.cancelReclassifyRun.useMutation({
    onSuccess: (result) => {
      void utils.mailClassification.getReclassifyRunStatus.invalidate({ inboxId })
      if (!result.removed) {
        // ⚠️ Deliberately NOT "it cannot be stopped". An active run IS asked to
        // stop — it just finishes the thread it is on and reports, because the
        // report carries the undo key. Saying "cannot" would push someone toward
        // waiting it out when the stop already worked.
        toastError({
          title: 'Stopping after the current conversation',
          description:
            'The run finishes what it started so it can report what it changed, then stops. Everything it applied stays undoable.',
        })
      }
    },
    onError: (error) => toastError({ title: 'Error stopping the run', description: error.message }),
  })

  const undoRun = api.mailClassification.undoReclassifyRun.useMutation({
    onSuccess: () => {
      void utils.mailClassification.getReclassifyRunStatus.invalidate({ inboxId })
      void utils.mailClassification.getBacklog.invalidate({ inboxId })
    },
    onError: (error) => toastError({ title: 'Error undoing the run', description: error.message }),
  })

  const runState = runStatus.data?.state
  const runActive = runState === 'waiting' || runState === 'active' || runState === 'delayed'
  const runReport = runState === 'completed' ? runStatus.data?.report : undefined

  const state = status.data?.state
  const running = state === 'waiting' || state === 'active' || state === 'delayed'
  const report = state === 'completed' ? status.data?.report : undefined
  const count = backlog.data?.count ?? 0
  const capped = backlog.data?.capped ?? false

  // Nothing to catch up on and nothing in flight — the row is a standing
  // affordance, not a permanent fixture.
  if (!runActive && !runReport && !running && !report && count === 0) return null

  // A run outranks a sample everywhere below: it is the one that spent real money
  // and changed real data, so it is the one a user needs to see.
  const processed = (runActive ? runStatus.data?.processed : status.data?.processed) ?? 0
  const total = (runActive ? runStatus.data?.total : status.data?.total) ?? 0
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0
  const busy = runActive || running

  const handleUndo = async () => {
    if (!runReport) return
    const confirmed = await confirm({
      title: `Remove ${runReport.applied.toLocaleString()} applied ${runReport.applied === 1 ? 'category' : 'categories'}?`,
      description:
        'Conversations that also carry another category are left alone, because the AI is not necessarily the only thing that applied it. This does not refund the classification.',
      confirmText: 'Undo',
      cancelText: 'Keep them',
      destructive: true,
    })
    if (confirmed) undoRun.mutate({ inboxId, sinceIso: runReport.startedAtIso })
  }

  return (
    <>
      <div className='mt-3 rounded-xl border px-3 py-2.5'>
        <div className='flex items-center justify-between gap-3'>
          <div className='min-w-0 space-y-0.5'>
            {runActive ? (
              <p className='text-sm font-medium'>
                Applying categories: {processed.toLocaleString()} of {(total || 0).toLocaleString()}
                …
              </p>
            ) : runReport ? (
              <p className='text-sm font-medium'>
                {runReport.cancelled ? 'Run stopped — ' : 'Run finished: '}
                applied {runReport.applied.toLocaleString()} of{' '}
                {runReport.selected.toLocaleString()}
                {/* 07 invariant 8 — a capped run says what it capped. */}
                {runReport.capped > 0
                  ? `, ${runReport.capped.toLocaleString()} left over the per-run limit`
                  : ''}
              </p>
            ) : running ? (
              <p className='text-sm font-medium'>
                Classifying a sample: {processed.toLocaleString()} of{' '}
                {(total || 0).toLocaleString()}…
              </p>
            ) : report ? (
              <p className='text-sm font-medium'>
                Sample finished: {report.classified.toLocaleString()} of{' '}
                {report.selected.toLocaleString()} got a category
              </p>
            ) : (
              <p className='text-sm font-medium'>
                {/* 07 R-Q5 — `1,000+` past the cap. An order of magnitude for a
                    decision, not a billing figure. */}
                {count === 1 && !capped
                  ? '1 older conversation has never been classified'
                  : `${count.toLocaleString()}${capped ? '+' : ''} older conversations have never been classified`}
              </p>
            )}
            {/* ⚠️ 07 invariant 11 — REQUIRED, not decoration. "Classify existing
                mail" reads as "apply my automations to old mail" to most people,
                and the honest correction belongs at the point of action. */}
            <p className='text-xs text-muted-foreground'>
              Labels older mail for search and reporting. Your filters will not run on it.
            </p>
          </div>

          {busy ? (
            <Button
              variant='outline'
              size='sm'
              loading={runActive ? cancelRun.isPending : cancelSample.isPending}
              loadingText='Stopping...'
              onClick={() =>
                runActive ? cancelRun.mutate({ inboxId }) : cancelSample.mutate({ inboxId })
              }>
              Cancel
            </Button>
          ) : runReport ? (
            <div className='flex shrink-0 items-center gap-2'>
              {/* Undo is offered only while the report exists — the job is reaped
                  a day after it completes, and `startedAtIso` is the only scope
                  key undo has. An undo button with no key is worse than none. */}
              {runReport.applied > 0 ? (
                <Button
                  variant='ghost'
                  size='sm'
                  loading={undoRun.isPending}
                  loadingText='Undoing...'
                  onClick={handleUndo}>
                  Undo
                </Button>
              ) : null}
              <Button variant='outline' size='sm' onClick={() => setDialogOpen(true)}>
                Classify more…
              </Button>
            </div>
          ) : (
            <Button variant='outline' size='sm' onClick={() => setDialogOpen(true)}>
              {report ? 'View results' : 'Classify…'}
            </Button>
          )}
        </div>

        {busy ? <Progress value={pct} className='mt-2' /> : null}
      </div>
      <ConfirmDialog />

      <InboxReclassifyDialog inboxId={inboxId} open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  )
}
