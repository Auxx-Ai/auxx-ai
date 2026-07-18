// packages/lib/src/signals/bounce-dsn.ts
// Pure DSN/NDR parser (no DB) for the Gmail/Outlook bounce path
// (plans/signals/05-machine-mail-bounce.md §4). Given an inbound machine-mail message's
// headers + body, decides whether it is a delivery-status notification, extracts the failed
// recipient, and classifies permanence (act on permanent 5.x.x only). The DB side effects
// (mark BOUNCED, record `email:bounced`, suppress) live in the event handler that consumes
// this — keeping the parsing pure makes it unit-testable against real NDR fixtures.

/** Input for {@link parseBounceDsn} — a subset of a `Message` row, all optional so callers can
 * pass whatever they have. `headers` is the lowercased header map stored at
 * `Message.metadata.headers`. */
export interface BounceDsnInput {
  headers?: Record<string, string | string[] | undefined> | null
  /** The DSN sender's email (the daemon/postmaster address), for daemon-sender detection. */
  fromEmail?: string | null
  textPlain?: string | null
  textHtml?: string | null
  snippet?: string | null
}

export interface ParsedBounce {
  /** Whether this message looks like a delivery-status notification / NDR at all. */
  isDsn: boolean
  /** Failed recipient email (lowercased, `<>` stripped) if one could be extracted, else null. */
  failedRecipient: string | null
  /** True ONLY when a permanent (5.x.x enhanced / 5xx SMTP) status code was found. Transient
   * (4.x.x) and "no code at all" both yield false — the plan's rule is permanent-only. */
  permanent: boolean
  /** The status/SMTP code string that drove the permanence verdict, for logging. */
  statusCode: string | null
  /** Original `Message-ID`s referenced by the DSN (In-Reply-To / References headers + any
   * embedded `Message-ID:` in the body) — the handler's fallback resolution strategy matches
   * these against `Message.internetMessageId`. */
  originalMessageIds: string[]
}

/** Daemon localparts that mark a DSN sender regardless of domain. */
const DAEMON_LOCALPARTS = new Set(['mailer-daemon', 'postmaster', 'mailer', 'bounce', 'bounces'])
const DAEMON_LOCALPART_PREFIXES = ['bounce+', 'bounces+']

/** Match an email address inside free text; requires a dotted domain so `rfc822;` and the like
 * don't match. */
const EMAIL_RE = /[^\s<>@"]+@[^\s<>@"]+\.[^\s<>@".,;:]+/

function headerValue(headers: BounceDsnInput['headers'], name: string): string | undefined {
  if (!headers) return undefined
  // headers are stored lowercased, but look up defensively.
  const raw = headers[name] ?? headers[name.toLowerCase()]
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' ? value.trim() : undefined
}

/** All values for a header, flattened to a single string (for multi-valued References etc.). */
function headerText(headers: BounceDsnInput['headers'], name: string): string {
  if (!headers) return ''
  const raw = headers[name] ?? headers[name.toLowerCase()]
  if (raw === undefined || raw === null) return ''
  return Array.isArray(raw) ? raw.filter(Boolean).join(' ') : String(raw)
}

/** Crude HTML → text for body scanning: drop tags, decode a few entities, collapse whitespace.
 * Good enough to extract an email + a status code; not a full renderer. */
function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
}

/**
 * Combine every stored body representation for scanning — NOT first-non-empty.
 * Real Microsoft NDRs put the returned ORIGINAL message in `textPlain` and the
 * actual failure diagnostic (recipient, "mailbox is full", `554 5.2.2`) only in
 * the HTML part, so scanning `textPlain` alone misses the status code entirely
 * (verified against the 2026-07-18 incident data).
 */
function bodyText(input: BounceDsnInput): string {
  const parts = [
    input.textPlain?.trim() ? input.textPlain : '',
    input.textHtml?.trim() ? stripHtml(input.textHtml) : '',
    input.snippet ?? '',
  ]
  return parts.filter(Boolean).join('\n')
}

function normalize(email: string): string {
  return email.trim().replace(/^<|>$/g, '').toLowerCase()
}

function isDaemonSender(fromEmail?: string | null): boolean {
  const localpart = fromEmail?.split('@')[0]?.toLowerCase().trim()
  if (!localpart) return false
  return (
    DAEMON_LOCALPARTS.has(localpart) ||
    DAEMON_LOCALPART_PREFIXES.some((prefix) => localpart.startsWith(prefix))
  )
}

