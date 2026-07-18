// packages/lib/src/ingest/filtering/machine-mail.ts

export interface MachineMailCheckInput {
  /** lowercased header-name → value map, as stored in Message.metadata.headers */
  headers?: Record<string, string | string[] | undefined> | null
  /** the parsed From address (email only) */
  fromEmail?: string | null
}

/**
 * Machine-mail tier. `hard` is loop-forming with ≈zero false positives
 * (bounces/NDRs, daemon senders, `auto-generated`) — automated consumers must
 * never answer or grow the contact graph from it. `soft` is automated but
 * possibly wanted (OOO auto-replies, mailing-list/notification mail) — excluded
 * from workflows by default, opt-in per trigger.
 */
export type MachineMailTier = 'hard' | 'soft'

export interface MachineMailResult {
  tier: MachineMailTier
  reason: string
}

/** Localparts that are always hard machine senders (bounces/daemons), regardless of domain. */
const HARD_MACHINE_LOCALPARTS = new Set([
  'mailer-daemon',
  'postmaster',
  'mailer',
  'bounce',
  'bounces',
])

/** Localpart prefixes used by VERP-style bounce addresses (e.g. `bounce+abc123@`). */
const HARD_MACHINE_LOCALPART_PREFIXES = ['bounce+', 'bounces+']

/** Localparts that are soft machine senders (no-reply mailboxes) — automated but not bounces. */
const SOFT_MACHINE_LOCALPARTS = new Set(['no-reply', 'noreply', 'do-not-reply', 'donotreply'])

/** Localpart prefixes for VERP-style no-reply addresses (e.g. `no-reply+campaign@`). */
const SOFT_MACHINE_LOCALPART_PREFIXES = ['no-reply+', 'noreply+']

const BULK_PRECEDENCE_VALUES = new Set(['bulk', 'list', 'junk'])

/**
 * The header subset machine-mail detection needs. Providers that don't persist full
 * headers (Outlook, IMAP) store exactly this subset in `Message.metadata.headers`
 * (machine-mail plan Phase 1) — Gmail keeps persisting everything it already did.
 */
export const MACHINE_MAIL_HEADER_ALLOWLIST = [
  'auto-submitted',
  'x-auto-response-suppress',
  'precedence',
  'list-id',
  'list-unsubscribe',
  'return-path',
  'content-type',
] as const

/**
 * Picks the machine-mail header subset out of a provider's name/value header list
 * (Graph's `internetMessageHeaders` use `name`, postal-mime uses `key`) into the
 * lowercased map shape `detectMachineMail` reads. First occurrence wins. Returns
 * `undefined` when none of the allowlisted headers are present.
 */
export function pickMachineMailHeaders(
  entries: Array<{ name?: string | null; key?: string | null; value?: string | null }> | undefined
): Record<string, string> | undefined {
  if (!entries?.length) return undefined
  const allowed = new Set<string>(MACHINE_MAIL_HEADER_ALLOWLIST)
  const picked: Record<string, string> = {}
  for (const entry of entries) {
    const name = (entry.name ?? entry.key)?.toLowerCase().trim()
    if (!name || !allowed.has(name) || picked[name] !== undefined) continue
    picked[name] = entry.value ?? ''
  }
  return Object.keys(picked).length > 0 ? picked : undefined
}

/** Pulls the first value out of a header that may be a string, string[], or absent, trimmed. */
function headerValue(headers: MachineMailCheckInput['headers'], name: string): string | undefined {
  if (!headers) return undefined
  const raw = headers[name]
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' ? value.trim() : undefined
}

/** Whether a header key is present at all (any value, including empty string). */
function hasHeader(headers: MachineMailCheckInput['headers'], name: string): boolean {
  if (!headers) return false
  const raw = headers[name]
  if (raw === undefined || raw === null) return false
  return Array.isArray(raw) ? raw.length > 0 : true
}

