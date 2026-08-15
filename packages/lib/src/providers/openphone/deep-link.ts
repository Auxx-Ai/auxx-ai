// packages/lib/src/providers/openphone/deep-link.ts

/**
 * Quo conversation ids are `CN` followed by lowercase hex. Anchored so a partial or reordered
 * URL cannot produce a plausible-looking key.
 */
const DEEP_LINK_CONVERSATION = /\/c\/(CN[a-zA-Z0-9]+)(?:[/?#]|$)/

/**
 * Extracts the `CN…` conversation id from a Quo webhook's `data.deepLink`.
 *
 * **This is THE source of the conversation key on the webhook path.** The message payload carries
 * no `conversationId` field at all (verified live, `apiVersion: v4`) — the deep link Quo emits
 * for its own UI is the only place the key appears in the event. It costs nothing and rides
 * inside the HMAC-signed body, so it is authenticated by the same signature that admitted the
 * request.
 *
 * There is deliberately no REST fallback. `GET /v1/messages/{id}` does return `conversationId`,
 * and an earlier draft called it first on the theory that a documented field beats a UI URL — but
 * that spends an API round-trip per inbound message to re-fetch a fact the webhook just
 * delivered, inside a handler Quo retries on non-2xx, and the refetched value is no better
 * authenticated than the one already in hand. If Quo ever changes this link's shape, the tests
 * below fail and the error log names it; that is a better trade than paying on every message
 * forever against the possibility.
 *
 * Shape: `https://my.quo.com/inbox/PN0eLoM7TQ/c/CNa71b750b888a4cdd81cd3a1ff0f8c0a9?at=AC…`
 *
 * Strict on purpose. A loose match that accepted the `PN…` segment would hand ingest a key that
 * is the same for every conversation on the channel — collapsing the entire channel into one
 * thread, which is a worse failure than the forking this fixes.
 *
 * @returns the conversation id, or `null` when the link is absent or does not match.
 */
export function parseConversationIdFromDeepLink(
  deepLink: string | null | undefined
): string | null {
  if (!deepLink) return null
  return DEEP_LINK_CONVERSATION.exec(deepLink)?.[1] ?? null
}
