// apps/web/src/components/mail/hooks/use-suppression-check.ts

import { useMemo } from 'react'
import type { RecipientState } from '~/components/mail/email-editor/types'
import { useDebouncedValue } from '~/hooks/use-debounced-value'
import { api } from '~/trpc/react'

/** Max recipients checked per query — mirrors `signal.checkSuppression`'s input cap. */
const MAX_CHECKED_EMAILS = 100

export interface SuppressedRecipient {
  /** Original (as-typed) casing of the recipient's email — for display in the banner. */
  email: string
  reason: 'unsubscribe' | 'manual' | 'bounce'
}

/**
 * Checks a composer recipient line against `SequenceSuppression` — one debounced,
 * batched `signal.checkSuppression` query for the whole line (follow-ups plan
 * decision 9), so adding/removing any TO recipient doesn't fire a query per keystroke.
 *
 * Only `EMAIL`-type identifiers are checked (suppression is email-scoped). The server
 * normalizes emails (lowercased/trimmed) before matching, so results are matched back
 * to the original recipients case-insensitively — the returned `email` keeps the
 * recipient's original casing for display.
 */
export function useSuppressionCheck(recipients: RecipientState[]): SuppressedRecipient[] {
  const emails = useMemo(() => {
    const seen = new Set<string>()
    const list: string[] = []
    for (const recipient of recipients) {
      if (recipient.identifierType !== 'EMAIL') continue
      const trimmed = recipient.identifier.trim()
      if (!trimmed) continue
      const key = trimmed.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      list.push(trimmed)
    }
    return list.slice(0, MAX_CHECKED_EMAILS)
  }, [recipients])

  const [debouncedEmails] = useDebouncedValue(emails, 500)

  const { data } = api.signal.checkSuppression.useQuery(
    { emails: debouncedEmails },
    { enabled: debouncedEmails.length > 0, staleTime: 30_000 }
  )

  return useMemo(() => {
    if (!data || data.length === 0) return []
    const reasonByLower = new Map(data.map((entry) => [entry.email.toLowerCase(), entry.reason]))
    const seen = new Set<string>()
    const suppressed: SuppressedRecipient[] = []
    for (const email of debouncedEmails) {
      const key = email.toLowerCase()
      const reason = reasonByLower.get(key)
      if (reason && !seen.has(key)) {
        seen.add(key)
        suppressed.push({ email, reason })
      }
    }
    return suppressed
  }, [data, debouncedEmails])
}
