// apps/web/src/components/accounting/hooks/use-ledger-entry-actions.ts

'use client'

import type { EntryPreview, PostResult, PostResultStatus } from '@auxx/lib/postings/client'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '~/trpc/react'

/**
 * The statuses that mean a `GlPosting` row now exists for the month.
 *
 * 🛑 Five of them, not one. `not_connected` and `disabled` are first-class
 * successes under decision `P1` - the entry is built, balanced and persisted
 * identically, there is simply nowhere to push it - and `already_posted` and
 * `healed` are converged re-runs. Treating any of the five as a failure is the
 * single most common way this screen could be got wrong.
 *
 * Everything else (`period_closed`, `account_unmapped`, `unbalanced`,
 * `nothing_to_close`, `setup_incomplete`, `error`) wrote nothing, and all six
 * arrive as an ordinary result the callout renders. Only `error` is a fault.
 */
const POSTED_STATUSES = new Set<PostResultStatus>([
  'posted',
  'already_posted',
  'healed',
  'not_connected',
  'disabled',
])

interface UseLedgerEntryActionsOptions {
  periodKey: string
  /**
   * The posting `runReverse` acts on: the posting open in the drawer if there is
   * one, else the month's effective entry from the period model. `null` when the
   * month has never been posted, which is when Reverse is not offered at all.
   */
  glPostingId?: string | null
  /**
   * Build the preview for this month on mount. False while setup is a draft or
   * the month is already posted - in both cases the screen has something else to
   * render and a preview would be a wasted round trip.
   */
  enabled?: boolean
}

export interface LedgerEntryActions {
  /** `null` until the first preview resolves, and whenever the month changes. */
  preview: EntryPreview | null
  postResult: PostResult | null
  isPreviewing: boolean
  isPosting: boolean
  isReversing: boolean
  /** True once this session posted the month, so Post stops offering itself. */
  justPosted: boolean
  runPreview: () => void
  runPost: () => void
  runReverse: (memo: string) => void
  clearPostResult: () => void
}

/**
 * Preview / Post / Reverse for one month, against the real ledger procedures.
 *
 * 🛑 A refusal is NOT an error. `previewMonthEnd` returns every refusal on
 * `EntryPreview.blockedBy` and `postMonthEnd` returns one as a `PostResult`
 * status; neither ever throws for a business outcome. So `onError` here fires
 * only for a genuine transport or 500 failure, and that is the only path that
 * raises a toast. Routing `not_connected`, `already_posted`, `disabled`,
 * `nothing_to_close` or `setup_incomplete` through an error channel would train
 * everyone to ignore the channel a real double-post would arrive on.
 *
 * ⚠️ The preview is fired from an effect rather than a query because
 * `previewMonthEnd` is a mutation. It is a mutation for the reason
 * `ledger.preview` is - it is not usefully cacheable and the answer is the
 * input - and it persists nothing, so running it on arrival is safe. The ref
 * guard keeps it to exactly one call per month.
 */
export function useLedgerEntryActions({
  periodKey,
  glPostingId,
  enabled = true,
}: UseLedgerEntryActionsOptions): LedgerEntryActions {
  const utils = api.useUtils()
  const previewMonth = api.ledger.previewMonthEnd.useMutation()
  const postMonth = api.ledger.postMonthEnd.useMutation()
  const reversePosting = api.ledger.reverse.useMutation()

  const [postResult, setPostResult] = useState<PostResult | null>(null)
  const [justPosted, setJustPosted] = useState(false)

  // A new month clears whatever the previous one's buttons produced. Adjusted
  // during render rather than in an effect: an effect would paint the previous
  // month's post result for one frame.
  const [lastPeriodKey, setLastPeriodKey] = useState(periodKey)
  if (lastPeriodKey !== periodKey) {
    setLastPeriodKey(periodKey)
    setPostResult(null)
    setJustPosted(false)
  }

  const previewMutate = previewMonth.mutate
  const requestedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled || !periodKey) return
    if (requestedRef.current === periodKey) return
    requestedRef.current = periodKey
    previewMutate({ periodKey })
  }, [enabled, periodKey, previewMutate])

  /** Everything the books-level reads show changes the moment a month lands. */
  const refreshBooks = useCallback(() => {
    void utils.ledger.periods.invalidate()
    void utils.ledger.unpostedPeriods.invalidate()
    void utils.ledger.verifyBalance.invalidate()
  }, [utils])

  const runPreview = useCallback(() => {
    if (!periodKey) return
    requestedRef.current = periodKey
    previewMutate(
      { periodKey },
      {
        onError: (error) =>
          toastError({ title: 'Could not build the entry', description: error.message }),
      }
    )
  }, [periodKey, previewMutate])

  const postMutate = postMonth.mutate
  const runPost = useCallback(() => {
    if (!periodKey) return
    postMutate(
      { periodKey },
      {
        // 🛑 Every business refusal arrives HERE, on `result.status`, and is
        // rendered by the callout. Nothing in this branch is an error.
        onSuccess: (result) => {
          setPostResult(result)
          if (POSTED_STATUSES.has(result.status)) {
            setJustPosted(true)
            refreshBooks()
          }
        },
        onError: (error) =>
          toastError({ title: 'The post could not be sent', description: error.message }),
      }
    )
  }, [periodKey, postMutate, refreshBooks])

  const reverseMutate = reversePosting.mutate
  const runReverse = useCallback(
    (memo: string) => {
      if (!glPostingId) return
      reverseMutate(
        { glPostingId, memo: memo.trim() || undefined },
        {
          onSuccess: (result) => {
            setPostResult(result)
            if (POSTED_STATUSES.has(result.status)) {
              setJustPosted(false)
              requestedRef.current = null
              refreshBooks()
              void utils.ledger.get.invalidate({ id: glPostingId })
            }
          },
          onError: (error) =>
            toastError({ title: 'The reversal could not be sent', description: error.message }),
        }
      )
    },
    [glPostingId, refreshBooks, reverseMutate, utils]
  )

  const clearPostResult = useCallback(() => setPostResult(null), [])

  // The mutation's own cache is the source of truth, filtered by month so a
  // stale answer can never be painted against the wrong period.
  const previewData = previewMonth.data
  const preview = previewData && previewData.periodKey === periodKey ? previewData : null

  return {
    preview,
    postResult,
    isPreviewing: previewMonth.isPending,
    isPosting: postMonth.isPending,
    isReversing: reversePosting.isPending,
    justPosted,
    runPreview,
    runPost,
    runReverse,
    clearPostResult,
  }
}
