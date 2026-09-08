// apps/web/src/components/dashboard/ui/dashboard-kopilot-turn-review.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { formatRelativeTime } from '@auxx/utils'
import { useCallback, useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { useOrgChannel } from '~/realtime/hooks'
import { api } from '~/trpc/react'

/** How the turn ended, as stamped on the pre-turn snapshot. `null` ⇒ not recorded. */
type DashboardTurnEnding = 'exhausted' | 'aborted' | 'error'

/**
 * "Kopilot's last turn stopped early — Undo or Dismiss", pinned above the
 * canvas (plan v3/04 §8).
 *
 * WHY A BANNER AND NOT A CARD IN THE CHAT. The review is about the CONTENT the
 * user is looking at, exactly as KB's Keep/Undo bar sits above the article
 * body. It is also not an `auxx:*` block: those are LLM-authored fences, and
 * the model cannot author this one, because the turn is abandoned by the ENGINE
 * after the agent has already streamed its reply. At the moment the offer
 * becomes true there is no model left to write it.
 *
 * WHY IT RUNS AS A QUERY ON MOUNT rather than off a remembered turn id. The
 * outcome that most often leaves a revertible snapshot is `aborted`, and
 * `aborted` IS a page reload or a navigate-away, so the most common case for
 * this offer is precisely the one where this component never saw the `ended`
 * event. `dashboard.kopilotTurnReview` derives the turn from the snapshot slot
 * server-side, so the offer survives a refresh. The org-channel subscription
 * below is only for liveness, so a turn that ends in front of the user raises
 * the banner without waiting for a refetch.
 *
 * WHAT MAKES A REVIEW PENDING: the pre-turn snapshot's existence. The
 * dashboard-builder capability never reverts automatically and finalises only
 * on a COMPLETED turn (plan v3/03 §3), so a surviving snapshot means exactly
 * one thing: the last turn wrote to the draft and then stopped early. The work
 * it did is kept either way; this only offers to take it back.
 */
export function DashboardKopilotTurnReview({
  dashboardId,
  canEdit,
}: {
  dashboardId: string
  /** The Undo rewrites the draft; a viewer is not shown an offer it cannot take. */
  canEdit: boolean
}) {
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  const [dismissedTurnId, setDismissedTurnId] = useState<string | null>(null)
  const [refusalMessage, setRefusalMessage] = useState<string | null>(null)

  const reviewQuery = api.dashboard.kopilotTurnReview.useQuery(
    { dashboardId },
    // `retry: false` so a failed read settles on "no review" rather than
    // holding a phantom banner through three backed-off attempts.
    { enabled: canEdit, retry: false, staleTime: 10_000 }
  )
  const review = reviewQuery.data ?? null
  // `canEdit` gates the render as well as the query. The query being disabled
  // is not on its own proof of nothing to show: React Query still serves a
  // cached entry, so a member whose access is downgraded while the page is open
  // would keep an Undo button that 403s.
  const visible = canEdit && !!review && review.turnId !== dismissedTurnId

  // Liveness. A turn ENDING is the moment a review can appear; a draft write
  // after it is what turns a takeable offer into a refusable one. Not polled:
  // the page is already on the org channel for the canvas lock.
  useOrgChannel({
    onEvent: (event, payload) => {
      if (event !== 'dashboard:kopilot-turn' && event !== 'dashboard:draft-updated') return
      const data = (payload ?? {}) as { dashboardId?: string; phase?: string }
      if (data.dashboardId !== dashboardId || !canEdit) return
      // Every mutation of a RUNNING turn also publishes `draft-updated`, and the
      // query answers null for as long as that turn holds the lock, so only the
      // boundary is worth a refetch.
      if (event === 'dashboard:kopilot-turn' && data.phase !== 'ended') return
      void utils.dashboard.kopilotTurnReview.invalidate({ dashboardId })
    },
  })

  const revertTurn = api.dashboard.revertKopilotTurn.useMutation()

  const handleUndo = useCallback(async () => {
    if (!review) return
    // Undoing throws away every widget the turn created in one write, and the
    // dashboard's own version history only reaches as far as the last publish,
    // so this asks first.
    const confirmed = await confirm({
      title: 'Undo that turn?',
      description:
        'The dashboard is restored exactly as it was before Kopilot’s last turn. Anything ' +
        'that turn added, removed or reconfigured is discarded.',
      confirmText: 'Undo turn',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!confirmed) return

    setRefusalMessage(null)
    try {
      // The `turnId` the query handed us, never one re-derived at click time: a
      // banner left up across a NEWER turn must fail rather than revert work
      // the user never saw. `revertDashboardTurn` re-checks it against the slot.
      await revertTurn.mutateAsync({ dashboardId, turnId: review.turnId })
      await utils.dashboard.get.invalidate({ id: dashboardId })
    } catch (error) {
      // TWO REFUSALS, TWO SENTENCES. They are not the same statement and must
      // never share one message:
      //
      //  - 409, the dashboard moved on since the turn. The snapshot is LEFT IN
      //    PLACE, so the offer survives and the banner carries the reason.
      //  - 404, the snapshot is gone (a later turn superseded the slot, a
      //    manual save cleared it, the 24h TTL expired). The offer is dead, so
      //    it goes to a toast and the banner comes down.
      const code = (error as { data?: { code?: string } } | null)?.data?.code
      if (code === 'CONFLICT') {
        setRefusalMessage(
          'The dashboard changed since that turn, so undoing now would also discard the newer ' +
            'changes. Nothing was reverted.'
        )
        return
      }
      toastError({
        title: 'Nothing to undo',
        description:
          'That turn’s changes are no longer available to undo. Nothing on the dashboard was ' +
          'changed.',
      })
      setDismissedTurnId(review.turnId)
      return
    }
    setDismissedTurnId(review.turnId)
    void utils.dashboard.kopilotTurnReview.invalidate({ dashboardId })
  }, [confirm, review, revertTurn, dashboardId, utils])

  if (!visible || !review) return null

  return (
    <>
      <div className='flex shrink-0 flex-wrap items-center gap-3 border-b bg-primary-150 px-4 py-2 text-sm'>
        <span className='text-foreground'>
          {describeEnding(review.endedAs)} Its edits were kept: undoing restores the dashboard as it
          was {formatRelativeTime(new Date(review.capturedAt))},{' '}
          {describeDelta(review.currentWidgetCount, review.preTurnWidgetCount)}.
        </span>
        <div className='ml-auto flex items-center gap-2'>
          <Button variant='outline' size='xs' onClick={() => setDismissedTurnId(review.turnId)}>
            Dismiss
          </Button>
          <Button
            variant='outline'
            size='xs'
            loading={revertTurn.isPending}
            disabled={review.canvasChangedSinceTurn}
            onClick={() => void handleUndo()}>
            Undo Kopilot’s changes
          </Button>
        </div>
        {(refusalMessage !== null || review.canvasChangedSinceTurn) && (
          <p className='w-full text-xs text-destructive'>
            {refusalMessage ??
              'The dashboard changed since that turn, so undoing now would also discard the ' +
                'newer changes.'}
          </p>
        )}
      </div>
      <ConfirmDialog />
    </>
  )
}

/**
 * Why the turn stopped, in the only vocabulary the snapshot can prove. The
 * capability's turn-end hook is handed the engine's four-way `TurnOutcome`, so
 * the honest ceiling is THREE states, and `exhausted` covers the token budget,
 * the iteration cap, the approval cap and the tool-failure streak alike.
 *
 * `null` — a snapshot from before the field existed, a turn that died before
 * its turn-end hook ran, or a stamp whose Redis write failed — falls back to
 * generic wording. It must never withhold the offer: losing the adjective is a
 * far smaller loss than losing the Undo.
 */
function describeEnding(endedAs: DashboardTurnEnding | null): string {
  switch (endedAs) {
    case 'exhausted':
      return 'Kopilot’s last turn ran out of room before it finished.'
    // Not a stop button, there isn’t one: this is a client disconnect, a reload
    // or navigating away mid-turn. It is also the most common way a snapshot
    // survives, which is why this banner has to work on a cold page load.
    case 'aborted':
      return 'Kopilot’s last turn was interrupted before it finished.'
    case 'error':
      return 'Kopilot’s last turn hit an error before it finished.'
    default:
      return 'Kopilot’s last turn stopped early.'
  }
}

/**
 * What an undo would cost, in the only unit the snapshot can prove: it stores
 * the pre-turn DOCUMENT, not a tool-call log, so "twelve edits were applied" is
 * not derivable from it.
 */
function describeDelta(currentWidgetCount: number, preTurnWidgetCount: number): string {
  if (currentWidgetCount === preTurnWidgetCount) {
    return `still ${currentWidgetCount} ${plural(currentWidgetCount, 'widget')} with their earlier configuration`
  }
  return `taking it from ${currentWidgetCount} ${plural(currentWidgetCount, 'widget')} back to ${preTurnWidgetCount}`
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`
}
