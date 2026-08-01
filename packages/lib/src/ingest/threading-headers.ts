// packages/lib/src/ingest/threading-headers.ts

import { normalizeMessageId } from '@auxx/utils'

/** RFC 5322 headers that carry conversation parentage. */
const THREADING_HEADER_ALLOWLIST = ['in-reply-to', 'references'] as const

/**
 * Upper bound on the parent candidates walked per message. A `References` chain
 * grows by one id per reply and is unbounded in the wild; without a cap a single
 * pathological header would fan out into one indexed DB probe per entry.
 */
const MAX_PARENT_CANDIDATES = 10

export interface ThreadingHeaders {
  inReplyTo?: string
  references?: string
}

/**
 * Picks `In-Reply-To`/`References` out of a provider's name/value header list
 * (Graph uses `name`, postal-mime uses `key`). First occurrence wins.
 *
 * Kept separate from `pickMachineMailHeaders`: that allowlist defines the input
 * contract of `detectMachineMail` and must not grow headers it does not read.
 */
export function pickThreadingHeaders(
  entries: Array<{ name?: string | null; key?: string | null; value?: string | null }> | undefined
): ThreadingHeaders {
  if (!entries?.length) return {}
  const allowed = new Set<string>(THREADING_HEADER_ALLOWLIST)
  const picked: Record<string, string> = {}
  for (const entry of entries) {
    const name = (entry.name ?? entry.key)?.toLowerCase().trim()
    if (!name || !allowed.has(name) || picked[name] !== undefined) continue
    picked[name] = entry.value ?? ''
  }

  const headers: ThreadingHeaders = {}
  if (picked['in-reply-to'] !== undefined) headers.inReplyTo = picked['in-reply-to']
  if (picked.references !== undefined) headers.references = picked.references
  return headers
}

/**
 * Normalises one raw msg-id token to the angle-bracketed form the DB stores.
 * Returns `null` for empty/whitespace-only tokens.
 *
 * Strips the list punctuation a header value carries (`<`, `>`, commas,
 * semicolons, whitespace) and then delegates the bracketing itself to
 * `@auxx/utils`' `normalizeMessageId` — the same function Gmail's outbound
 * composer uses to write `Message-ID`/`In-Reply-To`. Reusing it is what keeps
 * the read side and the write side agreeing on one canonical form.
 */
function normalizeCandidate(token: string): string | null {
  const bare = token.replace(/^[\s<,;]+/, '').replace(/[\s>,;]+$/, '')
  return bare.length > 0 ? (normalizeMessageId(bare) ?? null) : null
}

/** Splits a msg-id-list header value into normalised ids, preserving order. */
function splitMessageIds(value: string | undefined): string[] {
  if (!value) return []
  const ids: string[] = []
  // Some clients emit `<a@b><c@d>` or `<a@b>,<c@d>` — give them a boundary first.
  for (const token of value.replace(/>[\s,;]*</g, '> <').split(/\s+/)) {
    const id = normalizeCandidate(token)
    if (id) ids.push(id)
  }
  return ids
}

/**
 * Ordered candidate parent Message-IDs, most specific first: `In-Reply-To`,
 * then `References` walked newest→oldest (RFC 5322 orders it oldest-first).
 * Duplicates are dropped, keeping first-seen order, and the walk stops after
 * {@link MAX_PARENT_CANDIDATES}.
 *
 * Ids are normalised to the angle-bracketed form (`<foo@bar>`) because that is
 * how `Message.internetMessageId` is stored on every write path — Gmail, Graph,
 * IMAP and the outbound composer all persist the raw bracketed header value. A
 * bare-form candidate would never match and would silently disable threading.
 */
export function parentMessageIdCandidates(headers: ThreadingHeaders): string[] {
  const ordered = [
    ...splitMessageIds(headers.inReplyTo),
    ...splitMessageIds(headers.references).reverse(),
  ]

  const candidates: string[] = []
  const seen = new Set<string>()
  for (const id of ordered) {
    if (seen.has(id)) continue
    seen.add(id)
    candidates.push(id)
    if (candidates.length >= MAX_PARENT_CANDIDATES) break
  }
  return candidates
}
