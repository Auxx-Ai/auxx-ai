// packages/lib/src/providers/social/thread-key.ts

/**
 * Thread-key namespaces for Meta social channels.
 *
 * The whole keyspace is defined here and nowhere else. A key written by the
 * webhook, by `syncMessages`, and by the outbound send path must be byte-identical
 * or the same conversation forks into several threads — and unlike email there is
 * no RFC 5322 parentage chain to fall back on (`resolve-thread.ts` gates rung 2 to
 * `outlook`/`imap`), so a key disagreement is unrecoverable at read time.
 */
export const SOCIAL_THREAD_KEY_NAMESPACES = {
  /** 1:1 Messenger / Instagram Direct conversation. */
  dm: 'dm',
  /** A root comment on a page post plus its replies (see WS10 — not yet ingested). */
  comment: 'comment',
} as const

/**
 * Conversation key for a Messenger / Instagram DM.
 *
 * **Derived, not provider-issued, and deliberately so.** Meta's page messaging
 * webhook carries no conversation id at all — only `sender.id`, `recipient.id` and
 * `message.mid`. The REST conversation id (`t_…`) exists on the `/conversations`
 * edge but recovering it per inbound message costs a Graph round-trip inside a
 * handler Meta retries on any non-2xx. A Messenger/IG DM is strictly 1:1 between a
 * page and one user, so `(pageId, counterpartId)` *is* the conversation identity.
 *
 * The counterpart is always the **non-page** party, which is direction-dependent:
 * `sender.id` on an inbound message, `recipient.id` on an echo or our own send.
 * Keying on `sender.id` alone — what the routes did before — files our replies
 * under the page id and the customer's messages under theirs, splitting every
 * conversation in two.
 *
 * The `dm:` prefix is not decoration: post comments share this column under
 * `comment:{rootCommentId}`, and retrofitting a namespace means rewriting every
 * stored key.
 *
 * @param pageId Facebook Page id, or the Instagram business account id.
 * @param counterpartId The other party's PSID (Messenger) or IGSID (Instagram).
 */
export function socialThreadKey(pageId: string, counterpartId: string): string {
  return `${SOCIAL_THREAD_KEY_NAMESPACES.dm}:${pageId}:${counterpartId}`
}

/**
 * True when `key` is a DM key minted by {@link socialThreadKey}.
 *
 * Public/private is a property of the *surface*, not of `Message.messageType` —
 * comments and DMs both store as `CHAT`, so callers that need the distinction ask
 * here rather than reading the message type.
 */
export function isSocialDmThreadKey(key: string | null | undefined): boolean {
  return !!key?.startsWith(`${SOCIAL_THREAD_KEY_NAMESPACES.dm}:`)
}
