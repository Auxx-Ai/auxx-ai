// apps/web/src/components/accounting/hooks/use-ledger-entry-actions.ts

'use client'

import type { PostResult } from '@auxx/lib/postings/client'
import { didLedgerAccept } from '@auxx/lib/postings/client'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useState } from 'react'
import { api } from '~/trpc/react'

interface UseLedgerEntryActionsOptions {
  periodKey: string
  /**
   * The posting `runReverse` acts on: whichever one is open in the drawer.
   * `null` when nothing is open, which is when Reverse is not offered at all.
   */
  glPostingId?: string | null
}

export interface LedgerEntryActions {
  postResult: PostResult | null
  isReversing: boolean
  runReverse: (memo: string) => void
  clearPostResult: () => void
}

/**
 * Reverse, for whichever posting is on screen.
 *
 * 🛑 Preview and Post left with the month-end entry (MIGRATION step 5). A close
 * posts nothing, so there is nothing for this hook to build or claim; what a
 * month owes is `useMonthEndEntry`'s blocker list, and what an individual entry
 * can still have done to it is this.
 *
 * 🛑 A refusal is NOT an error. `ledger.reverse` returns a `PostResult` and
 * never throws for a business outcome, so `onError` fires only for a genuine
 * transport or 500 failure.
 */
export function useLedgerEntryActions({
  periodKey,
  glPostingId,
}: UseLedgerEntryActionsOptions): LedgerEntryActions {
  const utils = api.useUtils()
  const reversePosting = api.ledger.reverse.useMutation()

  const [postResult, setPostResult] = useState<PostResult | null>(null)

  // A new month clears whatever the previous one's buttons produced. Adjusted
  // during render rather than in an effect: an effect would paint the previous
  // month's result for one frame.
  const [lastPeriodKey, setLastPeriodKey] = useState(periodKey)
  if (lastPeriodKey !== periodKey) {
    setLastPeriodKey(periodKey)
    setPostResult(null)
  }

  /** Everything the books-level reads show changes the moment an entry moves. */
  const refreshBooks = useCallback(() => {
    void utils.ledger.periods.invalidate()
    void utils.ledger.exportBatches.invalidate()
    void utils.ledger.verifyBalance.invalidate()
    void utils.ledger.closeBlockers.invalidate()
  }, [utils])

  const reverseMutate = reversePosting.mutate
  const runReverse = useCallback(
    (memo: string) => {
      if (!glPostingId) return
      reverseMutate(
        { glPostingId, memo: memo.trim() || undefined },
        {
          onSuccess: (result) => {
            setPostResult(result)
            // 🛑 `reverse` returns a `PostResult` and never throws for a
            // refusal, so `onError` cannot carry one, and without this a refused
            // reversal looked like a button that did nothing.
            if (!didLedgerAccept(result)) {
              toastError({
                title: 'The entry was not reversed',
                description: result.error ?? 'It was refused.',
              })
              return
            }
            refreshBooks()
            void utils.ledger.get.invalidate({ id: glPostingId })
          },
          onError: (error) =>
            toastError({ title: 'The reversal could not be sent', description: error.message }),
        }
      )
    },
    [glPostingId, refreshBooks, reverseMutate, utils]
  )

  const clearPostResult = useCallback(() => setPostResult(null), [])

  return {
    postResult,
    isReversing: reversePosting.isPending,
    runReverse,
    clearPostResult,
  }
}
