// packages/lib/src/ingest/filtering/bulk-mail.ts

import { getDomain } from 'tldts'

export interface BulkMailDeriveInput {
  /** lowercased header-name → value map, as stored in Message.metadata.headers */
  headers?: Record<string, string | string[] | undefined> | null
  /** the parsed From address (email only) */
  fromEmail?: string | null
}

/**
 * Parsed `List-Unsubscribe` (+ `List-Unsubscribe-Post`), stored on
 * `Message.unsubscribeMeta`. Parsed once at ingest so the mining job and the
 * unsubscribe executor never re-parse `<https://…>, <mailto:…>`.
 *
 * `oneClick` is RFC 8058 and is the ONLY thing that licenses a server-side POST.
 * An `httpUrl` without it must be opened in the user's browser instead — a bare
 * GET is usually a confirmation page, and POSTing an arbitrary URL on someone's
 * behalf is not ours to do (suggestions plan §6.1).
 */
export interface UnsubscribeMeta {
  httpUrl?: string
  mailto?: string
  oneClick: boolean
}

/** The four `Message` columns derived from bulk-mail headers. All nullable. */
export interface BulkMailFields {
  listId: string | null
  senderDomain: string | null
  unsubscribeMeta: UnsubscribeMeta | null
  /**
   * DMARC/DKIM verdict. **NULL MEANS UNKNOWN and every read must treat it as
   * "not authenticated"** (suggestions plan invariant 3) — the absence of an
   * `Authentication-Results` header is not a pass, and coercing the unknown to
   * `true` is how you end up POSTing to a spammer's confirmation endpoint.
   */
  senderAuthenticated: boolean | null
}

/**
 * The header subset bulk-sender identity needs. Providers that don't persist full
 * headers (Outlook, IMAP) store exactly this subset — merged with the machine-mail
 * subset — in `Message.metadata.headers`; Gmail keeps persisting everything.
 *
 * Deliberately NOT folded into `MACHINE_MAIL_HEADER_ALLOWLIST`: that list is the
 * input contract of `detectMachineMail` and must not grow headers it does not read
 * (`threading-headers.ts:24`). Separate pickers over one header list is the
 * established shape — this is the fourth.
 */
export const BULK_MAIL_HEADER_ALLOWLIST = [
  'list-unsubscribe',
  'list-unsubscribe-post',
  'list-id',
  'authentication-results',
] as const

/**
 * Picks the bulk-mail header subset out of a provider's name/value header list
 * (Graph's `internetMessageHeaders` use `name`, postal-mime uses `key`) into the
 * lowercased map shape {@link deriveBulkMailFields} reads. First occurrence wins.
 * Returns `undefined` when none of the allowlisted headers are present.
 *
 * First-occurrence-wins matters for `authentication-results`: the topmost one is
 * stamped by the receiving MTA — the only hop we have any reason to trust.
 */
export function pickBulkMailHeaders(
  entries: Array<{ name?: string | null; key?: string | null; value?: string | null }> | undefined
): Record<string, string> | undefined {
  if (!entries?.length) return undefined
  const allowed = new Set<string>(BULK_MAIL_HEADER_ALLOWLIST)
  const picked: Record<string, string> = {}
  for (const entry of entries) {
    const name = (entry.name ?? entry.key)?.toLowerCase().trim()
    if (!name || !allowed.has(name) || picked[name] !== undefined) continue
    picked[name] = entry.value ?? ''
  }
  return Object.keys(picked).length > 0 ? picked : undefined
}

/** Every field unknown — what a header-less or malformed message derives to. */
const EMPTY_FIELDS: BulkMailFields = {
  listId: null,
  senderDomain: null,
  unsubscribeMeta: null,
  senderAuthenticated: null,
}

/** Pulls the first value out of a header that may be a string, string[], or absent, trimmed. */
function headerValue(headers: BulkMailDeriveInput['headers'], name: string): string | undefined {
  if (!headers) return undefined
  const raw = headers[name]
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' ? value.trim() : undefined
}

/**
 * Normalizes a `List-Id` value to its bare identity: the angle-bracketed part when
 * there is one (RFC 2919 puts the human description in front of it), lowercased and
 * trimmed. `<news.acme.com>` and `ACME News <news.acme.com>` both → `news.acme.com`.
 *
 * A bracket-less value is taken whole — senders that omit the brackets emit the bare
 * identity and nothing else, so there is no description to strip.
 */
function parseListId(raw: string | undefined): string | null {
  if (!raw) return null
  const bracketed = raw.match(/<([^>]*)>/)?.[1]
  const value = (bracketed ?? raw).trim().replace(/^"|"$/g, '').trim().toLowerCase()
  return value.length > 0 ? value : null
}

/** Registrable domain (eTLD+1) of an email address, lowercased. `null` when unparseable. */
function parseSenderDomain(fromEmail: string | null | undefined): string | null {
  if (!fromEmail) return null
  const atIdx = fromEmail.lastIndexOf('@')
  if (atIdx < 0) return null
  // Tolerate an address that still carries its `<…>` wrapper or trailing list
  // punctuation — providers hand us the bare address, but callers vary.
  const host = fromEmail
    .slice(atIdx + 1)
    .toLowerCase()
    .trim()
    .replace(/[>\s,;]+$/, '')
  if (!host) return null
  return getDomain(host)?.toLowerCase() ?? null
}

