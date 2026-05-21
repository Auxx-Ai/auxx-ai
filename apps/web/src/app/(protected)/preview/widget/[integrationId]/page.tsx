// apps/web/src/app/(protected)/preview/widget/[integrationId]/page.tsx
'use client'

import { useParams } from 'next/navigation'
import { useMemo } from 'react'
import { useEnv } from '~/providers/dehydrated-state-provider'

/**
 * Preview surface for the embedded chat widget. The widget HTML lives inside
 * an `<iframe srcDoc>` so the document the script attaches to has none of our
 * Tailwind preflight, Inter font, or provider tree — it looks like a
 * customer's vanilla page, which is the only way the preview is a real
 * smoke test ("if it renders here, it renders anywhere").
 */
export default function PreviewWidgetPage() {
  const params = useParams<{ integrationId: string }>()
  const { appUrl } = useEnv()
  const integrationId = params?.integrationId

  const srcDoc = useMemo(() => {
    if (!integrationId) return null
    const bundleSrc = `${appUrl}/scripts/chat-widget.js`
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Auxx Chat Widget Preview</title>
    <style>
      html, body { margin: 0; padding: 0; height: 100%; background: #f7f9fc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1a202c; }
      .empty { display: flex; align-items: center; justify-content: center; height: 100%; color: #718096; font-size: 14px; }
    </style>
  </head>
  <body>
    <div class="empty">Preview</div>
    <script src="${bundleSrc}" data-channel-id="${integrationId}" async defer></script>
  </body>
</html>`
  }, [appUrl, integrationId])

  if (!integrationId || !srcDoc) {
    return <div style={{ padding: 16 }}>Loading…</div>
  }

  const bundleSrc = `${appUrl}/scripts/chat-widget.js`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw' }}>
      <div
        style={{
          padding: 10,
          background: '#2d3748',
          color: '#a0aec0',
          textAlign: 'center',
          fontSize: 12,
          flex: '0 0 auto',
        }}>
        Widget Preview — sandboxed iframe loading {bundleSrc}
        <br />
        Channel ID: <code>{integrationId}</code>
      </div>
      <iframe
        title='Chat Widget Preview'
        srcDoc={srcDoc}
        style={{ flex: '1 1 auto', border: 0, width: '100%' }}
      />
    </div>
  )
}
