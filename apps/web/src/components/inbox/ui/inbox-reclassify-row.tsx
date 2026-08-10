// apps/web/src/components/inbox/ui/inbox-reclassify-row.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Progress } from '@auxx/ui/components/progress'
import { toastError } from '@auxx/ui/components/toast'
import { useState } from 'react'
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

  const state = status.data?.state
  const running = state === 'waiting' || state === 'active' || state === 'delayed'
  const report = state === 'completed' ? status.data?.report : undefined
  const count = backlog.data?.count ?? 0
  const capped = backlog.data?.capped ?? false

  // Nothing to catch up on and nothing in flight — the row is a standing
  // affordance, not a permanent fixture.
  if (!running && !report && count === 0) return null

  const processed = status.data?.processed ?? 0
  const total = status.data?.total ?? 0
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0

  return (
    <>
      <div className='mt-3 rounded-xl border px-3 py-2.5'>
        <div className='flex items-center justify-between gap-3'>
          <div className='min-w-0 space-y-0.5'>
            {running ? (
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

          {running ? (
            <Button
              variant='outline'
              size='sm'
              loading={cancelSample.isPending}
              loadingText='Stopping...'
              onClick={() => cancelSample.mutate({ inboxId })}>
              Cancel
            </Button>
          ) : (
            <Button variant='outline' size='sm' onClick={() => setDialogOpen(true)}>
              {report ? 'View results' : 'Classify…'}
            </Button>
          )}
        </div>

        {running ? <Progress value={pct} className='mt-2' /> : null}
      </div>

      <InboxReclassifyDialog inboxId={inboxId} open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  )
}
