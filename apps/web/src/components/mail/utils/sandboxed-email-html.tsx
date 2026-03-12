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
 */
export function SandboxedEmailHtml({ html, className }: SandboxedEmailHtmlProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(100)

  const updateHeight = useCallback(() => {
    const doc = iframeRef.current?.contentDocument
    if (doc?.body) {
      const newHeight = doc.body.scrollHeight
      if (newHeight > 0) {
        setHeight(newHeight)
      }
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
      title='Email content'
      className={cn('w-full border-0', className)}
      style={{ height: `${height}px` }}
    />
  )
}

/**
 * Wraps HTML in a full document with a restrictive CSP meta tag.
 */
function buildSrcdoc(html: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data: blob:; style-src 'unsafe-inline'; frame-src 'none'; script-src 'none'; form-action 'none';">
<style>
  body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; line-height: 1.5; color: inherit; word-wrap: break-word; overflow-wrap: break-word; }
  img { max-width: 100%; height: auto; }
</style>
</head>
<body>${html}</body>
</html>`
}
