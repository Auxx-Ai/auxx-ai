// apps/web/src/components/mail-suggestions/hooks/use-mail-suggestions.ts

'use client'

import { api, type RouterOutputs } from '~/trpc/react'

/**
 * One mined suggestion, as the router hands it to the UI.
 *
 * Everything the card renders is on `evidence`, denormalized onto the row by the
 * mining job precisely so **display never re-queries**
 * (plans/mail-filter/03-suggestions-plan.md §4). Nothing in this feature's UI may
 * fetch a thread, a message or a filter to draw a card.
 */
export type MailSuggestionCard = RouterOutputs['mailSuggestions']['list'][number]

/**
 * Suggestions change weekly at most, so every surface reads one cached answer
 * rather than re-asking: the toolbar badge, the approvals section and the thread
 * chip all mount independently.
 */
const SUGGESTIONS_STALE_TIME = 5 * 60_000

/** The caller's undecided cards. Scoped by the router; never re-filtered here. */
export function useMailSuggestions(enabled = true) {
  return api.mailSuggestions.list.useQuery(undefined, {
    enabled,
    staleTime: SUGGESTIONS_STALE_TIME,
    refetchOnWindowFocus: false,
  })
}

/**
 * The badge number — the same scope and the same `status: 'new'` default the
 * list uses, so the badge can never count a different set than the surface
 * renders.
 */
export function useMailSuggestionsCount(): { count: number; isError: boolean } {
  const { data, error } = api.mailSuggestions.count.useQuery(undefined, {
    staleTime: SUGGESTIONS_STALE_TIME,
    refetchOnWindowFocus: true,
  })
  return { count: data?.count ?? 0, isError: !!error }
}
