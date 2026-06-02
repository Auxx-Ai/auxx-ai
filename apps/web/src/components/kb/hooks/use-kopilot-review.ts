// apps/web/src/components/kb/hooks/use-kopilot-review.ts
'use client'

import { diffBlocks } from '@auxx/lib/kb/blocks'
import { toastError } from '@auxx/ui/components/toast'
import { useMemo } from 'react'
import { api } from '~/trpc/react'

interface UseKopilotReviewArgs {
  articleId: string
  /** Current draft body — the diff's "after" side; the snapshot supplies "before". */
  draftContentJson: unknown[] | null | undefined
  /** True while Kopilot holds the write lock — the banner stays hidden mid-turn. */
  locked: boolean
}

interface KopilotReview {
  /** Show the turn-review banner: a snapshot is pending and we're not mid-turn. */
  pending: boolean
  /** Number of changed top-level blocks (added + removed + modified + moved). */
  changeCount: number
  /** Commit the turn — clears the snapshot, removes the Undo affordance. */
  onKeep: () => Promise<void>
  /** Roll the article back to the pre-turn snapshot. */
  onUndo: () => Promise<void>
  /** A Keep/Undo mutation is in flight. */
  isBusy: boolean
}

/**
 * Surfaces a pending Kopilot turn review for the editor banner. The recovery
 * query (`getKopilotTurnReview`) is the source of truth — it runs on mount (so
 * a review survives refresh) and is invalidated by `useKbArticleChannel` on
 * each lock event for liveness. Keep/Undo clear the snapshot, then refresh the
 * query so the banner disappears.
 */
export function useKopilotReview({
  articleId,
  draftContentJson,
  locked,
}: UseKopilotReviewArgs): KopilotReview {
  const utils = api.useUtils()
  const reviewQuery = api.kb.getKopilotTurnReview.useQuery({ articleId }, { enabled: !!articleId })
  const review = reviewQuery.data ?? null

  const changeCount = useMemo(() => {
    if (!review) return 0
    const { added, removed, modified, moved } = diffBlocks(
      review.base,
      (draftContentJson ?? []) as Parameters<typeof diffBlocks>[1]
    ).stats
    return added + removed + modified + moved
  }, [review, draftContentJson])

  const undo = api.kb.revertKopilotTurn.useMutation()
  const keep = api.kb.keepKopilotTurn.useMutation()

  const refresh = () => void utils.kb.getKopilotTurnReview.invalidate({ articleId })

  const onUndo = async () => {
    if (!review) return
    const result = await undo.mutateAsync({ articleId, turnId: review.turnId })
    // ok → the revert's resync repaints the editor and clears the snapshot;
    // not ok (e.g. snapshot expired past the 24h TTL) → nothing to undo.
    if (!result.ok) {
      toastError({
        title: 'Could not undo',
        description: 'These changes are no longer available to undo.',
      })
    }
    refresh()
  }

  const onKeep = async () => {
    if (!review) return
    await keep.mutateAsync({ articleId, turnId: review.turnId })
    refresh()
  }

  return {
    pending: !!review && !locked,
    changeCount,
    onKeep,
    onUndo,
    isBusy: undo.isPending || keep.isPending,
  }
}
