// packages/lib/src/mail-unsubscribe/one-click-post.ts
// Tier 1: the RFC 8058 server-side one-click POST.
//
// This is the only place in the product that makes an outbound HTTP request to
// an address a stranger put in an email header, so the hardening is the point,
// not decoration:
//
//   • HTTPS ONLY. `http:` is refused outright — the request body says nothing
//     secret, but a cleartext hop is a downgrade an on-path attacker chooses.
//   • No redirect following by the runtime (`redirect: 'manual'`); each hop is
//     re-validated by this module and capped, so a 302 can never walk us to
//     `http://169.254.169.254/…`.
//   • No credentials, no cookies, no auth headers — ever.
//   • Private, loopback, link-local and multicast hosts refused (SSRF).
//   • Short timeout and a bounded response read: we need the status code, not
//     the body, and an endpoint that streams forever must not pin a worker.

import { createScopedLogger } from '@auxx/logger'
import { BadRequestError } from '../errors'

const logger = createScopedLogger('mail-unsubscribe:one-click')

/** RFC 8058 §3.1 — the exact body a one-click POST carries. */
export const ONE_CLICK_BODY = 'List-Unsubscribe=One-Click'

const DEFAULT_TIMEOUT_MS = 8_000
const MAX_REDIRECTS = 3
/** We only need the status line; 64 KB is generous for a "you're unsubscribed" page. */
const MAX_RESPONSE_BYTES = 64_000

export interface OneClickPostResult {
  /** True for any 2xx. Senders answer with everything from 200 to 204. */
  accepted: boolean
  status: number
  /** The URL that actually answered, after any redirects we followed ourselves. */
  finalUrl: string
}

/**
 * Reject anything that is not a public HTTPS endpoint.
 *
 * Hostname-literal checks only — this deliberately does NOT resolve DNS, so a
 * name that resolves to a private address still gets through (classic DNS
 * rebinding). That residual risk is accepted here: the request carries no
 * credentials and no secret, its body is a fixed 26-byte constant, and the
 * response is discarded, so the worst outcome is an unauthenticated POST to an
 * internal endpoint. Egress filtering is the right layer for the rest.
 *
 * @throws BadRequestError — never a bare `Error`, so the router maps it to 400
 * rather than a 500 that reads like our bug.
 */
export function assertPublicHttpsUrl(rawUrl: string): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new BadRequestError('The unsubscribe URL is not a valid URL')
  }

  if (url.protocol !== 'https:') {
    throw new BadRequestError(
      `Refusing to send a one-click unsubscribe over ${url.protocol || 'an unknown scheme'} — HTTPS only`
    )
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')

  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.home.arpa')
  ) {
    throw new BadRequestError(`Refusing to reach a private hostname: ${hostname}`)
  }

  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const a = Number(ipv4[1])
    const b = Number(ipv4[2])
    const isPrivate =
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local, incl. the cloud metadata endpoint
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224 // multicast + reserved
    if (isPrivate) throw new BadRequestError(`Refusing to reach a private IP: ${hostname}`)
  }

  if (
    hostname === '::' ||
    hostname === '::1' ||
    hostname.startsWith('fe8') ||
    hostname.startsWith('fe9') ||
    hostname.startsWith('fea') ||
    hostname.startsWith('feb') ||
    hostname.startsWith('fc') ||
    hostname.startsWith('fd')
  ) {
    throw new BadRequestError(`Refusing to reach a private IPv6 address: ${hostname}`)
  }

  return url
}

/**
 * POST `List-Unsubscribe=One-Click` to an RFC 8058 endpoint.
 *
 * Only ever called for the `one-click` tier. A URL WITHOUT the
 * `List-Unsubscribe-Post` header never reaches here — see
 * {@link import('./client').selectUnsubscribeMethod}, which routes it to the
 * `http` tier so the user opens it themselves.
 *
 * Redirects are followed manually so every hop is re-validated: the runtime's
 * own follower would happily walk an `https://` start into `http://` or into a
 * link-local address. A redirect to a non-public or non-HTTPS location throws.
 */
export async function postOneClickUnsubscribe(
  httpUrl: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<OneClickPostResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const doFetch = opts.fetchImpl ?? fetch

  let url = assertPublicHttpsUrl(httpUrl)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const response = await doFetch(url.toString(), {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          // No cookies, no Authorization, no referrer — this request must carry
          // nothing that identifies the org or the user beyond the opaque token
          // already embedded in the sender's own URL.
          accept: '*/*',
        },
        body: ONE_CLICK_BODY,
        redirect: 'manual',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      })

      const location = response.headers.get('location')
      if (response.status >= 300 && response.status < 400 && location) {
        if (hop === MAX_REDIRECTS) {
          throw new BadRequestError('The unsubscribe endpoint redirected too many times')
        }
        // Re-validated, so a redirect can never downgrade the scheme or walk us
        // onto a private host.
        url = assertPublicHttpsUrl(new URL(location, url).toString())
        continue
      }

      await drainBounded(response)

      return {
        accepted: response.status >= 200 && response.status < 300,
        status: response.status,
        finalUrl: url.toString(),
      }
    }

    throw new BadRequestError('The unsubscribe endpoint redirected too many times')
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Read and discard at most {@link MAX_RESPONSE_BYTES}, then cancel.
 *
 * We want the status code and nothing else; an endpoint that streams
 * indefinitely must not hold the worker. Any failure while draining is
 * swallowed — the response already told us what we needed.
 */
async function drainBounded(response: Response): Promise<void> {
  const body = response.body
  if (!body) return

  const reader = body.getReader()
  let read = 0
  try {
    while (read < MAX_RESPONSE_BYTES) {
      const { done, value } = await reader.read()
      if (done) return
      read += value?.byteLength ?? 0
    }
    logger.debug('Truncated an oversized unsubscribe response', { read })
  } catch {
    // The status is already in hand.
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}
