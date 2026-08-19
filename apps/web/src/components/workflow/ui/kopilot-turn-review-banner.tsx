// apps/web/src/components/workflow/ui/kopilot-turn-review-banner.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { formatRelativeTime } from '@auxx/utils'
import { useCallback } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { type KopilotTurnEnding, useKopilotTurnReview } from '../hooks/use-kopilot-turn-review'

interface KopilotTurnReviewBannerProps {
  /** WorkflowApp id — the snapshot slot is keyed to it. Undefined before init. */
  workflowAppId: string | undefined
}

/**
 * "Kopilot's last turn stopped early — Keep or Undo" (plan 20 §5, phase D).
 *
 * WHY A BANNER ABOVE THE CANVAS, not a card in the chat. Two reasons, and the
 * second is decisive:
 *
 *  - the KB precedent. `kb.getKopilotTurnReview` backs a Keep/Undo bar pinned
 *    above the article body (`kb/ui/editor/article-editor.tsx`), not a message
 *    in the transcript, because the review is about the CONTENT the user is
 *    looking at. The canvas is this surface's article;
 *  - the builder's Kopilot frame is a peer overlay — popping the node
 *    properties, Test or Settings frame unmounts it. An offer that lived only
 *    there would be invisible exactly when the user is on the canvas wondering
 *    where their nodes went, and it has to stay reachable for 24h.
 *
 * It is also not an `auxx:*` block. Those are LLM-AUTHORED fences the model
 * embeds in its prose, and the model cannot author this one: the turn is
 * discarded by the ENGINE, after the agent has already finished and streamed
 * its reply, so at the moment the offer becomes true there is no model left to
 * write it.
 *
 * Mounted in `workflow-editor.tsx` beside the other once-per-editor hooks, for
 * the same reason `useWorkflowKopilotTurn` is: it must not depend on a drawer
 * being open.
 */
export function KopilotTurnReviewBanner({ workflowAppId }: KopilotTurnReviewBannerProps) {
  const review = useKopilotTurnReview({ workflowAppId })
  const [confirm, ConfirmDialog] = useConfirm()

  const handleUndo = useCallback(async () => {
    // KB's Undo has no confirm because its editor keeps a full version history
    // to walk back through. Undoing here throws away every node the turn
    // created in one write, so it asks.
    const confirmed = await confirm({
      title: 'Undo that turn?',
      description:
        'The workflow is restored exactly as it was before Kopilot’s last turn. ' +
        'Anything that turn added, removed or reconfigured is discarded.',
      confirmText: 'Undo turn',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!confirmed) return
    await review.onUndo()
  }, [confirm, review])

  if (!review.pending) return null

  return (
    <>
      <div className='flex flex-shrink-0 flex-wrap items-center gap-3 border-b bg-primary-150 px-7 py-2 text-sm'>
        <span className='text-foreground'>
          {describeEnding(review.endedAs)} Its edits were kept — undoing restores the workflow as it
          was {formatRelativeTime(new Date(review.capturedAt))},{' '}
          {describeDelta(review.currentNodeCount, review.preTurnNodeCount)}.
        </span>
        <div className='ml-auto flex items-center gap-2'>
          <Button variant='outline' size='xs' loading={review.isBusy} onClick={review.onKeep}>
            Keep
          </Button>
          <Button
            variant='outline'
            size='xs'
            loading={review.isBusy}
            onClick={() => void handleUndo()}>
            Undo
          </Button>
        </div>
        {review.refusalMessage && (
          <p className='w-full text-xs text-destructive'>{review.refusalMessage}</p>
        )}
      </div>
      <ConfirmDialog />
    </>
  )
}

/**
 * Why the turn stopped, in the only vocabulary the snapshot can prove. The
 * capability's turn-end hook is handed the engine's four-way `TurnOutcome`, not
 * the five-way `TurnErrorReason`, so the honest ceiling here is THREE states —
 * plan 20's literal "(token budget)" would be a claim the stored data cannot
 * back, and `exhausted` also covers the iteration cap, the approval cap and the
 * tool-failure streak.
 *
 * `null` — a snapshot from before the field existed, a turn that died before
 * its turn-end hook ran, or a stamp whose Redis write failed — falls back to
 * the wording this banner shipped with. It must never withhold the offer:
 * losing the adjective is a far smaller loss than losing the Undo.
 *
 * Each sentence is self-contained and ends in a full stop, because the copy
 * that follows it is fixed.
 */
function describeEnding(endedAs: KopilotTurnEnding | null): string {
  switch (endedAs) {
    // Resource caps — token budget, iteration cap, approval cap, failure
    // streak. All four mean the same thing to the user: the turn had more to do
    // and no room left to do it in.
    case 'exhausted':
      return 'Kopilot’s last turn ran out of room before it finished.'
    // Not a stop button — there isn’t one. This is a client disconnect: a page
    // reload or navigating away mid-turn.
    case 'aborted':
      return 'Kopilot’s last turn was interrupted before it finished.'
    case 'error':
      return 'Kopilot’s last turn hit an error before it finished.'
    default:
      return 'Kopilot’s last turn stopped early.'
  }
}

/**
 * What an undo would cost, in the only unit the snapshot can prove — it stores
 * the pre-turn GRAPH, not a tool-call log, so plan 20's "12 edits were applied"
 * is not derivable from it.
 */
function describeDelta(currentNodeCount: number, preTurnNodeCount: number): string {
  if (currentNodeCount === preTurnNodeCount) {
    return `still ${currentNodeCount} ${plural(currentNodeCount, 'node')} with their earlier configuration`
  }
  return `taking it from ${currentNodeCount} ${plural(currentNodeCount, 'node')} back to ${preTurnNodeCount}`
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`
}
