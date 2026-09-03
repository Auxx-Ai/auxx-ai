// packages/lib/src/companies/enrichment/metadata.ts
// Fetch a company homepage and pull the three things worth keeping: a clean name, a
// description, and a logo-ish image. Moved out of `field-hooks/post/company-triggers.ts`
// when enrichment gained more doors than `created`; the fetch/parse bodies are unchanged
// apart from the sanity filtering below.
//
// Everything here returns null rather than throwing on bad input. A homepage is arbitrary
// third-party HTML: it can be an empty body, a Cloudflare interstitial, a parked-domain
// placeholder, or a 200 that is actually a JSON error. Writing any of that onto a customer
// record is worse than writing nothing, so every extracted value goes through
// `cleanText` + a junk check before it is allowed out of this module.

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { load } from 'cheerio'
import { assertPublicHost, fetchAndStoreRemoteImage } from '../../files/fetch-remote-image'

const logger = createScopedLogger('companies:enrichment')

const HTML_FETCH_TIMEOUT_MS = 8000
const LOGO_FETCH_TIMEOUT_MS = 5000
const MAX_HTML_BYTES = 500_000
const MAX_LOGO_BYTES = 1_000_000
const USER_AGENT = 'AuxxAi-Enrichment/1.0 (+https://auxx.ai/bot)'

/** Below this a "name" is an artefact (an initial, a stray bullet), not a company. */
const MIN_NAME_LENGTH = 2
const MAX_NAME_LENGTH = 120
/** Below this a "description" is a label, not a description. */
const MIN_DESCRIPTION_LENGTH = 20
const MAX_DESCRIPTION_LENGTH = 500

/**
 * Titles that are the page's furniture rather than the company's name. Lowercased and
 * compared whole, so a real company called "Home Depot" is untouched.
 *
 * The bot-wall entries are the ones that actually bite: a site behind Cloudflare answers
 * 200 with `<title>Just a moment...</title>`, which sails past every other check and would
 * rename the record to that.
 */
const JUNK_NAMES = new Set([
  'home',
  'homepage',
  'home page',
  'index',
  'untitled',
  'untitled document',
  'welcome',
  'welcome!',
  'new page',
  'default',
  'default page',
  'coming soon',
  'under construction',
  'parked domain',
  'domain for sale',
  'just a moment',
  'just a moment...',
  'attention required!',
  'access denied',
  'forbidden',
  'not found',
  'error',
  'page not found',
  'security check',
  'redirecting',
  'loading',
  'website',
  'my site',
])

export interface WebsiteMetadata {
  siteName: string | null
  description: string | null
  faviconUrl: string | null
  appleTouchIconUrl: string | null
  ogImageUrl: string | null
}

/**
 * True when the fetch produced no CONTENT worth writing.
 *
 * ⚠️ The three image URLs deliberately do not count. `faviconUrl` falls back to a
 * hard-coded `/favicon.ico` guess, so it is non-null whenever the page was fetched at all
 * — including for a page whose title was a bot wall and whose description was absent.
 * Counting it would make this almost always false, and a company where every extracted
 * value was rejected would be recorded `enriched` (30-day lockout) instead of `failed`
 * (7-day retry). Whether an image was actually usable is answered by the stored asset id,
 * which the caller checks alongside this.
 */
export function isEmptyMetadata(m: WebsiteMetadata): boolean {
  return !m.siteName && !m.description
}

export function emptyMetadata(): WebsiteMetadata {
  return {
    siteName: null,
    description: null,
    faviconUrl: null,
    appleTouchIconUrl: null,
    ogImageUrl: null,
  }
}

/**
 * Fetch and parse one homepage. Never throws: a company we cannot reach is a `failed`
 * status, not an exception that costs the job its retry budget.
 *
 * `domain` is passed alongside the url purely so the junk check can reject a title that is
 * just the domain back at us, which is what parked pages and many small sites serve.
 */
