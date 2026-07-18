// packages/lib/src/signals/email/instrument-html.ts
// Single instrumentation entry point every send path calls before dispatch (Phase 2 of
// plans/signals/02-email-engagement.md "Open + click tracking"). Injects an open pixel and/or
// rewrites `<a href>` links to click-tracking redirects, using the tokens minted by
// `./tracking-tokens.ts`. Regex-based HTML rewriting — the input is our own generated email
// HTML, not adversarial user markup, so a full HTML parser is unnecessary overhead here.

import { API_URL, TRACK_URL } from '@auxx/config/urls'
import {
  buildClickTrackingUrl,
  buildOpenPixelUrl,
  issueClickToken,
  issueOpenToken,
} from './tracking-tokens'

export interface InstrumentEmailHtmlInput {
  html: string
  organizationId: string
  messageId: string
  contactEntityInstanceId?: string
  channelId?: string
  opens: boolean
  clicks: boolean
  /** Exact URLs never to wrap (e.g. the unsubscribe URL — it must stay a plain, unwrapped link). */
  skipUrls?: string[]
}

const A_TAG_REGEX = /<a\b[^>]*>/gi
const HREF_ATTR_REGEX = /(?<![\w-])href\s*=\s*("([^"]*)"|'([^']*)')/i
const CLOSING_BODY_REGEX = /<\/body\s*>/i

/** Extracts and trims the `href` attribute value from a single `<a ...>` tag, if present. */
function extractHref(tag: string): string | undefined {
  const match = tag.match(HREF_ATTR_REGEX)
  if (!match) return undefined
  const raw = match[2] !== undefined ? match[2] : match[3]
  return raw?.trim()
}

/** Links we never wrap: non-http(s) schemes, already-tracked links, unsubscribe links, and caller-supplied exclusions. */
function shouldSkipHref(href: string, skipUrls: Set<string>): boolean {
  if (!/^https?:\/\//i.test(href)) return true
  if (href.startsWith(TRACK_URL)) return true
  if (href.startsWith(`${API_URL}/u`)) return true
  if (skipUrls.has(href)) return true
  return false
}

/** Replaces just the `href` value within a single `<a ...>` tag, preserving its quote style and every other attribute. */
function replaceHref(tag: string, trackingUrl: string): string {
  return tag.replace(HREF_ATTR_REGEX, (_full, _quoted, doubleQuoted) =>
    doubleQuoted !== undefined ? `href="${trackingUrl}"` : `href='${trackingUrl}'`
  )
}

interface ClickWrapContext {
  organizationId: string
  messageId: string
  contactEntityInstanceId?: string
  channelId?: string
  skipUrls: Set<string>
}

/**
 * Rewrites every wrappable `<a href="http(s)://...">` in the HTML to a click-tracking
 * redirect URL. One token is issued per unique URL — a URL repeated across multiple links
 * (e.g. a CTA button mirrored in the header and footer) reuses the same token.
 */
async function wrapClickLinks(html: string, ctx: ClickWrapContext): Promise<string> {
  const uniqueUrls = new Set<string>()
  for (const match of html.matchAll(A_TAG_REGEX)) {
    const href = extractHref(match[0])
    if (href && !shouldSkipHref(href, ctx.skipUrls)) uniqueUrls.add(href)
  }
  if (uniqueUrls.size === 0) return html

  const entries = await Promise.all(
    Array.from(uniqueUrls).map(async (url) => {
      const token = await issueClickToken({
        organizationId: ctx.organizationId,
        messageId: ctx.messageId,
        contactEntityInstanceId: ctx.contactEntityInstanceId,
        channelId: ctx.channelId,
        url,
      })
      return [url, buildClickTrackingUrl(token, url)] as const
    })
  )
  const trackingUrlByOriginal = new Map(entries)

  return html.replace(A_TAG_REGEX, (tag) => {
    const href = extractHref(tag)
    const trackingUrl = href ? trackingUrlByOriginal.get(href) : undefined
    return trackingUrl ? replaceHref(tag, trackingUrl) : tag
  })
}

/** Injects the 1x1 open-tracking pixel immediately before `</body>`, or appends it if there's no `</body>`. */
function injectOpenPixel(html: string, token: string): string {
  const pixel = `<img src="${buildOpenPixelUrl(token)}" width="1" height="1" alt="" style="display:none;max-width:1px;max-height:1px;" />`
  return CLOSING_BODY_REGEX.test(html)
    ? html.replace(CLOSING_BODY_REGEX, `${pixel}</body>`)
    : `${html}${pixel}`
}

/**
 * Instruments outbound email HTML for open/click tracking. The single call site every send
 * path (sequences, receipts, document sends, manual replies) routes through — callers just
 * flip `opens`/`clicks` per the org/channel's tracking settings.
 */
export async function instrumentEmailHtml(input: InstrumentEmailHtmlInput): Promise<string> {
  if (!input.opens && !input.clicks) return input.html

  let html = input.html

  if (input.clicks) {
    html = await wrapClickLinks(html, {
      organizationId: input.organizationId,
      messageId: input.messageId,
      contactEntityInstanceId: input.contactEntityInstanceId,
      channelId: input.channelId,
      skipUrls: new Set(input.skipUrls ?? []),
    })
  }

  if (input.opens) {
    const token = await issueOpenToken({
      organizationId: input.organizationId,
      messageId: input.messageId,
      contactEntityInstanceId: input.contactEntityInstanceId,
      channelId: input.channelId,
    })
    html = injectOpenPixel(html, token)
  }

  return html
}
