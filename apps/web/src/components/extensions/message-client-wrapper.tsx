// apps/web/src/components/extensions/message-client-wrapper.tsx
'use client'

import { useEffect, useMemo, useRef } from 'react'
import { MessageClient } from '~/lib/extensions/message-client'
import { setupServerFunctionHandler } from '~/lib/extensions/server-function-handler'
import {
  useDehydratedOrganization,
  useDehydratedUser,
  useEnvironment,
} from '~/providers/dehydrated-state-provider'
import { useInternalAppsContext } from '~/providers/extensions/internal-apps-context'

/**
 * MessageClientWrapper props.
 */
interface MessageClientWrapperProps {
  appId: string
  appSlug: string
  appInstallationId: string
  appTitle: string
  organizationId: string
  connectionDefinition?: {
    label: string
    global: boolean
    connectionType: 'oauth2-code' | 'secret' | 'none'
  }
}

/**
 * Creates and manages a MessageClient for a single extension.
 * Registers the client with AppStore and loads the extension bundle.
 */
export function MessageClientWrapper({
  appId,
  appSlug,
  appInstallationId,
  appTitle,
  organizationId,
  connectionDefinition,
}: MessageClientWrapperProps) {
  const { store } = useInternalAppsContext()
  const environment = useEnvironment()
  const user = useDehydratedUser()
  const organization = useDehydratedOrganization(organizationId)
  const messageClientRef = useRef<MessageClient>(null)
  const cleanupRef = useRef<(() => void)[]>([])

  // Extract stable values from objects to prevent unnecessary re-initialization
  // This prevents the useEffect from running when object references change but values are the same
  const apiUrl = environment.apiUrl
  const nodeEnv = environment.version.nodeEnv
  const userId = user.id
  const userName = user.name
  const userEmail = user.email
  const orgHandle = organization?.handle
  const orgName = organization?.name

  // Stabilize connectionDefinition object to prevent re-initialization
  // biome-ignore lint/correctness/useExhaustiveDependencies: using sub-properties for granular memoization to prevent unnecessary re-initialization
  const stableConnectionDef = useMemo(
    () => connectionDefinition,
    [
      connectionDefinition?.label,
      connectionDefinition?.global,
      connectionDefinition?.connectionType,
    ]
  )

  useEffect(() => {
    // Create MessageClient
    const client = new MessageClient(appId, appInstallationId, apiUrl)
    messageClientRef.current = client

    // Set up server function handler
    const unsubscribeServerFunction = setupServerFunctionHandler(client, {
      appId,
      appSlug,
      appTitle,
      appInstallationId,
      organizationId,
      organizationHandle: orgHandle!,
      userId,
      userEmail: userEmail!,
      apiUrl,
      connectionDefinition: stableConnectionDef,
    })
    cleanupRef.current.push(unsubscribeServerFunction)

    // Load extension bundle and register with AppStore only when ready
    const loadBundle = async () => {
      try {
        // Get bundle URL (API will redirect to S3 presigned URL)
        const bundleUrl = `${apiUrl}/organizations/${orgHandle}/apps/${appId}/installations/${appInstallationId}/bundle`

        // Initialize with context (passed to platform runtime via URL params)
        await client.initialize(bundleUrl, {
          organizationId,
          organizationHandle: orgHandle!,
          organizationName: orgName!,
          userId,
          userName: userName!,
          userEmail: userEmail!,
          apiUrl,
          isDevelopment: nodeEnv === 'development',
        })

        // Register with AppStore ONLY after bundle is ready
        store.setMessageClient({ appId, appInstallationId, messageClient: client })
      } catch (error) {
        console.error(`[MessageClientWrapper] Failed to load runtime for ${appTitle}:`, error)
        store.reportRenderError({
          appId,
          appInstallationId,
          error: error instanceof Error ? error : new Error(String(error)),
        })
      }
    }

    void loadBundle()

    // Cleanup on unmount
    return () => {
      // Call all cleanup functions
      cleanupRef.current.forEach((cleanup) => cleanup())
      cleanupRef.current = []

      client.destroy()
      store.removeMessageClient({ appId, appInstallationId })
    }
    // Dependencies: Only stable IDs and extracted primitive values
    // This prevents re-initialization when object references change but values stay the same
  }, [
    appId,
    appSlug,
    appInstallationId,
    appTitle,
    organizationId,
    stableConnectionDef,
    store,
    apiUrl,
    nodeEnv,
    userId,
    userName,
    userEmail,
    orgHandle,
    orgName,
  ])

  // This component doesn't render anything - it just manages the MessageClient
  return null
}
