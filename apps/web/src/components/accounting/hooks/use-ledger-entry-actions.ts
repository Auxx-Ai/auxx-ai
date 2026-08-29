// apps/web/src/components/accounting/hooks/use-ledger-entry-actions.ts

'use client'

import type { EntryPreview, PostResult } from '@auxx/lib/postings/client'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FIXTURE_POST_RESULT,
  FIXTURE_POST_RESULT_NOT_CONNECTED,
  FIXTURE_PREVIEW,
  FIXTURE_PREVIEW_BLOCKED,
} from '~/components/accounting/fixtures'

interface UseLedgerEntryActionsOptions {
  periodKey: string
  /** Render the refused preview instead of the buildable one. */
  blocked: boolean
  /** With no provider connected, a post still succeeds with outcome `not_connected`. */
  providerConnected: boolean
}

export interface LedgerEntryActions {
  preview: EntryPreview
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

/** How long the placeholder pretends the round trip takes. */
const FAKE_LATENCY_MS = 550

/**
 * Post / Reverse / Preview, against local state.
 *
 * 🛑 PLACEHOLDER: none of the three procedures exist yet
 * (13-accounting-ui.md §4), so nothing here talks to a server:
 *
 *   * `runPreview` will become `ledger.previewMonthEnd({ periodKey })`
 *   * `runPost`    will become `ledger.postMonthEnd({ periodKey })`
 *   * `runReverse` will become `ledger.reverse({ glPostingId, memo })`
 *   * the posted read behind it will become `ledger.get(id)`
 *
 * Everything else about this file is real: the shapes are the shipped
 * `EntryPreview` / `PostResult`, and `not_connected` is returned as a SUCCESS
 * (decision `P1`) rather than an error, which is the behaviour the screens have
 * to get right whether the data is fixture or not.
 */
export function useLedgerEntryActions({
  periodKey,
  blocked,
  providerConnected,
}: UseLedgerEntryActionsOptions): LedgerEntryActions {
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [isPosting, setIsPosting] = useState(false)
  const [isReversing, setIsReversing] = useState(false)
  const [postResult, setPostResult] = useState<PostResult | null>(null)
  const [justPosted, setJustPosted] = useState(false)

  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending) clearTimeout(timer)
    }
  }, [])

  const schedule = useCallback((run: () => void) => {
    const timer = setTimeout(run, FAKE_LATENCY_MS)
    timers.current.push(timer)
  }, [])

  // A new month clears whatever the previous one's buttons produced. Adjusted
  // during render rather than in an effect: an effect would paint the previous
  // month's post result for one frame.
  const [lastPeriodKey, setLastPeriodKey] = useState(periodKey)
  if (lastPeriodKey !== periodKey) {
    setLastPeriodKey(periodKey)
    setPostResult(null)
    setJustPosted(false)
  }

  const preview: EntryPreview = blocked
    ? { ...FIXTURE_PREVIEW_BLOCKED, periodKey, docNumber: `AUXX-MEI-${periodKey}` }
    : { ...FIXTURE_PREVIEW, periodKey, docNumber: `AUXX-MEI-${periodKey}` }

  const runPreview = useCallback(() => {
    setIsPreviewing(true)
    schedule(() => setIsPreviewing(false))
  }, [schedule])

  const runPost = useCallback(() => {
    setIsPosting(true)
    schedule(() => {
      setIsPosting(false)
      setJustPosted(true)
      // ⚠️ `not_connected` is a first-class SUCCESS, not a degraded post: the
      // entry is built, balanced and persisted identically. Never an error.
      setPostResult(providerConnected ? FIXTURE_POST_RESULT : FIXTURE_POST_RESULT_NOT_CONNECTED)
    })
  }, [providerConnected, schedule])

  const runReverse = useCallback(
    (_memo: string) => {
      setIsReversing(true)
      schedule(() => {
        setIsReversing(false)
        setJustPosted(false)
        setPostResult(null)
      })
    },
    [schedule]
  )

  const clearPostResult = useCallback(() => setPostResult(null), [])

  return {
    preview,
    postResult,
    isPreviewing,
    isPosting,
    isReversing,
    justPosted,
    runPreview,
    runPost,
    runReverse,
    clearPostResult,
  }
}