/**
 * Splits a `List-Unsubscribe` value into its URI tokens. The RFC form is a
 * comma-separated list of angle-bracketed URIs in any order (`<https://…>,
 * <mailto:…>`), but bracket-less senders exist, so fall back to a comma split.
 */
function splitUnsubscribeUris(raw: string): string[] {
  const bracketed = [...raw.matchAll(/<([^>]*)>/g)].map((m) => m[1]?.trim() ?? '')
  const tokens = bracketed.length > 0 ? bracketed : raw.split(',').map((t) => t.trim())
  return tokens.filter((token) => token.length > 0)
}

/** `{ httpUrl?, mailto?, oneClick }`, or `null` when neither URI form is present. */
function parseUnsubscribeMeta(
  listUnsubscribe: string | undefined,
  listUnsubscribePost: string | undefined
): UnsubscribeMeta | null {
  if (!listUnsubscribe) return null

  let httpUrl: string | undefined
  let mailto: string | undefined
  for (const uri of splitUnsubscribeUris(listUnsubscribe)) {
    const scheme = uri.toLowerCase()
    if (!httpUrl && (scheme.startsWith('https://') || scheme.startsWith('http://'))) httpUrl = uri
    else if (!mailto && scheme.startsWith('mailto:')) mailto = uri
  }

  if (!httpUrl && !mailto) return null

  // RFC 8058: one-click is a property of the HTTP endpoint. `List-Unsubscribe-Post`
  // without an `httpUrl` is meaningless and must never be reported as one-click.
  const oneClick =
    !!httpUrl &&
    (listUnsubscribePost ?? '')
      .replace(/\s+/g, '')
      .toLowerCase()
      .includes('list-unsubscribe=one-click')

  const meta: UnsubscribeMeta = { oneClick }
  if (httpUrl) meta.httpUrl = httpUrl
  if (mailto) meta.mailto = mailto
  return meta
}

/** Every result token an `Authentication-Results` method can carry, per method. */
function methodResults(raw: string, method: 'dmarc' | 'dkim' | 'spf'): string[] {
  const matches = raw.matchAll(new RegExp(`(?:^|[\\s;(])${method}\\s*=\\s*([a-z]+)`, 'gi'))
  return [...matches].map((m) => (m[1] ?? '').toLowerCase())
}

/** Results that count as an explicit failure. `none`/`neutral`/`temperror` do not. */
const FAIL_RESULTS = new Set(['fail', 'softfail', 'permerror'])

/**
 * DMARC/DKIM/SPF verdict, tri-state.
 *
 * `true` only on an explicit pass — `dmarc=pass`, or `dkim=pass` + `spf=pass`.
 * `false` on an explicit fail. `null` for everything else: header absent, no
 * recognizable method, or a `none`/`neutral`/`temperror` result. Pass is checked
 * before fail because a DKIM-aligned DMARC pass legitimately sits next to
 * `spf=fail` (forwarded mail), and that is a pass.
 */
function parseSenderAuthenticated(raw: string | undefined): boolean | null {
  if (!raw) return null

  const dmarc = methodResults(raw, 'dmarc')
  const dkim = methodResults(raw, 'dkim')
  const spf = methodResults(raw, 'spf')
  if (dmarc.length === 0 && dkim.length === 0 && spf.length === 0) return null

  const passes = (results: string[]) => results.includes('pass')
  if (passes(dmarc) || (passes(dkim) && passes(spf))) return true

  const fails = (results: string[]) =>
    results.length > 0 && !passes(results) && results.some((r) => FAIL_RESULTS.has(r))
  if (fails(dmarc) || fails(dkim) || fails(spf)) return false

  return null
}

/**
 * Derives the four bulk-sender columns (`listId`, `senderDomain`,
 * `unsubscribeMeta`, `senderAuthenticated`) from headers already in hand plus the
 * from-address.
 *
 * **Pure string parsing — no query, no await, no cache read, no org branching**
 * (suggestions plan invariant 9). That is what makes it safe to run inside ingest
 * without violating the mail-filters rule that the rule engine never runs there:
 * this is a header derive, not rule evaluation. Anything that needs org state
 * belongs after the write.
 *
 * Never throws: a malformed header yields all-nulls rather than failing an ingest.
 */
export function deriveBulkMailFields(input: BulkMailDeriveInput): BulkMailFields {
  try {
    const { headers, fromEmail } = input
    return {
      listId: parseListId(headerValue(headers, 'list-id')),
      senderDomain: parseSenderDomain(fromEmail),
      unsubscribeMeta: parseUnsubscribeMeta(
        headerValue(headers, 'list-unsubscribe'),
        headerValue(headers, 'list-unsubscribe-post')
      ),
      senderAuthenticated: parseSenderAuthenticated(headerValue(headers, 'authentication-results')),
    }
  } catch {
    return { ...EMPTY_FIELDS }
  }
}