/**
 * Detects machine-generated mail — autoresponders, bounces/NDRs, mailing-list
 * traffic, and delivery-status notifications — from headers and the sender
 * address alone, and classifies it into a `hard`/`soft` tier. Deliberately does
 * NOT sniff the body: header-based signals are the standard machine-mail
 * conventions (RFC 3834, RFC 3798) and won't misfire on legitimate human mail
 * the way keyword/body heuristics would.
 *
 * Used at ingest time to flag messages the auto-reply pipeline must not answer,
 * preventing backscatter loops (e.g. auto-replying to a CI notification, which
 * then bounces as an NDR, which then gets auto-replied to again). Hard signals
 * are checked first so a real NDR — which typically carries every signal at
 * once, including `Auto-Submitted: auto-replied` (Google/Microsoft stamp NDRs
 * `auto-replied`, not `auto-generated`) — always resolves to `hard` before the
 * `auto-replied` soft check can see it.
 *
 * Returns `null` for ordinary human mail.
 */
export function detectMachineMail(input: MachineMailCheckInput): MachineMailResult | null {
  const { headers, fromEmail } = input
  const localpart = fromEmail?.split('@')[0]?.toLowerCase().trim()

  // --- Hard tier (loop-forming, ≈zero false positives) ---

  const contentType = headerValue(headers, 'content-type')?.toLowerCase()
  if (
    contentType &&
    (contentType.includes('report-type=delivery-status') ||
      contentType.includes('multipart/report'))
  ) {
    return { tier: 'hard', reason: 'delivery-status' }
  }

  if (hasHeader(headers, 'return-path')) {
    const returnPath = headerValue(headers, 'return-path')
    if (returnPath === '' || returnPath === '<>') {
      return { tier: 'hard', reason: 'null-return-path' }
    }
  }

  if (localpart) {
    const isExactMatch = HARD_MACHINE_LOCALPARTS.has(localpart)
    const isPrefixMatch = HARD_MACHINE_LOCALPART_PREFIXES.some((prefix) =>
      localpart.startsWith(prefix)
    )
    if (isExactMatch || isPrefixMatch) {
      return { tier: 'hard', reason: 'machine-sender' }
    }
  }

  const autoSubmitted = headerValue(headers, 'auto-submitted')?.toLowerCase()
  if (autoSubmitted !== undefined && autoSubmitted !== 'no' && autoSubmitted !== 'auto-replied') {
    return { tier: 'hard', reason: 'auto-submitted' }
  }

  // --- Soft tier (automated but possibly wanted) ---

  // `Auto-Submitted: auto-replied` — out-of-office responders. Real NDRs also
  // stamp this, but they hit the hard checks above first.
  if (autoSubmitted === 'auto-replied') {
    return { tier: 'soft', reason: 'auto-replied' }
  }

  if (hasHeader(headers, 'list-id') || hasHeader(headers, 'list-unsubscribe')) {
    return { tier: 'soft', reason: 'mailing-list' }
  }

  const precedence = headerValue(headers, 'precedence')?.toLowerCase()
  if (precedence && BULK_PRECEDENCE_VALUES.has(precedence)) {
    return { tier: 'soft', reason: 'precedence' }
  }

  // `X-Auto-Response-Suppress` is value-parsed: flag only when a comma-separated
  // token is something other than `none`. A bare `None` (Exchange's default on
  // human-composed mail) must NOT flag — a presence check would false-positive.
  const autoResponseSuppress = headerValue(headers, 'x-auto-response-suppress')
  if (autoResponseSuppress !== undefined) {
    const tokens = autoResponseSuppress
      .split(',')
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean)
    if (tokens.some((token) => token !== 'none')) {
      return { tier: 'soft', reason: 'auto-response-suppress' }
    }
  }

  if (localpart) {
    const isExactMatch = SOFT_MACHINE_LOCALPARTS.has(localpart)
    const isPrefixMatch = SOFT_MACHINE_LOCALPART_PREFIXES.some((prefix) =>
      localpart.startsWith(prefix)
    )
    if (isExactMatch || isPrefixMatch) {
      return { tier: 'soft', reason: 'no-reply-sender' }
    }
  }

  return null
}
