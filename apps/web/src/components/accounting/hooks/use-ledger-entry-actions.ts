// apps/web/src/components/accounting/hooks/use-ledger-entry-actions.ts

'use client'

import type { EntryPreview, PostResult, PostResultStatus } from '@auxx/lib/postings/client'
import { didLedgerAccept } from '@auxx/lib/postings/client'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useEffect, useState } from 'react'
import { api } from '~/trpc/react'

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
 * 🛑 The preview is a QUERY keyed on the month, not a mutation fired from a
 * mount effect. `previewMonthEnd` reads only, so React Query can own it: the
 * month on screen is the key, arriving on a month fetches it, and Rebuild is a
 * `refetch`. The effect-fires-a-mutation shape this replaces had one failure
 * mode with no way out - React Query's `MutationObserver` detaches itself from
 * a pending mutation the moment it loses its last listener and NEVER re-attaches
 * (there is no `onSubscribe` counterpart to its `onUnsubscribe`). Any mount that
 * subscribes, fires, unsubscribes and resubscribes - which is every mount under
 * `reactStrictMode` once `ledger.periods` is already cached, so every soft
 * navigation back to the ledger - left the observer frozen at `isPending: true`.
 * The request came back 200 and nothing on screen ever heard about it: the
 * Entries section sat on "Building..." until a full page reload.
 */
export function useLedgerEntryActions({
  periodKey,
  glPostingId,
  enabled = true,
}: UseLedgerEntryActionsOptions): LedgerEntryActions {
  const utils = api.useUtils()
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

  /**
   * ⚠️ `refetchOnWindowFocus` is off deliberately. A preview is a full gather of
   * the month's subledger; re-running it every time the tab regains focus is an
   * expensive answer to a question nobody asked. Arriving on the month and the
   * Rebuild button are the two things that should cost one.
   */
  const previewQuery = api.ledger.previewMonthEnd.useQuery(
    { periodKey },
    { enabled: enabled && !!periodKey, refetchOnWindowFocus: false }
  )

  /**
   * 🛑 A failure has to be said out loud. Every business refusal arrives on
   * `EntryPreview.blockedBy` and is rendered by the screen, so an error here is
   * only ever a genuine transport or 500 failure - the one outcome that has no
   * other way to reach anybody.
   */
  const previewError = previewQuery.error
  useEffect(() => {
    if (!previewError) return
    toastError({ title: 'Could not build the entry', description: previewError.message })
  }, [previewError])

  /** Everything the books-level reads show changes the moment a month lands. */
  const refreshBooks = useCallback(() => {
    void utils.ledger.periods.invalidate()
    void utils.ledger.failedExports.invalidate()
    void utils.ledger.verifyBalance.invalidate()
  }, [utils])

  const refetchPreview = previewQuery.refetch
  const runPreview = useCallback(() => {
    if (!periodKey) return
    void refetchPreview()
  }, [periodKey, refetchPreview])

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
          if (didLedgerAccept(result)) {
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
            if (didLedgerAccept(result)) {
              setJustPosted(false)
              // A reversed month is an open month again, so the projection it
              // renders has to be rebuilt rather than kept.
              void utils.ledger.previewMonthEnd.invalidate()
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

  // The query is keyed on the month, so a stale answer cannot be painted against
  // the wrong period: switching months switches keys and `data` is `undefined`
  // until that month's own answer lands.
  const preview = previewQuery.data ?? null

  return {
    preview,
    postResult,
    // 🛑 `isFetching`, not `isPending`. A DISABLED query sits at
    // `isPending: true` forever - the checklist state and every posted month
    // disable this one - and reading that would put "Building..." on screen for
    // a preview that was never asked for.
    isPreviewing: previewQuery.isFetching,
    isPosting: postMonth.isPending,
    isReversing: reversePosting.isPending,
    justPosted,
    runPreview,
    runPost,
    runReverse,
    clearPostResult,
  }
}
