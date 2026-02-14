// apps/api/src/routes/organizations/execute-server-function.ts

import { SERVER_FUNCTION_EXECUTOR_URL } from '@auxx/config/server'
import { LAMBDA_API_URL } from '@auxx/config/urls'
import { resolveAppConnectionForRuntime } from '@auxx/services/app-connections'
import { getInstallationBundle } from '@auxx/services/app-installations'
import { logServerFunctionExecution } from '@auxx/services/apps'
import { Hono } from 'hono'
import { ERROR_STATUS_MAP, errorResponse } from '../../lib/response'
import type { AppContext } from '../../types/context'

const executeServerFunction = new Hono<AppContext>()

/**
 * POST /api/v1/organizations/:handle/apps/:appId/installations/:installationId/execute-server-function
 *
 * Execute a server function from an extension's server bundle.
 *
 * Request body:
 *   {
 *     function_identifier: string  // moduleHash (e.g., "actions/myAction.server")
 *     function_args: string         // JSON-stringified array of arguments
 *   }
 *
 * Response:
 *   {
 *     execution_result: any  // Result from server function
 *   }
 *
 * OR error:
 *   {
 *     error: { message: string, code: string }
 *   }
 */
executeServerFunction.post(
  '/apps/:appId/installations/:installationId/execute-server-function',
  async (c) => {
    const organization = c.get('organization')
    const user = c.get('user')
    const appId = c.req.param('appId')
    const installationId = c.req.param('installationId')

    try {
      const body = await c.req.json()
      const { function_identifier, function_args } = body

      // 1. Get app installation from database
      const installationResult = await getInstallationBundle({
        installationId,
        organizationHandle: organization.handle!,
        appId,
      })

      if (installationResult.isErr()) {
        const error = installationResult.error
        const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
        return c.json(errorResponse('INTERNAL_ERROR', error.message), statusCode)
      }

      const { installation, bundle } = installationResult.value

      // 2. Check if server bundle exists
      if (!bundle.serverBundleS3Key) {
        return c.json(
          errorResponse('NO_SERVER_BUNDLE', 'This app does not have a server bundle'),
          400
        )
      }

      // 3. Resolve app connections
      const connectionsResult = await resolveAppConnectionForRuntime({
        appId,
        organizationId: organization.id,
        userId: user.id,
        versionMajor: installation.currentVersion?.major || 1,
      })

      if (connectionsResult.isErr()) {
        const error = connectionsResult.error
        console.error('[ExecuteServerFunction] Failed to resolve connections:', error)
        return c.json(errorResponse(error.code as any, error.message), 500)
      }

      const connections = connectionsResult.value

      const lambdaResponse = await fetch(SERVER_FUNCTION_EXECUTOR_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'function',
          bundleKey: bundle.serverBundleS3Key,
          functionIdentifier: function_identifier,
          functionArgs: function_args,
          context: {
            organizationId: organization.id,
            organizationHandle: organization.handle,
            userId: user.id,
            userEmail: user.email,
            appId,
            apiUrl: LAMBDA_API_URL,
            appInstallationId: installationId,

            // Pass connections
            userConnection: connections.userConnection,
            organizationConnection: connections.organizationConnection,
          },
        }),
      })

      if (!lambdaResponse.ok) {
        let errorData
        try {
          errorData = await lambdaResponse.json()
        } catch {
          const errorText = await lambdaResponse.text()
          errorData = { error: { message: errorText, code: 'UNKNOWN_ERROR' } }
        }

        // Check for connection errors (not found or expired)
        if (
          errorData.error?.code === 'CONNECTION_NOT_FOUND' ||
          errorData.error?.code === 'CONNECTION_EXPIRED'
        ) {
          console.log('[ExecuteServerFunction] Connection error, returning prompt:', {
            code: errorData.error.code,
            scope: errorData.error.scope,
          })
          return c.json(
            {
              error: {
                code: 'CONNECTION_REQUIRED',
                message: errorData.error.message,
                scope: errorData.error.scope || 'user',
                // Frontend uses this to show connection prompt
              },
            },
            403
          )
        }

        console.error('[ExecuteServerFunction] Lambda invocation failed:', {
          status: lambdaResponse.status,
          error: errorData,
        })
        const statusCode = lambdaResponse.status as 400 | 500
        // Return structured error to client
        return c.json(
          {
            error: {
              message: errorData.error?.message || 'Server function execution failed',
              code: errorData.error?.code || 'EXECUTION_ERROR',
              details: errorData.error?.details,
            },
          },
          statusCode
        )
      }

      const result = await lambdaResponse.json()

      // 5. Store console logs in database using service
      if (result.metadata?.console_logs && result.metadata.console_logs.length > 0) {
        const logResult = await logServerFunctionExecution({
          appId,
          organizationId: organization.id,
          appVersionId: installation.currentVersionId!,
          userId: user.id,
          functionIdentifier: function_identifier,
          installationId,
          consoleLogs: result.metadata.console_logs,
          durationMs: result.metadata?.duration,
        })

        if (logResult.isErr()) {
          // Don't fail the request if logging fails, just log the error
          console.error('[ExecuteServerFunction] Failed to store console logs:', logResult.error)
        } else {
          console.log('[ExecuteServerFunction] Stored console logs:', {
            logged: logResult.value.logged,
            logCount: result.metadata.console_logs.length,
          })
        }
      }

      // 6. Return execution result
      return c.json({
        execution_result: result.execution_result,
        metadata: result.metadata,
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : ''
      console.error('[ExecuteServerFunction] Error:', message)
      return c.json(
        {
          error: {
            message: message || 'Unknown error',
            code: 'SERVER_FUNCTION_ERROR',
          },
        },
        500
      )
    }
  }
)

export default executeServerFunction
