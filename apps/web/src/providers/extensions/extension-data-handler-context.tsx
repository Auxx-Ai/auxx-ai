// apps/web/src/providers/extensions/extension-data-handler-context.tsx
'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { useMessageClient } from '~/lib/extensions/use-message-client'
import type { MessageClient } from '~/lib/extensions/message-client'

/**
 * Extension data handler context value.
 * Provides extension-specific context to data handlers that process messages from the extension.
 */
interface ExtensionDataHandlerContextValue {
  /** The app ID (unique identifier for the app) */
  appId: string
  /** The installation ID (unique identifier for this organization's installation) */
  appInstallationId: string
  /** Message client for communicating with the extension's iframe */
  messageClient: MessageClient
  /** Whether dev logging is enabled for this extension */
  isDevLoggingEnabled: boolean
}

/**
 * Context for extension-specific data handler functionality.
 * Each extension installation gets its own instance of this context.
 */
const ExtensionDataHandlerContext = createContext<ExtensionDataHandlerContextValue | null>(null)

/**
 * Provides extension-specific context to data handlers.
 * Each extension installation gets its own instance of this context.
 *
 * Data handlers (Plans 4) will use this context to:
 * - Access the message client for communication
 * - Know which app they're handling messages for
 * - Enable conditional dev logging
 *
 * This component suspends until the MessageClient is available.
 */
export function ExtensionDataHandlerContextProvider({
  appId,
  appInstallationId,
  isDevLoggingEnabled,
  children,
}: {
  appId: string
  appInstallationId: string
  isDevLoggingEnabled: boolean
  children: ReactNode
}) {
  // This will suspend until MessageClient is available
  const messageClient = useMessageClient({ appId, appInstallationId })

  return (
    <ExtensionDataHandlerContext.Provider
      value={{ appId, appInstallationId, messageClient, isDevLoggingEnabled }}
    >
      {children}
    </ExtensionDataHandlerContext.Provider>
  )
}

/**
 * Hook to access extension-specific context in data handlers.
 * @throws {Error} If used outside of ExtensionDataHandlerContextProvider
 */
export function useExtensionDataHandlerContext() {
  const context = useContext(ExtensionDataHandlerContext)

  if (!context) {
    throw new Error(
      'useExtensionDataHandlerContext must be used within ExtensionDataHandlerContextProvider'
    )
  }

  return context
}
