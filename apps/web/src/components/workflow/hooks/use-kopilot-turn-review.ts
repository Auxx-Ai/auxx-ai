// apps/web/src/components/workflow/hooks/use-kopilot-turn-review.ts

'use client'

import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useState } from 'react'
import { useOrgChannel } from '~/realtime/hooks'
import { api } from '~/trpc/react'

/**
 * How the turn ended, as stamped on the pre-turn snapshot. Mirrors the server's
 * `WorkflowTurnEnding` (`@auxx/lib/workflows/graph-edit`) rather than importing
 * it: that barrel is SERVER-ONLY (Redis + the persist seam) and has no `/client`
 * subpath, so importing it here would pull server deps into the bundle.
 *
 * `null` means "not recorded" — see {@link KopilotTurnReview.endedAs}.
 */
export type KopilotTurnEnding = 'exhausted' | 'aborted' | 'error'

interface UseKopilotTurnReviewArgs {
  /** WorkflowApp id — the snapshot slot is keyed to it. Undefined before init. */
  workflowAppId: string | undefined
}

export interface KopilotTurnReview {
  /** Show the turn-review banner: a snapshot is pending for a turn that ended. */
  pending: boolean
  /** Nodes on the canvas immediately before the turn's first write. */
  preTurnNodeCount: number
  /** Nodes on the draft now — what the stopped turn left behind. */
  currentNodeCount: number
  /** When the turn's first write happened (ms epoch). */
  capturedAt: number
  /**
   * How the turn ended — what lets the banner say WHY it stopped instead of
   * only that it did. `null` when the snapshot carries no ending (captured
   * before the field existed, the turn died before its turn-end hook ran, or
   * the stamp's Redis write failed); the banner falls back to generic wording
   * and the offer stands. Absence must never suppress the Undo.
   */
  endedAs: KopilotTurnEnding | null
  /** Commit the turn — clears the snapshot, removes the Undo affordance. */
  onKeep: () => Promise<void>
  /** Roll the draft back to the pre-turn graph. Confirm first — it is destructive. */
  onUndo: () => Promise<void>
  /** A Keep/Undo mutation is in flight. */
  isBusy: boolean
  /**
   * The server's verbatim explanation of a refused Undo that left the offer
   * ALIVE (409 — the canvas moved on since the turn, or a save raced the
   * revert). Rendered on the banner rather than toasted, because the banner is
   * still there and the message is the reason it still is.
   */
  refusalMessage: string | null
}

/**
 * Surfaces a pending Kopilot turn review for the builder banner — the workflow
 * twin of `~/components/kb/hooks/use-kopilot-review.ts`, deliberately the same
 * shape (recovery query + Keep/Undo + `pending`).
 *
 * `workflow.getKopilotTurnReview` is the source of truth. It runs on mount, so
 * a review survives a refresh (the agent's SSE stream does not, and it never
 * carried a `turnId` to begin with), and it is invalidated on the org channel's
 * turn boundary for liveness.
 *
 * WHAT MAKES A REVIEW PENDING: the pre-turn snapshot's existence. After plan 20
 * phase A the workflow-builder capability never reverts automatically and only
 * finalizes on a COMPLETED turn, so a surviving snapshot means exactly one
 * thing — the last turn wrote to the draft and then stopped early. Unlike KB,
 * which keeps its snapshot on every outcome and reviews every turn, this banner
 * appears ONLY for a turn that did not finish.
 *
 * The two node counts are what the offer can honestly prove. The snapshot
 * stores the pre-turn graph, not a tool-call log, so plan 20's "12 edits were
 * applied" is still not derivable. WHY it stopped is: `endedAs` is stamped onto
 * the snapshot by the capability's turn-end hook, from the engine's own
 * classification of the terminal event — three states (`exhausted` / `aborted` /
 * `error`), never the five-way `TurnErrorReason`, because the capability
 * lifecycle is only handed the outcome. The banner says what that proves and
 * nothing more.
 */
