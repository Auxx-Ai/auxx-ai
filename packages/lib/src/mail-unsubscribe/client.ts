// packages/lib/src/mail-unsubscribe/client.ts
// Client-safe entry point for mail unsubscribe — the tier vocabulary, the
// `unsubscribeMeta` parser, the subject-key helpers and THE safety gate. Pure
// types + functions, no database/server imports.
//
// NOTE: no 'use client' directive. Server code imports this file too (the
// executor and the sweep job both read the tier selection), and the directive
// would turn every export into a client-reference proxy there.
//
// ⚠️ Unsubscribe is a ONE-SHOT COMMAND, never a `MailFilterAction` (S2 /
// invariant 1). An action in that union would fire an outbound POST to a third
// party on every future match; this is a user-initiated operation against a
// *list*. Nothing in here is reachable from the filter engine.

import { parseSubjectKey, toSubjectKey } from '../mail-suggestions/client'

/**
 * Which tier ran — chosen BY HEADER, never by provider (§6.1).
 *
 * - `one-click` — RFC 8058: `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
 *   plus an https URL. We POST it server-side. Silent, standard, the good path.
 * - `http` — an https URL with NO one-click header. We hand the URL back for the
 *   CLIENT to open in a new tab and never touch it ourselves: a bare GET is
 *   usually a confirmation page, and POSTing an arbitrary URL on a user's behalf
 *   is not ours to do.
 * - `mailto` — a real outbound send from that mailbox's own channel.
 */
export type UnsubscribeMethod = 'one-click' | 'http' | 'mailto'

/** `MailUnsubscribe.status` — `ignored` is set by the sweep job, not by a user. */
export type UnsubscribeStatus = 'requested' | 'confirmed' | 'failed' | 'ignored'

/**
 * Parsed `list-unsubscribe` + `list-unsubscribe-post`, as stored in
 * `Message.unsubscribeMeta` (jsonb) by the ingest derive.
 */
export interface UnsubscribeMeta {
  /** An `https:`/`http:` endpoint from `List-Unsubscribe`. */
  httpUrl?: string
  /** A bare address (no `mailto:` scheme) from `List-Unsubscribe`. */
  mailto?: string
  /** True only when `List-Unsubscribe-Post: List-Unsubscribe=One-Click` was present. */
  oneClick: boolean
}

/** Why we will not offer unsubscribe for a group. */
export type UnsubscribeRefusalReason =
  /**
   * No `list-id` AND the sender is not DMARC/DKIM-authenticated (§6.2,
   * invariants 3 & 4). Acting on an unverified sender's unsubscribe confirms a
   * live address to whoever sent it.
   */
  | 'unverified-sender'
  /** The mail carries no `List-Unsubscribe` header at all — nothing to act on. */
  | 'no-unsubscribe-method'

/** What the UI should offer instead when we refuse (§6.2 / §8). */
export type UnsubscribeAlternative = 'block-sender'

/**
 * The typed refusal. Deliberately a VALUE, not an error: "we won't unsubscribe
 * from this, block the sender instead" is a legitimate answer the card renders,
 * not a failure the toast swallows.
 */
export interface UnsubscribeRefusal {
  offered: false
  reason: UnsubscribeRefusalReason
  alternative: UnsubscribeAlternative
  /** Copy the card can render verbatim. */
  message: string
}

/** An offered tier, with exactly the operand that tier consumes. */
export type UnsubscribeOffer =
  | { offered: true; method: 'one-click'; httpUrl: string }
  | { offered: true; method: 'http'; httpUrl: string }
  | { offered: true; method: 'mailto'; mailto: string }
  | UnsubscribeRefusal

/** Inputs the gate + tier selection read. All four come off one `Message` row. */
export interface UnsubscribeCandidate {
  /** Normalized `list-id`, or null when the group is a domain heuristic. */
  listId: string | null
  /**
   * DMARC/DKIM verdict. **NULL IS NOT A PASS** — see
   * {@link selectUnsubscribeMethod}.
   */
  senderAuthenticated: boolean | null
  /** Raw `Message.unsubscribeMeta` jsonb; run it through {@link parseUnsubscribeMeta}. */
  unsubscribeMeta: UnsubscribeMeta | null
}

/**
 * Normalize the `Message.unsubscribeMeta` jsonb blob into {@link UnsubscribeMeta}.
 *
 * Returns null for anything unusable. `oneClick` is coerced with `=== true`, so
 * a truthy-but-not-true value (a string `"1"` from a sloppy backfill, say) never
 * unlocks the server-side POST tier.
 */