/** Whether the message is a delivery-status notification, from headers + sender + body cues. */
export function isDeliveryStatusNotification(input: BounceDsnInput): boolean {
  const contentType = headerValue(input.headers, 'content-type')?.toLowerCase()
  if (
    contentType &&
    (contentType.includes('report-type=delivery-status') ||
      contentType.includes('multipart/report'))
  ) {
    return true
  }

  const returnPath = headerValue(input.headers, 'return-path')
  if (returnPath === '' || returnPath === '<>') return true

  if (isDaemonSender(input.fromEmail)) return true

  const text = bodyText(input).toLowerCase()
  return (
    text.includes('delivery status notification') ||
    text.includes('final-recipient:') ||
    text.includes('delivery has failed to these recipients') ||
    text.includes("wasn't delivered") ||
    text.includes('was not delivered') ||
    text.includes('undeliverable')
  )
}

/** Extract the failed recipient per the plan's precedence: `X-Failed-Recipients` header (Gmail),
 * then a `Final-Recipient:`/`Original-Recipient:` DSN line, then Gmail's
 * "wasn't delivered to <email>" phrasing, then Microsoft's "Delivery has failed to these
 * recipients or groups:" block. Returns null when none match — the handler then falls back to
 * the original outbound message's `TO` participant. */
function extractFailedRecipient(input: BounceDsnInput, text: string): string | null {
  const xFailed = headerValue(input.headers, 'x-failed-recipients')
  if (xFailed) {
    const first = xFailed.split(',')[0]?.match(EMAIL_RE)?.[0]
    if (first) return normalize(first)
  }

  const finalRecipient = text.match(
    /(?:final|original)-recipient:\s*(?:rfc822;)?\s*([^\s<>]+@[^\s<>]+\.[^\s<>.,;:]+)/i
  )
  if (finalRecipient?.[1]) return normalize(finalRecipient[1])

  const gmailPhrase = text.match(
    /(?:wasn't|was not) delivered to\s+([^\s<>]+@[^\s<>]+\.[^\s<>.,;:]+)/i
  )
  if (gmailPhrase?.[1]) return normalize(gmailPhrase[1])

  const msIndex = text.search(/delivery has failed to these recipients or groups:/i)
  if (msIndex >= 0) {
    const after = text.slice(msIndex)
    const email = after.match(EMAIL_RE)?.[0]
    if (email) return normalize(email)
  }

  return null
}

/** Classify permanence from any status codes in the text. Enhanced DSN codes (`5.1.1`) are
 * preferred over bare SMTP reply codes (`550`) since they rarely collide with incidental
 * numbers. Class 5 → permanent; only class 4 present → transient; nothing → transient
 * (conservative — the plan acts on permanent failures only). */
function classifyPermanence(text: string): { permanent: boolean; statusCode: string | null } {
  const enhanced = [...text.matchAll(/\b([245])\.\d{1,3}\.\d{1,3}\b/g)]
  const class5Enhanced = enhanced.find((m) => m[1] === '5')
  if (class5Enhanced) return { permanent: true, statusCode: class5Enhanced[0] }

  // SMTP reply codes only use 0–5 as the second digit (RFC 5321) — [0-5] keeps
  // incidental numbers like port 587 from reading as a permanent failure.
  const smtp = [...text.matchAll(/\b([45])[0-5]\d\b/g)]
  const class5Smtp = smtp.find((m) => m[1] === '5')
  if (class5Smtp) return { permanent: true, statusCode: class5Smtp[0] }

  const class4Enhanced = enhanced.find((m) => m[1] === '4')
  if (class4Enhanced) return { permanent: false, statusCode: class4Enhanced[0] }
  const class4Smtp = smtp.find((m) => m[1] === '4')
  if (class4Smtp) return { permanent: false, statusCode: class4Smtp[0] }

  return { permanent: false, statusCode: null }
}

/** Collect original `Message-ID`s the DSN points back at (In-Reply-To / References headers +
 * any `Message-ID:` embedded in the returned original), deduped, `<>` preserved-then-stripped
 * to the bare id. */
function extractOriginalMessageIds(input: BounceDsnInput, text: string): string[] {
  const ids = new Set<string>()
  const fromHeaders = `${headerText(input.headers, 'in-reply-to')} ${headerText(
    input.headers,
    'references'
  )}`
  for (const match of `${fromHeaders} ${text}`.matchAll(/<([^<>@\s]+@[^<>\s]+)>/g)) {
    if (match[1]) ids.add(match[1])
  }
  return [...ids]
}

/** Parse a machine-mail message into a {@link ParsedBounce} verdict. Pure — all side effects
 * live in the consuming handler. */
export function parseBounceDsn(input: BounceDsnInput): ParsedBounce {
  const text = bodyText(input)
  const { permanent, statusCode } = classifyPermanence(text)
  return {
    isDsn: isDeliveryStatusNotification(input),
    failedRecipient: extractFailedRecipient(input, text),
    permanent,
    statusCode,
    originalMessageIds: extractOriginalMessageIds(input, text),
  }
}
