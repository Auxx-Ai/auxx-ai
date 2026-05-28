// packages/lib/src/chat/labels.ts

/**
 * Client-safe label helpers for anonymous chat visitor conversations.
 *
 * Per-message and per-Participant labels live on the Participant row itself
 * (see `generateVisitorName` in `./visitor-naming`). This helper covers the
 * thread-subject case, which stays short because the channel is already
 * implied by the inbox filter.
 *
 * Pure string helpers — no DB or server deps, safe to import from the web
 * client.
 */

const SUFFIX_LEN = 4

/** Last 4 chars of the identifier (or the whole thing if shorter). */
function suffix(identifier: string): string {
  if (!identifier) return ''
  return identifier.length > SUFFIX_LEN ? identifier.slice(-SUFFIX_LEN) : identifier
}

/**
 * Friendly thread-subject label for an anonymous chat visitor's conversation.
 *
 * @example formatVisitorThreadSubject('7c0e8605-0fa0-476f-9549-d1a566d4354b') → 'Chat #354b'
 */
export function formatVisitorThreadSubject(identifier: string): string {
  return `Chat #${suffix(identifier)}`
}
