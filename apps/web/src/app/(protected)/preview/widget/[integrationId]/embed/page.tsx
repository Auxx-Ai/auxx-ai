// apps/web/src/app/(protected)/preview/widget/[integrationId]/embed/page.tsx
'use client'

import { useParams, useSearchParams } from 'next/navigation'
import { useMemo } from 'react'
import { useEnv } from '~/providers/dehydrated-state-provider'

type PreviewTheme = 'light' | 'dark' | 'system'

const VALID_THEMES: PreviewTheme[] = ['light', 'dark', 'system']

/**
 * Minimal widget mount for the in-settings preview pane. Sibling of the full
 * dev-tester at `../page.tsx` but stripped: no toolbar, no identity selector,
 * no JWT signer, no decorative background. Just the widget bundle on a
 * transparent surface, so the parent settings page can frame it however it
 * wants and the page itself blends with whatever theme is around it.
 *
 * Behavior is driven by query params:
 * - `intent` (one of: general, setup, appearance, behavior, identity) —
 *   accepted today so the parent can re-key the iframe on tab change; the
 *   widget itself doesn't read it yet because it lives in a closed shadow
 *   root that the embed page can't poke at from outside. Reserved for a
 *   follow-up that adds a `window.AuxxChat.open()` API.
 * - `theme` (light | dark | system) — overrides the channel's saved default,
 *   so the Appearance tab can offer a theme toggle without saving.
 * - `v` — cache-bust the widget bundle, same as the dev-tester.
 */
export default function PreviewWidgetEmbedPage() {
  const params = useParams<{ integrationId: string }>()
  const search = useSearchParams()
  const { appUrl, apiUrl } = useEnv()

  const integrationId = params?.integrationId
  const v = search?.get('v') ?? null
  const rawTheme = (search?.get('theme') ?? 'system') as PreviewTheme
  const theme: PreviewTheme = VALID_THEMES.includes(rawTheme) ? rawTheme : 'system'

  // `useEnv().apiUrl` is the v1 SDK base (`<origin>/api/v1`). The chat routes
  // live at the bare origin under `/api/chat/*` — strip the v1 suffix so the
  // widget's transport doesn't double-prefix.
  const chatApiBase = apiUrl.replace(/\/api\/v1\/?$/, '')

  const srcDoc = useMemo(() => {
    if (!integrationId) return null
    const vAttr = v ? ` data-v="${encodeURIComponent(v)}"` : ''
    const bundleSrc = `${appUrl}/scripts/chat-widget.js${v ? `?v=${encodeURIComponent(v)}` : ''}`

    // Force the widget open on mount — the preview pane is useless if the
    // tester has to click the launcher every reload.
    // `previewRounded` keeps the rounded shell in the mobile-fullscreen
    // layout (the iframe is phone-narrow so the mobile media query fires).
    // `previewBypassAudience` keeps the launcher visible on `users`-audience
    // channels so admins can preview them without signing a fake JWT.
    const programmaticConfig = {
      apiBase: chatApiBase,
      open: true,
      previewRounded: true,
      previewBypassAudience: true,
    }
    const bootHtml = `<script>
      window.__AUXX_CONFIG__ = ${JSON.stringify(programmaticConfig)};
    </script>
    <script src="${bundleSrc}" data-channel-id="${integrationId}" data-theme="${theme}"${vAttr} async defer></script>`

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Auxx Chat Widget Embed</title>
    <style>
      html, body { margin: 0; padding: 0; height: 100%; background: transparent; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .stage { position: relative; height: 100vh; width: 100vw; }
    </style>
  </head>
  <body>
    <div class="stage"></div>
    ${bootHtml}
  </body>
</html>`
  }, [appUrl, chatApiBase, integrationId, theme, v])

  if (!integrationId || !srcDoc) {
    return null
  }

  // Key is intentionally stable across `intent` changes — the widget persists
  // when the parent settings page switches tabs. Theme and `v` rotate the key
  // because those *do* require a fresh boot.
  return (
    <iframe
      key={`${theme}:${v ?? ''}`}
      title='Auxx chat widget preview'
      srcDoc={srcDoc}
      style={{
        border: 'none',
        width: '100%',
        height: '100vh',
        background: 'transparent',
      }}
      // `allow-same-origin` matches the dev-tester so localStorage works.
      sandbox='allow-scripts allow-same-origin allow-forms allow-popups'
      allow='clipboard-read; clipboard-write'
    />
  )
}
