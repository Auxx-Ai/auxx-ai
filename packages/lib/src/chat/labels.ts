// packages/lib/src/chat/labels.ts

/**
 * Client-safe label helpers for anonymous chat visitors.
 *
 * The admin panel renders chat-widget visitors by the sticky
 * `auxx_chat_session_id` cookie value (stored as `Participant.identifier`),
 * which is an opaque UUID. These helpers derive a short, human-readable
 * handle from the last 4 characters of that identifier so admins can
 * distinguish anonymous visitors at a glance without leaking the full id.
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
 * Friendly per-message label for an anonymous chat visitor.
 *
 * @example formatVisitorLabel('7c0e8605-0fa0-476f-9549-d1a566d4354b') → 'Chat user #354b'
 */
export function formatVisitorLabel(identifier: string): string {
  return `Chat user #${suffix(identifier)}`
}

/**
 * Friendly thread-subject label for an anonymous chat visitor's conversation.
 * Shorter than the per-message label since the channel is already implied by
 * the inbox filter.
 *
 * @example formatVisitorThreadSubject('7c0e8605-0fa0-476f-9549-d1a566d4354b') → 'Chat #354b'
 */
export function formatVisitorThreadSubject(identifier: string): string {
  return `Chat #${suffix(identifier)}`
}
