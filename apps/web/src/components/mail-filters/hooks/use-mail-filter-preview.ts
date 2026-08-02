// apps/web/src/components/mail-filters/hooks/use-mail-filter-preview.ts

'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { useMemo } from 'react'
import { useDebounce } from '~/hooks/use-debounced-value'
import { api } from '~/trpc/react'

/** How long the conditions must hold still before a count is asked for. */
const PREVIEW_DEBOUNCE_MS = 500

export interface MailFilterPreview {
  /** Matching conversations, or null while unknown. Read with {@link capped}. */
  count: number | null
  /** True ⇒ counting stopped at the server's cap; render `${count}+`. */
  capped: boolean
  /** A count is in flight, or the conditions have changed and one is pending. */
  isPending: boolean
  isError: boolean
  /** Ready-to-render text, e.g. `'500+ existing conversations'`. */
  label: string
}

interface UseMailFilterPreviewArgs {
  inboxId: string
  conditions: ConditionGroup[]
  /** False ⇒ no query at all (dialog closed, or no inbox picked yet). */
  enabled: boolean
}

/**
 * Live "how much mail would this filter have caught" count for the dialog footer
 * (§6.2 / §6.5).
 *
 * Three properties the plan asks for, in one place:
 * - **Debounced** — the conditions are serialized and debounced, so a keystroke
 *   in a `subject contains` box doesn't launch a body scan per character.
 * - **Cancelled on change** — a new condition set is a new query key, so the
 *   in-flight count's result is never rendered against the newer conditions.
 * - **Capped** — the server stops counting past its cap and says so; the UI
 *   renders `500+` rather than implying it walked the whole mailbox.
 *
 * The number is a **lower bound**, not an exact count: the preview evaluates
 * under the requesting user's viewer while the engine fires as SYSTEM (§7), so
 * record-derived grants can make the real firing set larger. The copy beside it
 * says so.
 */
export function useMailFilterPreview({
  inboxId,
  conditions,
  enabled,
}: UseMailFilterPreviewArgs): MailFilterPreview {
  // Debounce the SERIALIZED conditions, never the array: the caller rebuilds it
  // on most renders, and debouncing an unstable reference restarts the timer
  // forever without ever firing.
  const serialized = useMemo(() => JSON.stringify(conditions ?? []), [conditions])
  const debouncedSerialized = useDebounce(serialized, PREVIEW_DEBOUNCE_MS)
  const debouncedConditions = useMemo(
    () => JSON.parse(debouncedSerialized) as ConditionGroup[],
    [debouncedSerialized]
  )

  const isEnabled = enabled && inboxId !== ''
  const query = api.mailFilters.previewMatchCount.useQuery(
    { inboxId, conditions: debouncedConditions },
    { enabled: isEnabled, staleTime: 30_000, retry: false }
  )

  const settled = serialized === debouncedSerialized
  const isPending = isEnabled && (!settled || query.isFetching)
  const count = query.data?.count ?? null
  const capped = query.data?.capped ?? false

  const label = (() => {
    if (!isEnabled) return 'Pick an inbox to preview matches'
    if (query.isError) return 'Preview unavailable'
    if (count === null) return 'Counting matches…'
    const shown = capped ? `${count}+` : String(count)
    return `Matches at least ${shown} existing conversation${count === 1 && !capped ? '' : 's'}`
  })()

  return { count, capped, isPending, isError: query.isError, label }
}
