// apps/web/src/components/mail/utils/sandboxed-email-html.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { useCallback, useEffect, useRef, useState } from 'react'

interface SandboxedEmailHtmlProps {
  html: string
  className?: string
}

/**
 * Renders untrusted email HTML inside a sandboxed iframe with a restrictive CSP.
 * - `sandbox="allow-same-origin"`: no scripts, forms, popups, or navigation
 * - CSP meta tag blocks scripts, frames, and restricts image sources
 * - Auto-resizes iframe to match content height
 * - Forces a light colour scheme on the inner document so neither the OS nor
 *   the app theme can leave a sender's uncoloured body unreadable (see
 *   `BASE_STYLES`)
 *
 * Only for channels that actually carry sender HTML — a plain-text channel
 * (SMS/Quo and friends) must render `textPlain` directly. See
 * `supportsRichText` in `./channel-rich-text`.
 */
export function SandboxedEmailHtml({ html, className }: SandboxedEmailHtmlProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(0)

  const updateHeight = useCallback(() => {
    const doc = iframeRef.current?.contentDocument
    if (doc?.body) {
      const contentHeight = Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight)
      setHeight(contentHeight)
    }
  }, [])

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    const handleLoad = () => {
      updateHeight()
      // Observe content size changes for dynamic content like images loading
      const doc = iframe.contentDocument
      if (doc?.body) {
        const observer = new ResizeObserver(updateHeight)
        observer.observe(doc.body)
        observer.observe(doc.documentElement)
        return () => observer.disconnect()
      }
    }

    iframe.addEventListener('load', handleLoad)
    return () => iframe.removeEventListener('load', handleLoad)
  }, [updateHeight])

  const srcdoc = buildSrcdoc(html)

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcdoc}
      sandbox='allow-same-origin'
      scrolling='no'
      title='Email content'
      className={cn('w-full border-0', className)}
      style={{ height: `${height}px`, overflow: 'hidden' }}
    />
  )
}

const CSP_TAG =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src 'self' https: data: blob:; style-src 'unsafe-inline'; frame-src 'none'; script-src 'none'; form-action 'none';\">"

/**
 * Baseline styles injected into every sandboxed email document.
 *
 * Three rules carry the readability contract, all deliberate:
 *
 * 1. `color-scheme: light` is forced on `:root`. An iframe document that
 *    declares no scheme falls back to the **OS** `prefers-color-scheme`, never
 *    the app theme — so the app in light mode on a dark-mode OS rendered white
 *    text on a white bubble. `!important` because this is the one property we
 *    must own: a sender declaring `color-scheme: light dark` would otherwise
 *    hand the frame straight back to the OS.
 * 2. An opaque white canvas on `html`. Email HTML is authored against a white
 *    page — senders set a text colour and no background constantly. Painting
 *    the canvas with the app's dark background would turn every one of those
 *    into dark-on-dark. Put on `html` rather than `body` so a sender's own
 *    `body { background }` or `<body bgcolor>` still paints over it.
 * 3. `color` is an explicit value, never `inherit`. `inherit` on `body` inside
 *    an iframe resolves against that document's own `html`, not the host page,
 *    so it silently meant "UA default" — the OS-dependent value again.
 *
 * Everything is plain element-selector specificity with no `!important` (bar
 * the scheme), and this block is injected at the TOP of `<head>`, so a sender's
 * own `<style>` block or `style=` attribute always wins.
 */
const BASE_STYLES = `<style>:root { color-scheme: light !important; } html { background-color: #ffffff; } body, p, h1, h2, h3, h4, h5, h6, ul, ol, li, blockquote, pre, figure, figcaption, dl, dd { margin: 0; padding: 0; } body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; line-height: 1.5; color: #1f2937; word-wrap: break-word; overflow-wrap: break-word; overflow: hidden; } img { max-width: 100%; height: auto; }</style>`

/**
 * Wraps HTML in a full document with a restrictive CSP meta tag.
 * If the HTML is already a full document, injects CSP and base styles into the existing <head>.
 *
 * Exported for tests — the srcdoc string is the whole contract of this component.
 */
export function buildSrcdoc(html: string): string {
  const isFullDocument = /<html[\s>]/i.test(html)

  if (isFullDocument) {
    let result = html

    // Inject CSP + base styles into existing <head>
    const headMatch = result.match(/<head[^>]*>/i)
    if (headMatch) {
      const insertPos = (headMatch.index ?? 0) + headMatch[0].length
      result = result.slice(0, insertPos) + CSP_TAG + BASE_STYLES + result.slice(insertPos)
    }

    return result
  }

  return `<!DOCTYPE html>
<html>
<head>
${CSP_TAG}
${BASE_STYLES}
</head>
<body>${html}</body>
</html>`
}