export function useKopilotTurnReview({
  workflowAppId,
}: UseKopilotTurnReviewArgs): KopilotTurnReview {
  const utils = api.useUtils()
  const [refusalMessage, setRefusalMessage] = useState<string | null>(null)

  const reviewQuery = api.workflow.getKopilotTurnReview.useQuery(
    { workflowAppId: workflowAppId ?? '' },
    // `retry: false` so a failed read settles on "no review" rather than
    // holding a phantom banner through three backed-off attempts.
    { enabled: !!workflowAppId, retry: false, staleTime: 10_000 }
  )
  const review = reviewQuery.data ?? null

  const refresh = useCallback(() => {
    if (!workflowAppId) return
    void utils.workflow.getKopilotTurnReview.invalidate({ workflowAppId })
  }, [utils, workflowAppId])

  /**
   * A turn ending is the moment a review can appear; a `system` draft write is
   * the revert itself landing. Not polled — the builder is already on the org
   * channel for the canvas edit lock.
   *
   * Every mutation of a RUNNING turn also publishes `workflow:draft-updated`,
   * and the query answers null for as long as that turn holds the lock, so only
   * the boundary is worth a refetch.
   */
  useOrgChannel({
    onEvent: (event, payload) => {
      if (event !== 'workflow:kopilot-turn' && event !== 'workflow:draft-updated') return
      const data = (payload ?? {}) as { workflowAppId?: string; phase?: string }
      if (!workflowAppId || data.workflowAppId !== workflowAppId) return
      if (event === 'workflow:kopilot-turn' && data.phase !== 'ended') return
      refresh()
    },
  })

  const undo = api.workflow.revertKopilotTurn.useMutation()
  const keep = api.workflow.keepKopilotTurn.useMutation()

  const onUndo = useCallback(async () => {
    if (!workflowAppId || !review) return
    setRefusalMessage(null)
    try {
      // The `turnId` the query handed us, never one re-derived at click time: a
      // banner left up across a newer turn must fail, not revert a turn the
      // user never saw.
      await undo.mutateAsync({ workflowAppId, turnId: review.turnId })
    } catch (error) {
      // `revertWorkflowTurn` writes NOTHING on either refusal, and both
      // messages are authored server-side to be shown verbatim — so neither is
      // reworded here. They differ in whether the offer survives:
      //
      //  - 409 — the canvas moved on since the turn (post-turn hash mismatch),
      //    or a save raced the revert. The snapshot is LEFT IN PLACE, so the
      //    banner stays and carries the explanation.
      //  - 404 — the snapshot is gone (a manual canvas save cleared it, a later
      //    turn superseded the slot, the 24h TTL expired). The offer is dead,
      //    so it goes to a toast and the refresh below takes the banner away.
      const shape = error as { data?: { code?: string }; message?: string }
      const message = shape.message ?? 'These changes are no longer available to undo.'
      if (shape.data?.code === 'CONFLICT') {
        setRefusalMessage(message)
        return
      }
      toastError({ title: 'Could not undo', description: message })
    }
    refresh()
  }, [workflowAppId, review, undo, refresh])

  const onKeep = useCallback(async () => {
    if (!workflowAppId || !review) return
    setRefusalMessage(null)
    // Soft `{ ok, reason }` by design (matching `kb.keepKopilotTurn`): the only
    // failure is "there was nothing left to keep", which is indistinguishable
    // from success from the user's side.
    await keep.mutateAsync({ workflowAppId, turnId: review.turnId })
    refresh()
  }, [workflowAppId, review, keep, refresh])

  return {
    pending: !!review,
    preTurnNodeCount: review?.preTurnNodeCount ?? 0,
    currentNodeCount: review?.currentNodeCount ?? 0,
    capturedAt: review?.capturedAt ?? 0,
    endedAs: review?.endedAs ?? null,
    onKeep,
    onUndo,
    isBusy: undo.isPending || keep.isPending,
    refusalMessage,
  }
}
