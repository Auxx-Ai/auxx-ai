// src/app/preview/widget/[integrationId]/page.tsx
'use client'

import { env, WEBAPP_URL } from '@auxx/config/client'
import type { NextPage } from 'next'
import { useParams, useSearchParams } from 'next/navigation'
import Script from 'next/script' // Use Next.js Script component
import { useRef } from 'react'

// Define props type for Client Component (params are direct, not Promises)
interface PreviewWidgetPageProps {
  params: { integrationId: string }
  // searchParams are accessed via the hook, not passed as props here.
}

const PreviewWidgetPage: NextPage<PreviewWidgetPageProps> = () => {
  const params = useParams() // Get path parameters
  const queryParams = useSearchParams() // Get query parameters

  // Extract integrationId directly
  const integrationId = params?.integrationId as string | undefined

  // --- Early exit if essential params are missing ---
  if (!integrationId) {
    return <div>Loading parameters or invalid route...</div>
  }

  const organizationId = (queryParams.get('orgId') as string) || 'UNKNOWN_ORG'
  if (!organizationId || organizationId === 'UNKNOWN_ORG') {
    return (
      <div>Error: Organization ID (orgId) is missing in the preview link query parameters.</div>
    )
  }

  // --- Construct Config from URL parameters ---
  // Provide defaults matching the widget schema defaults where applicable
  const config = {
    integrationId,
    organizationId,
    title: (queryParams.get('title') as string) || 'Chat Preview',
    subtitle: (queryParams.get('subtitle') as string) || '',
    primaryColor: (queryParams.get('primaryColor') as string) || '#4F46E5',
    logoUrl: (queryParams.get('logoUrl') as string) || '',
    position: ((queryParams.get('position') as string) || 'BOTTOM_RIGHT').toLowerCase(),
    welcomeMessage: (queryParams.get('welcomeMessage') as string) || '',
    autoOpen: queryParams.get('autoOpen') === 'true',
    mobileFullScreen: queryParams.get('mobileFullScreen') !== 'false', // Default true unless explicitly false
    collectUserInfo: queryParams.get('collectUserInfo') === 'true',
    widgetId: integrationId, // Often same as integrationId, confirm if needed elsewhere
    pusherKey: env.NEXT_PUBLIC_PUSHER_KEY,
    pusherCluster: env.NEXT_PUBLIC_PUSHER_CLUSTER,
    // API Endpoints - Constructed here for clarity
    initEndpoint: `${WEBAPP_URL || ''}/api/trpc/chat.initialize`,
    sendMessageEndpoint: `${WEBAPP_URL || ''}/api/trpc/chat.sendMessage`,
  }

  const appBaseUrl = WEBAPP_URL || 'http://localhost:3000'
  const bundleUrl = `${appBaseUrl}/chat/bundle.js` // Path to your widget bundle
  const stylesUrl = `${appBaseUrl}/chat/styles.css` // Path to potential dynamic styles

  // Ref to prevent multiple bundle load attempts
  const bundleLoadInitiated = useRef(false)

  // --- Inline Script String to Initialize the Widget ---
  // Uses the 'config' object from the outer scope when executed.
  const initScriptContent = `
    console.log('[Preview] Dependencies loaded. Initializing AuxxChat...');
    if (window.AuxxChat && typeof window.AuxxChat.init === 'function') {
      // Config is stringified directly into the script
      var config = ${JSON.stringify(config)};
      console.log('[Preview] Calling window.AuxxChat.init with config:', config);
      try {
        window.AuxxChat.init(config);
        console.log('[Preview] AuxxChat initialization called.');
      } catch (e) {
        console.error('[Preview] Error calling AuxxChat.init:', e);
      }
    } else {
      console.error('[Preview] window.AuxxChat or window.AuxxChat.init not found after bundle load.');
    }
  `

  // --- Function to Load the Widget Bundle and Run Init Script ---
  const loadWidgetBundleAndInit = () => {
    // Prevent multiple executions
    if (bundleLoadInitiated.current) {
      console.warn('[Preview] Bundle loading already initiated.')
      return
    }
    bundleLoadInitiated.current = true // Mark as initiated

    console.log(`[Preview] Dependencies ready. Loading widget bundle from: ${bundleUrl}`)

    const bundleScriptTag = document.createElement('script')
    bundleScriptTag.id = 'auxx-chat-bundle-loader'
    bundleScriptTag.src = bundleUrl
    bundleScriptTag.async = true

    // When the bundle script loads successfully, execute the initialization script
    bundleScriptTag.onload = () => {
      console.log('[Preview] Widget bundle loaded successfully. Executing init script.')
      const initScriptTag = document.createElement('script')
      initScriptTag.id = 'auxx-chat-init-runner'
      try {
        // Inject the prepared initialization script string
        initScriptTag.innerHTML = initScriptContent
        document.body.appendChild(initScriptTag)
      } catch (e) {
        console.error('[Preview] Error creating or appending init script tag:', e)
      }
    }

    // Handle errors during bundle script loading
    bundleScriptTag.onerror = () => {
      console.error(
        `%c>>> [Preview] FAILED to load widget bundle: ${bundleUrl}`,
        'color: red; font-size: 1.1em; font-weight: bold;'
      )
      // Optionally display an error message to the user in the UI
    }

    document.body.appendChild(bundleScriptTag)
  }

  // --- Render the Page ---
  return (
    // Basic container for the preview page
    <div style={{ height: '100vh', width: '100vw', background: '#f7f9fc' }}>
      {/* Optional: Link to dynamic styles if needed */}
      <link rel='stylesheet' href={stylesUrl} />

      {/* Preview Banner */}
      <div
        className='preview-banner'
        style={{
          padding: '10px',
          background: '#2d3748',
          color: '#a0aec0',
          textAlign: 'center',
          fontSize: '12px',
          position: 'sticky', // Keep banner visible if page scrolls
          top: 0,
          zIndex: 10000, // Ensure banner is above widget button
        }}>
        Widget Preview - Using bundle from {bundleUrl}. Interacts with live backend.
        <br /> Integration ID: {integrationId} | Org ID: {organizationId}
      </div>

      {/* *** THE CONTAINER THE BUNDLE EXPECTS *** */}
      {/* Ensure this element exists before the bundle tries to find it */}
      <div id='auxx-chat-widget-container'></div>

      {/* Load Dependencies using next/script */}
      {/* Strategy 'beforeInteractive' attempts to load before the page becomes interactive */}
      {/* Pusher */}
      <Script
        src='https://js.pusher.com/8.3.0/pusher.min.js'
        crossOrigin='anonymous'
        onReady={() => {
          loadWidgetBundleAndInit()
        }}
        onError={() => console.error('[Preview] Failed to load Pusher.')}
      />
    </div>
  )
}

export default PreviewWidgetPage
