// apps/web/src/components/mail/utils/participant-initials.ts

import type { ParticipantMeta } from '~/components/threads/store'

/** First letter within a word, scanning past leading punctuation. */
function firstLetterWithinWord(word: string): string {
  return word.match(/[a-zA-Z]/)?.[0] ?? ''
}

/**
 * Avatar initials for a participant. Prefers the server-persisted `initials`
 * (letter-filtered — never a stray quote/paren), then falls back to the same
 * first-letter-within-word algorithm on `displayName`, then `?`.
 *
 * Fixes the raw `charAt(0)` fallbacks that turned From headers like
 * `'Auxx-Lift Store (Shopify)' via Orders` into a `'` avatar.
 */
export function initialsFor(
  participant?: Pick<ParticipantMeta, 'initials' | 'displayName'> | null
): string {
  const persisted = participant?.initials?.trim()
  if (persisted) return persisted.toUpperCase()

  const name = participant?.displayName?.trim()
  if (name) {
    const derived = name
      .split(/\s+/)
      .map(firstLetterWithinWord)
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase()
    if (derived) return derived
  }
  return '?'
}
