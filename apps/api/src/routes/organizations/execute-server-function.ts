// apps/api/src/routes/organizations/execute-server-function.ts

import { resolveAppConnectionForRuntime } from '@auxx/services/app-connections'
import { getInstallationBundle } from '@auxx/services/app-installations'
import { logServerFunctionExecution } from '@auxx/services/apps'
import { invokeLambdaExecutor, prepareLambdaContext } from '@auxx/services/lambda-execution'
import { Hono } from 'hono'
import { ERROR_STATUS_MAP, errorResponse } from '../../lib/response'
import type { AppContext } from '../../types/context'

const executeServerFunction = new Hono<AppContext>()

/**
 * POST /api/v1/organizations/:handle/apps/:appId/installations/:installationId/execute-server-function
 *
 * Execute a server function from an extension's server bundle.
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

      // 4. Build context and invoke Lambda
      const context = prepareLambdaContext({
        appId,
        installationId,
        organizationId: organization.id,
        organizationHandle: organization.handle,
        userId: user.id,
        userEmail: user.email,
        userName: user.name,
        userConnection: connections.userConnection,
        organizationConnection: connections.organizationConnection,
      })

      const lambdaResult = await invokeLambdaExecutor({
        caller: 'api',
        payload: {
          type: 'function',
          bundleKey: bundle.serverBundleS3Key,
          functionIdentifier: function_identifier,
          functionArgs: function_args,
          context,
        },
      })

      if (lambdaResult.isErr()) {
        const error = lambdaResult.error

        // Check for connection errors (not found or expired)
        if (error.code === 'CONNECTION_REQUIRED') {
          console.log('[ExecuteServerFunction] Connection error, returning prompt:', {
            code: error.code,
            scope: error.details?.scope,
          })
          return c.json(
            {
              error: {
                code: 'CONNECTION_REQUIRED',
                message: error.message,
                scope: error.details?.scope || 'user',
              },
            },
            403
          )
        }

        console.error('[ExecuteServerFunction] Lambda invocation failed:', {
          status: error.statusCode,
          error,
        })
        const statusCode = error.statusCode as 400 | 500
        return c.json(
          {
            error: {
              message: error.message,
              code: error.code,
              details: error.details,
            },
          },
          statusCode
        )
      }

      const result = lambdaResult.value

      // 5. Store console logs in database using service
      if (result.metadata?.consoleLogs && result.metadata.consoleLogs.length > 0) {
        const logResult = await logServerFunctionExecution({
          appId,
          organizationId: organization.id,
          appVersionId: installation.currentVersionId!,
          userId: user.id,
          functionIdentifier: function_identifier,
          installationId,
          consoleLogs: result.metadata.consoleLogs,
          durationMs: result.metadata?.duration,
        })

        if (logResult.isErr()) {
          console.error('[ExecuteServerFunction] Failed to store console logs:', logResult.error)
        } else {
          console.log('[ExecuteServerFunction] Stored console logs:', {
            logged: logResult.value.logged,
            logCount: result.metadata.consoleLogs.length,
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
