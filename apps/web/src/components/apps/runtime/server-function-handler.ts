// apps/web/src/components/apps/runtime/server-function-handler.ts

import { toastError } from '@auxx/ui/components/toast'
import { isConnectionDialogSuppressed } from './connection-dialog-suppression'
import { connectionExpiredEmitter } from './connection-expired-emitter'
import type { MessageClient } from './message-client'

interface ServerFunctionContext {
  appId: string
  appSlug: string
  appTitle: string
  appInstallationId: string
  organizationId: string
  organizationHandle: string
  userId: string
  userEmail: string
  apiUrl: string
  connectionDefinition?: {
    label: string
    global: boolean
    connectionType: 'oauth2-code' | 'secret' | 'none'
  }
}

interface ServerExecutionResult {
  error?: string
  value?: {
    error?: string
    value?: string
  }
}

/**
 * Set up handler for run-server-function requests from extension runtime.
 *
 * Platform makes HTTP POST to API server.
 *
 * @param messageClient - Message client for the extension
 * @param context - Execution context (app, user, org)
 */
export function setupServerFunctionHandler(
  messageClient: MessageClient,
  context: ServerFunctionContext
): () => void {
  const unsubscribe = messageClient.listenForRequest(
    'run-server-function',
    async (data: { moduleHash: string; args: string }): Promise<ServerExecutionResult> => {
      try {
        // Proxy through Next.js API route (handles auth via session cookies)
        const response = await fetch('/api/extensions/execute-server-function', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            appId: context.appId,
            installationId: context.appInstallationId,
            organizationHandle: context.organizationHandle,
            function_identifier: data.moduleHash,
            function_args: data.args,
          }),
        })

        // Handle HTTP errors
        if (!response.ok) {
          console.error('[ServerFunctionHandler] HTTP error:', response.status)

          // Show toast to user
          if (response.status === 401) {
            toastError({
              title: 'Authentication required',
              description: 'Please sign in to use this extension feature',
            })
            return { error: 'no-user-connection' }
          }

          if (response.status === 403) {
            // Try to parse error details to check for CONNECTION_REQUIRED
            let errorData
            try {
              errorData = await response.json()
            } catch (e) {}

            // Check if it's a CONNECTION_REQUIRED error
            if (errorData?.error?.code === 'CONNECTION_REQUIRED') {
              const scope = errorData.error.scope || 'user'
              const isExpired = errorData.error.message?.toLowerCase().includes('expired')

              // `connectionType: 'none'` means the app declares no connection to
              // re-authorize, so there is nothing the reconnect dialog could do —
              // fall through to the toast below.
              if (
                context.connectionDefinition &&
                context.connectionDefinition.connectionType !== 'none'
              ) {
                const { connectionType, label: connectionLabel } = context.connectionDefinition
                // Suppressed surfaces (e.g. the workflow builder editing an app
                // node) auto-load options via server functions — an expired
                // connection there shouldn't pop an unprompted modal. The App
                // Settings status dot already surfaces it. Run/test use a
                // different path and keep the dialog.
                if (isConnectionDialogSuppressed(context.appInstallationId)) {
                  return { error: 'connection-expired-awaiting-reauth' }
                }

                // Show inline reconnect dialog for both expired and missing connections
                connectionExpiredEmitter.emit({
                  appId: context.appId,
                  appSlug: context.appSlug,
                  appName: context.appTitle,
                  installationId: context.appInstallationId,
                  scope,
                  connectionType,
                  connectionLabel,
                  reason: isExpired ? 'expired' : 'missing',
                  pendingCall: {
                    moduleHash: data.moduleHash,
                    args: data.args,
                  },
                })

                return { error: 'connection-expired-awaiting-reauth' }
              }

              // No connectionDefinition — fall back to toast
              toastError({
                title: 'Connection Required',
                description:
                  errorData.error.message ||
                  `Please connect your ${scope} account to use this feature. Go to Settings > Apps to connect.`,
              })

              return {
                error: scope === 'user' ? 'no-user-connection' : 'no-organization-connection',
              }
            }

            // Generic 403 - access denied
            toastError({
              title: 'Access denied',
              description: 'You do not have permission to use this extension feature',
            })
            return { error: 'no-organization-connection' }
          }

          // Try to get error details for other error codes
          let errorMessage = 'Server function execution failed'
          try {
            const errorData = await response.json()
            if (errorData.error?.message) {
              errorMessage = errorData.error.message
            }
          } catch (e) {}

          toastError({
            title: 'Server function failed',
            description: errorMessage,
          })
          return { error: 'unexpected-transport-error' }
        }

        // Parse response
        const result = await response.json()

        // Response format: { execution_result: any }
        // Convert to runtime format: { value: { value: string } }
        if (result.execution_result !== undefined) {
          return {
            value: {
              value:
                result.execution_result === undefined
                  ? 'undefined'
                  : JSON.stringify(result.execution_result),
            },
          }
        }

        // Handle API errors
        if (result.error) {
          // Show toast to user with validation details if available
          if (result.error.code === 'VALIDATION_ERROR' && result.error.details) {
            const fieldErrors = result.error.details
              .map((d: any) => `${d.field}: ${d.message}`)
              .join(', ')
            toastError({
              title: 'Validation failed',
              description: `Server function validation failed: ${fieldErrors}`,
            })
          } else {
            toastError({
              title: 'Server function error',
              description:
                result.error.message || 'An error occurred while executing the server function',
            })
          }

          return {
            value: {
              error: JSON.stringify({
                message: result.error.message || 'Server function error',
                code: result.error.code || 'SERVER_FUNCTION_ERROR',
                details: result.error.details,
              }),
            },
          }
        }

        return { error: 'unexpected-transport-error' }
      } catch (error: any) {
        toastError({
          title: 'Failed to execute server function',
          description: 'An unexpected error occurred. Please try again.',
        })

        return { error: 'unexpected-transport-error' }
      }
    }
  )

  return unsubscribe
}
