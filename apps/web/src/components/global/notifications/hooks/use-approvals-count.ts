// apps/web/src/components/global/notifications/hooks/use-approvals-count.ts
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import { useMailSuggestionsCount } from '~/components/mail-suggestions/hooks/use-mail-suggestions'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'

export interface ApprovalsCount {
  /**
   * Pending workflow confirmations + fresh suggestion bundles + mail
   * suggestions + open duplicate pairs.
   */
  count: number
  /**
   * At least one of the two queries failed. A badge that fails to load and a
   * badge that is zero look identical, so callers must render the difference
   * rather than falling through to "you're all caught up"
   * (plans/today/05-bell-and-feed-dedupe.md §10).
   */
  isError: boolean
}

/**
 * The Approvals count, shared by the sidebar bell and the panel's tab badge so
 * the two cannot drift.
 *
 * Every term's filters MUST match the corresponding `ApprovalsTab` section —
 * including its feature gate (`FeatureKey.todayInbox` for suggestions,
 * `FeatureKey.duplicateDetection` for duplicates). A badge that counts a
 * different set than the tab renders is a bug, not a tuning knob. **Add new
 * sources here and nowhere else**: the bell and the tab badge both read this
 * one hook precisely so they cannot disagree.
 *
 * No `enabled` gate beyond the feature flags: the bell needs this with the panel
 * closed. Every query refetches on window focus, which is what keeps the badge
 * honest if the realtime ping is ever missed.
 */
export function useApprovalsCount(): ApprovalsCount {
  const { hasAccess } = useFeatureFlags()
  const suggestionsEnabled = hasAccess(FeatureKey.todayInbox)
  const duplicatesEnabled = hasAccess(FeatureKey.duplicateDetection)

  const confirmations = api.approval.getPendingCount.useQuery(undefined, {
    refetchOnWindowFocus: true,
  })
  const suggestions = api.approvals.count.useQuery(
    { filters: { ownerScope: 'mine_and_unassigned', status: ['FRESH'] } },
    { enabled: suggestionsEnabled, refetchOnWindowFocus: true }
  )
  /**
   * The Approvals tab's fourth section (mail-filter plan 03 §8.2). Folded in
   * here rather than given a badge of its own: the mail toolbar's own button is
   * a doorway to this same tab, so a second badge source would be two numbers
   * describing one queue.
   *
   * Deliberately NOT behind `FeatureKey.todayInbox` — that gates the AI
   * suggestions above, a different feature for a different audience.
   */
  const mailSuggestions = useMailSuggestionsCount()
  /**
   * The Approvals tab's fifth section (duplicate plan §3.2). Counted here for
   * the same reason mail suggestions are: the section is a lane of one queue,
   * not a queue of its own, so a second badge would be two numbers describing
   * one backlog.
   *
   * The count query carries the SAME archived, snooze and record-scope filters
   * as the list — a pair the list refuses to render must not be counted, which
   * is why the archived filter lives on all three read paths rather than on
   * `list` alone.
   */
  const duplicates = api.duplicates.count.useQuery(undefined, {
    enabled: duplicatesEnabled,
    refetchOnWindowFocus: true,
  })

  return {
    count:
      (confirmations.data ?? 0) +
      (suggestions.data?.count ?? 0) +
      mailSuggestions.count +
      (duplicates.data?.count ?? 0),
    isError:
      !!confirmations.error ||
      (suggestionsEnabled && !!suggestions.error) ||
      mailSuggestions.isError ||
      (duplicatesEnabled && !!duplicates.error),
  }
}
