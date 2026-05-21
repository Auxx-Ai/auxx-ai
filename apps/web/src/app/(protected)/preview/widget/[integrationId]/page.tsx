// apps/web/src/app/(protected)/preview/widget/[integrationId]/page.tsx
'use client'

import { useParams } from 'next/navigation'
import Script from 'next/script'
import { useEnv } from '~/providers/dehydrated-state-provider'

/**
 * Preview surface for the embedded chat widget. Renders the exact one-line
 * `<script>` snippet a customer would paste, so the preview is the smoke
 * test — if it renders here, it renders anywhere.
 */
export default function PreviewWidgetPage() {
  const params = useParams<{ integrationId: string }>()
  const { appUrl } = useEnv()
  const integrationId = params?.integrationId

  if (!integrationId) {
    return <div style={{ padding: 16 }}>Loading…</div>
  }

  const bundleSrc = `${appUrl}/scripts/chat-widget.js`

  return (
    <div style={{ height: '100vh', width: '100vw', background: '#f7f9fc' }}>
      <div
        style={{
          padding: 10,
          background: '#2d3748',
          color: '#a0aec0',
          textAlign: 'center',
          fontSize: 12,
          position: 'sticky',
          top: 0,
          zIndex: 10000,
        }}>
        Widget Preview — embedding the real customer snippet from {bundleSrc}
        <br />
        Channel ID: <code>{integrationId}</code>
      </div>

      <Script src={bundleSrc} strategy='afterInteractive' data-channel-id={integrationId} />
    </div>
  )
}