export async function fetchWebsiteMetadata(url: string, domain: string): Promise<WebsiteMetadata> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HTML_FETCH_TIMEOUT_MS)

  try {
    assertPublicHost(url)

    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml',
      },
    })

    if (!res.ok) {
      logger.warn('Non-OK response fetching website', { url, status: res.status })
      return emptyMetadata()
    }

    // A 200 that is not HTML is a JSON API, a PDF, or an image at the apex. Parsing it as
    // markup yields a `<title>` of whatever the first bytes happened to be.
    const contentType = res.headers.get('content-type')?.toLowerCase() ?? ''
    if (contentType && !contentType.includes('html')) {
      logger.debug('Skipping non-HTML response', { url, contentType })
      return emptyMetadata()
    }

    const reader = res.body?.getReader()
    if (!reader) return emptyMetadata()

    const chunks: Uint8Array[] = []
    let total = 0
    while (total < MAX_HTML_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      total += value.byteLength
    }
    await reader.cancel()

    if (total === 0) {
      logger.debug('Empty response body', { url })
      return emptyMetadata()
    }

    const html = new TextDecoder('utf-8', { fatal: false }).decode(
      Buffer.concat(chunks.map((c) => Buffer.from(c)))
    )

    const $ = load(html)

    const rawTitle = $('title').first().text().trim()
    const titleFirstSegment = rawTitle ? rawTitle.split(/[|\-–—]/)[0]?.trim() : null

    const siteName = acceptName(
      $('meta[property="og:site_name"]').attr('content') ||
        $('meta[name="application-name"]').attr('content') ||
        titleFirstSegment,
      domain
    )

    const description = acceptDescription(
      $('meta[property="og:description"]').attr('content') ||
        $('meta[name="description"]').attr('content'),
      siteName,
      domain
    )

    const faviconUrl = resolveUrl(
      url,
      $('link[rel="icon"]').attr('href') ||
        $('link[rel="shortcut icon"]').attr('href') ||
        '/favicon.ico'
    )

    const appleTouchIconUrl = resolveUrl(url, $('link[rel="apple-touch-icon"]').attr('href'))
    const ogImageUrl = resolveUrl(url, $('meta[property="og:image"]').attr('content'))

    return { siteName, description, faviconUrl, appleTouchIconUrl, ogImageUrl }
  } catch (err) {
    logger.warn('Fetch website metadata failed', { url, error: (err as Error).message })
    return emptyMetadata()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Store the best logo candidate as a MediaAsset and return its id, or null when every
 * candidate failed.
 *
 * apple-touch-icon is usually the cleanest logo-like asset, followed by og:image, then the
 * tiny favicon as a last resort.
 */
export async function fetchAndStoreLogo(args: {
  organizationId: string
  userId: string
  metadata: WebsiteMetadata
}): Promise<string | null> {
  const candidates = [
    args.metadata.appleTouchIconUrl,
    args.metadata.ogImageUrl,
    args.metadata.faviconUrl,
  ].filter((v): v is string => typeof v === 'string' && v.length > 0)

  for (const url of candidates) {
    try {
      const result = await fetchAndStoreRemoteImage({
        db: database,
        url,
        organizationId: args.organizationId,
        userId: args.userId,
        pathPrefix: 'company-logos',
        purpose: 'company-logo',
        name: 'company-logo',
        maxBytes: MAX_LOGO_BYTES,
        timeoutMs: LOGO_FETCH_TIMEOUT_MS,
      })
      if (result.assetId) return result.assetId
    } catch (err) {
      logger.debug('Logo candidate failed', { url, error: (err as Error).message })
    }
  }

  return null
}

// ─── Value sanity ──────────────────────────────────────────────────────

/**
 * Trim, collapse internal whitespace, drop zero-width characters, and enforce a length
 * band. Returns null for anything that ends up empty or too short to mean something.
 *
 * The whitespace collapse matters more than it looks: `<title>` content is routinely
 * pretty-printed across several lines, and writing that verbatim puts newlines into a
 * single-line text field.
 */
export function cleanText(raw: string | null | undefined, min: number, max: number): string | null {
  if (typeof raw !== 'string') return null

  const collapsed = raw
    // Zero-width space / non-joiner / joiner / BOM, which survive `trim`.
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (collapsed.length < min) return null
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed
}

/** A site name we are willing to put on a record, or null. */
function acceptName(raw: string | null | undefined, domain: string): string | null {
  const cleaned = cleanText(raw, MIN_NAME_LENGTH, MAX_NAME_LENGTH)
  if (!cleaned) return null

  const lower = cleaned.toLowerCase()
  if (JUNK_NAMES.has(lower)) return null
  // The domain back at us is not an improvement on the domain we already stored.
  if (lower === domain || lower === `www.${domain}` || lower === domain.split('.')[0]) return null
  // A bare URL is a title on plenty of parked pages.
  if (/^https?:\/\//i.test(cleaned)) return null

  return cleaned
}

/** A description we are willing to put on a record, or null. */
function acceptDescription(
  raw: string | null | undefined,
  siteName: string | null,
  domain: string
): string | null {
  const cleaned = cleanText(raw, MIN_DESCRIPTION_LENGTH, MAX_DESCRIPTION_LENGTH)
  if (!cleaned) return null

  const lower = cleaned.toLowerCase()
  // A description that is just the name (or the domain) adds nothing and reads as a bug.
  if (siteName && lower === siteName.toLowerCase()) return null
  if (lower === domain) return null
  if (JUNK_NAMES.has(lower)) return null

  return cleaned
}

function resolveUrl(base: string, href: string | null | undefined): string | null {
  if (!href || href.trim().length === 0) return null
  try {
    const resolved = new URL(href.trim(), base)
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null
    return resolved.toString()
  } catch {
    return null
  }
}
