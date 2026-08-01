// packages/lib/src/ingest/html-to-plain-text.ts

import { convert } from 'html-to-text'

/**
 * Derives a plain-text rendering of an HTML mail body.
 *
 * Mirrors what a well-formed `multipart/alternative` message would have carried
 * in its `text/plain` part, for providers that only hand us one body (Microsoft
 * Graph returns a single `body` with a single `contentType`).
 *
 * Deliberately does NOT strip quoted reply history. Gmail's stored `textPlain`
 * is the raw `text/plain` part including quotes, and the thread search corpus
 * and AI context builders assume that shape — stripping here would make Outlook
 * threads recall less than Gmail ones. `ImapMessageTextExtractorService` does
 * strip quotes with `planer`; that is IMAP's existing behaviour and is left
 * alone rather than unified, to avoid changing what IMAP already stores.
 *
 * Never throws: empty, whitespace-only and malformed markup all yield a string.
 */
export function deriveTextFromHtml(html: string): string {
  if (!html) return ''

  try {
    return convert(html, {
      wordwrap: false,
      preserveNewlines: true,
      selectors: [
        { selector: 'a', options: { ignoreHref: true } },
        { selector: 'img', format: 'skip' },
      ],
    }).trim()
  } catch {
    return ''
  }
}

/** First `max` characters of a body, collapsed to single spaces, for `Message.snippet`. */
export function deriveSnippet(text: string, max = 200): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`
}
