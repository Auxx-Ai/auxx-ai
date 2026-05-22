// apps/web/src/app/(protected)/preview/widget/[integrationId]/page.tsx
'use client'

import { useParams, useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import { useEnv } from '~/providers/dehydrated-state-provider'

type PreviewTheme = 'light' | 'dark' | 'system'

const THEME_LABELS: Record<PreviewTheme, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
}

/**
 * Preview surface for the embedded chat widget. The widget HTML lives inside
 * an `<iframe srcDoc>` so the document the script attaches to has none of our
 * Tailwind preflight, Inter font, or provider tree — it looks like a
 * customer's vanilla page, which is the only way the preview is a real
 * smoke test ("if it renders here, it renders anywhere").
 *
 * The Light / Dark / System toggle overrides the widget theme for this preview
 * session only — it does not save the setting.
 */
export default function PreviewWidgetPage() {
  const params = useParams<{ integrationId: string }>()
  const search = useSearchParams()
  const { appUrl } = useEnv()
  const integrationId = params?.integrationId
  const v = search?.get('v') ?? null
  const [previewTheme, setPreviewTheme] = useState<PreviewTheme>('light')

  const srcDoc = useMemo(() => {
    if (!integrationId) return null
    const vAttr = v ? ` data-v="${encodeURIComponent(v)}"` : ''
    const bundleSrc = `${appUrl}/scripts/chat-widget.js${v ? `?v=${encodeURIComponent(v)}` : ''}`
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Auxx Chat Widget Preview</title>
    <style>
      html, body { margin: 0; padding: 0; height: 100%; background: ${previewTheme === 'dark' ? '#0d1117' : previewTheme === 'system' ? 'canvas' : '#f7f9fc'}; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1a202c; }
      .empty { display: flex; align-items: center; justify-content: center; height: 100%; color: #718096; font-size: 14px; }
    </style>
  </head>
  <body>
    <div class="empty">Preview</div>
    <script src="${bundleSrc}" data-channel-id="${integrationId}" data-theme="${previewTheme}"${vAttr} async defer></script>
  </body>
</html>`
  }, [appUrl, integrationId, v, previewTheme])

  if (!integrationId || !srcDoc) {
    return <div style={{ padding: 16 }}>Loading…</div>
  }

  const bundleSrc = `${appUrl}/scripts/chat-widget.js`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw' }}>
      <div
        style={{
          padding: '8px 16px',
          background: '#2d3748',
          color: '#a0aec0',
          fontSize: 12,
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}>
        <span>
          Widget Preview — {bundleSrc} &nbsp;|&nbsp; Channel:{' '}
          <code style={{ color: '#e2e8f0' }}>{integrationId}</code>
        </span>
        <div
          style={{
            display: 'flex',
            gap: 2,
            background: '#1a202c',
            borderRadius: 6,
            padding: 2,
          }}>
          {(['light', 'dark', 'system'] as const).map((t) => (
            <button
              key={t}
              type='button'
              onClick={() => setPreviewTheme(t)}
              style={{
                padding: '3px 10px',
                borderRadius: 4,
                border: 'none',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: previewTheme === t ? 600 : 400,
                background: previewTheme === t ? '#4a5568' : 'transparent',
                color: previewTheme === t ? '#f7fafc' : '#a0aec0',
                transition: 'background 0.15s',
              }}>
              {THEME_LABELS[t]}
            </button>
          ))}
        </div>
      </div>
      <iframe
        key={previewTheme}
        title='Chat Widget Preview'
        srcDoc={srcDoc}
        style={{ flex: '1 1 auto', border: 0, width: '100%' }}
      />
    </div>
  )
}