export function parseUnsubscribeMeta(raw: unknown): UnsubscribeMeta | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const blob = raw as Record<string, unknown>
  const httpUrl = typeof blob.httpUrl === 'string' && blob.httpUrl ? blob.httpUrl : undefined
  const mailto = typeof blob.mailto === 'string' && blob.mailto ? blob.mailto : undefined
  if (!httpUrl && !mailto) return null
  return { httpUrl, mailto, oneClick: blob.oneClick === true }
}

/**
 * THE safety gate + tier selection (§6.1, §6.2, invariants 3 & 4).
 *
 * The gate first: **no `listId` AND not `senderAuthenticated` ⇒ never offer
 * unsubscribe.** `senderAuthenticated === null` counts as NOT authenticated —
 * the absence of an `authentication-results` header is not a pass, and coercing
 * the unknown to one is how you end up POSTing to a spammer's confirmation
 * endpoint. Outlook/IMAP history legitimately lands here until the header starts
 * arriving; the conservative branch is the correct answer for it.
 *
 * Then the tier, chosen by header and never by provider:
 *
 * | `unsubscribeMeta`                    | method      |
 * | ------------------------------------ | ----------- |
 * | `oneClick: true` + `httpUrl` (8058)  | `one-click` |
 * | `httpUrl` only                       | `http`      |
 * | `mailto:` only                       | `mailto`    |
 *
 * `one-click` requires BOTH the flag and an http url: the flag alone describes a
 * POST with no endpoint to send it to.
 */
export function selectUnsubscribeMethod(candidate: UnsubscribeCandidate): UnsubscribeOffer {
  const { listId, senderAuthenticated, unsubscribeMeta } = candidate

  if (!listId && senderAuthenticated !== true) {
    return {
      offered: false,
      reason: 'unverified-sender',
      alternative: 'block-sender',
      message:
        'This sender has no mailing-list identity and is not authenticated. Unsubscribing would ' +
        'confirm your address is live — block the sender or filter it to spam instead.',
    }
  }

  if (!unsubscribeMeta) {
    return {
      offered: false,
      reason: 'no-unsubscribe-method',
      alternative: 'block-sender',
      message:
        'This sender publishes no unsubscribe address. Block the sender or filter it to spam ' +
        'instead.',
    }
  }

  const { httpUrl, mailto, oneClick } = unsubscribeMeta
  if (oneClick && httpUrl) return { offered: true, method: 'one-click', httpUrl }
  if (httpUrl) return { offered: true, method: 'http', httpUrl }
  if (mailto) return { offered: true, method: 'mailto', mailto }

  return {
    offered: false,
    reason: 'no-unsubscribe-method',
    alternative: 'block-sender',
    message:
      'This sender publishes no unsubscribe address. Block the sender or filter it to spam ' +
      'instead.',
  }
}

/**
 * A bulk-mail group key: `list:<listId>` or `domain:<senderDomain>` (§4/§6.4).
 *
 * ⚠️ **The keyspace itself is defined ONCE, in `mail-suggestions/client.ts`** —
 * these two functions are shape adapters over `toSubjectKey`/`parseSubjectKey`, not
 * a second implementation. The mining job MINTS these keys and the unsubscribe
 * executor and its sweep CONSUME them; two copies that agree today would drift the
 * first time either side gained a third prefix, and the failure mode is silent —
 * the sweep would count no mail and report every sender as honoring an unsubscribe
 * they ignored. Add a prefix there, never here.
 *
 * `listId` and `senderDomain` stay two columns and this stays two prefixes (S7,
 * invariant 8) — the safety gate above has to tell a real list from a domain
 * guess, and a fused key destroys exactly that distinction.
 */
export function toMailSubjectKey(group: {
  listId?: string | null
  senderDomain?: string | null
}): string | null {
  return toSubjectKey(group.listId ?? null, group.senderDomain ?? null)
}

/**
 * The inverse of {@link toMailSubjectKey}, in this module's discriminated shape.
 * Returns null for an unknown prefix **or a bare prefix with no value**.
 */
export function parseMailSubjectKey(
  subjectKey: string
): { kind: 'list'; listId: string } | { kind: 'domain'; senderDomain: string } | null {
  const parsed = parseSubjectKey(subjectKey)
  if (!parsed) return null
  return parsed.kind === 'list'
    ? { kind: 'list', listId: parsed.value }
    : { kind: 'domain', senderDomain: parsed.value }
}

/**
 * How long a sender gets to honor an unsubscribe before we call it ignored
 * (§6.4). Senders take days; 14 is "they had every chance".
 */
export const UNSUBSCRIBE_IGNORED_AFTER_DAYS = 14

/** `EntitySignal.kind` for our OWN outbound unsubscribe — never `contact:unsubscribed` (invariant 2). */
export const MAIL_UNSUBSCRIBED_FROM_SIGNAL_KIND = 'mail:unsubscribed_from' as const
