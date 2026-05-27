// apps/web/src/app/(protected)/preview/widget/[integrationId]/page.tsx
'use client'

import { useParams, useSearchParams } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
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
  const { appUrl, apiUrl } = useEnv()
  const integrationId = params?.integrationId
  const v = search?.get('v') ?? null
  const [previewTheme, setPreviewTheme] = useState<PreviewTheme>('light')
  const [iframeKey, setIframeKey] = useState(0)
  const [resetting, setResetting] = useState(false)

  const handleClearVisitor = useCallback(async () => {
    if (resetting) return
    setResetting(true)
    try {
      // Clear the `auxx_chat_session_id` cookie on the API origin.
      await fetch(`${apiUrl}/api/chat/passport/reset`, {
        method: 'POST',
        credentials: 'include',
      }).catch(() => {})
      // srcdoc iframes inherit the parent's origin, so the widget's
      // `window.localStorage` IS this page's localStorage. Rekeying the
      // iframe doesn't drop it — wipe the widget's keys here so the next
      // mount mints a fresh passport / participant and forgets the thread.
      const prefixes = [
        'auxx_passport_chat_',
        'auxx-chat-route:',
        'auxx-chat-expanded:',
        'auxx-chat-read:',
        'auxx-chat-privacy-dismissed:',
      ]
      for (let i = window.localStorage.length - 1; i >= 0; i--) {
        const key = window.localStorage.key(i)
        if (key && prefixes.some((p) => key.startsWith(p))) {
          window.localStorage.removeItem(key)
        }
      }
      for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
        const key = window.sessionStorage.key(i)
        if (key && key.startsWith('auxx-chat-identify:')) {
          window.sessionStorage.removeItem(key)
        }
      }
    } finally {
      setIframeKey((k) => k + 1)
      setResetting(false)
    }
  }, [apiUrl, resetting])

  const srcDoc = useMemo(() => {
    if (!integrationId) return null
    const vAttr = v ? ` data-v="${encodeURIComponent(v)}"` : ''
    const bundleSrc = `${appUrl}/scripts/chat-widget.js${v ? `?v=${encodeURIComponent(v)}` : ''}`
    const isDark = previewTheme === 'dark'
    const bg = isDark ? '#0d1117' : previewTheme === 'system' ? 'canvas' : '#f7f9fc'
    const fg = isDark ? '#e2e8f0' : '#1a202c'
    const muted = isDark ? '#94a3b8' : '#64748b'
    const cardBg = isDark ? '#161b22' : '#ffffff'
    const cardBorder = isDark ? '#30363d' : '#e2e8f0'
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Auxx Chat Widget Preview</title>
    <style>
      html, body { margin: 0; padding: 0; min-height: 100%; background: ${bg}; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: ${fg}; }
      .stage { position: relative; min-height: 100vh; padding: 48px 64px 120px; overflow: hidden; }
      /* Colored blobs scattered behind everything so the glass blur has
         something interesting to filter. Soft, large, low-saturation. */
      .blob { position: absolute; border-radius: 50%; filter: blur(40px); opacity: ${isDark ? 0.4 : 0.55}; pointer-events: none; }
      .blob-1 { width: 380px; height: 380px; top: -80px; left: -60px; background: #f472b6; }
      .blob-2 { width: 420px; height: 420px; top: 120px; right: 80px; background: #60a5fa; }
      .blob-3 { width: 320px; height: 320px; bottom: 60px; left: 30%; background: #34d399; }
      .blob-4 { width: 260px; height: 260px; bottom: -40px; right: 10%; background: #fbbf24; }
      .grid { position: relative; max-width: 960px; margin: 0 auto; display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
      h1 { font-size: 32px; font-weight: 700; margin: 0 0 12px; letter-spacing: -0.02em; }
      h2 { font-size: 18px; font-weight: 600; margin: 0 0 8px; letter-spacing: -0.01em; }
      p { font-size: 14px; line-height: 1.6; color: ${muted}; margin: 0 0 12px; }
      .card { background: ${cardBg}; border: 1px solid ${cardBorder}; border-radius: 12px; padding: 20px; }
      .center-card { position: relative; max-width: 380px; margin: 64px auto 0; padding: 32px; background: ${cardBg}; border: 1px solid ${cardBorder}; border-radius: 16px; box-shadow: 0 10px 30px -10px rgba(0,0,0,${isDark ? 0.6 : 0.15}); text-align: center; }
      .center-card .label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: ${muted}; margin-bottom: 8px; }
      .center-card .title { font-size: 24px; font-weight: 700; letter-spacing: -0.02em; }
      .pill { display: inline-block; padding: 4px 10px; border-radius: 999px; background: ${isDark ? '#1e293b' : '#eef2ff'}; color: ${isDark ? '#a5b4fc' : '#4f46e5'}; font-size: 12px; font-weight: 500; margin-right: 6px; }
    </style>
  </head>
  <body>
    <div class="stage">
      <div class="blob blob-1"></div>
      <div class="blob blob-2"></div>
      <div class="blob blob-3"></div>
      <div class="blob blob-4"></div>

      <div class="center-card">
        <div class="label">Preview</div>
        <div class="title">Customer page mock</div>
      </div>

      <div class="grid" style="margin-top: 48px">
        <div>
          <h1>Welcome back</h1>
          <p>This is a sample marketing page sitting behind your chat widget. Drag the widget around, scroll, switch themes — the glass surface should always pick up whatever is behind it.</p>
          <p><span class="pill">Live</span><span class="pill">Beta</span><span class="pill">v2.4</span></p>
        </div>
        <div class="card">
          <h2>Recent activity</h2>
          <p>An order was placed for €128.00 about 4 minutes ago. Inventory levels updated automatically.</p>
          <p>Three new sign-ups overnight. Conversion is trending +12% week over week.</p>
        </div>
        <div class="card">
          <h2>Tasks</h2>
          <p>• Reply to support thread #4821<br/>• Review the new pricing draft<br/>• Approve the November invoice batch</p>
        </div>
        <div>
          <h2>What customers are saying</h2>
          <p>"Faster than every other helpdesk we tried." — Pia, Operations Lead</p>
          <p>"Setup took 10 minutes. The AI replies feel native, not templated." — Marc, Founder</p>
        </div>
      </div>
    </div>
    <script src="${bundleSrc}" data-channel-id="${integrationId}" data-theme="${previewTheme}"${vAttr} async defer></script>
  </body>
</html>`
  }, [appUrl, integrationId, v, previewTheme])

  if (!integrationId || !srcDoc) {
    return <div style={{ padding: 16 }}>Loading…</div>
  }

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
          Widget Preview &nbsp;|&nbsp; Channel:{' '}
          <code style={{ color: '#e2e8f0' }}>{integrationId}</code>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type='button'
            onClick={handleClearVisitor}
            disabled={resetting}
            title='Clear the visitor session cookie + reload the widget. Fresh sessionId + Participant on next load.'
            style={{
              padding: '4px 10px',
              borderRadius: 4,
              border: '1px solid #4a5568',
              cursor: resetting ? 'wait' : 'pointer',
              fontSize: 11,
              background: '#1a202c',
              color: '#e2e8f0',
              opacity: resetting ? 0.6 : 1,
            }}>
            {resetting ? 'Clearing…' : 'Clear visitor'}
          </button>
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
      </div>
      <iframe
        key={`${previewTheme}-${iframeKey}`}
        title='Chat Widget Preview'
        srcDoc={srcDoc}
        style={{ flex: '1 1 auto', border: 0, width: '100%' }}
      />
    </div>
  )
}
