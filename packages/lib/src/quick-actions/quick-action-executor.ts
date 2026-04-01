// packages/lib/src/quick-actions/quick-action-executor.ts

import { createScopedLogger } from '@auxx/logger'
import type { DraftActionPayload } from '@auxx/types/draft'
import type { QuickActionExecutionContext, QuickActionResult } from './types'

const logger = createScopedLogger('quick-action-executor')

/**
 * Executes quick actions attached to a draft at send time.
 * Each action is executed via the Lambda runtime, using the same
 * infrastructure as workflow blocks.
 */
export class QuickActionExecutor {
  /**
   * Execute a single quick action via the app Lambda runtime.
   */
  async execute(
    action: DraftActionPayload,
    context: QuickActionExecutionContext
  ): Promise<QuickActionResult> {
    const startTime = Date.now()

    logger.info('Executing quick action', {
      appId: action.appId,
      actionId: action.actionId,
      installationId: action.installationId,
    })

    try {
      const { getInstallationDeployment } = await import('@auxx/services/app-installations')
      const { resolveAppConnectionForRuntime } = await import('@auxx/services/app-connections')
      const { prepareLambdaContext, invokeLambdaExecutor } = await import(
        '@auxx/services/lambda-execution'
      )

      // 1. Get app installation and deployment
      const installationResult = await getInstallationDeployment({
        installationId: action.installationId,
        organizationHandle: context.organizationHandle,
        appId: action.appId,
      })

      if (installationResult.isErr()) {
        throw new Error(
          `Failed to get installation deployment: ${installationResult.error.message}`
        )
      }

      const { serverBundleSha, installation, deployment } = installationResult.value

      if (!serverBundleSha) {
        throw new Error('App does not have a server bundle')
      }

      // 2. Resolve app connections
      const connectionsResult = await resolveAppConnectionForRuntime({
        appId: action.appId,
        organizationId: context.organizationId,
        userId: context.userId,
      })

      if (connectionsResult.isErr()) {
        throw new Error(`Failed to resolve connections: ${connectionsResult.error.message}`)
      }

      const connections = connectionsResult.value

      // 3. Prepare Lambda context
      const baseContext = prepareLambdaContext({
        appId: action.appId,
        installationId: installation.id,
        organizationId: context.organizationId,
        organizationHandle: context.organizationHandle,
        userId: context.userId,
        userEmail: context.userEmail,
        userName: context.userName,
        userConnection: connections.userConnection,
        organizationConnection: connections.organizationConnection,
      })

      // 4. Invoke Lambda executor
      const lambdaResult = await invokeLambdaExecutor({
        caller: 'quick-action',
        payload: {
          type: 'quick-action',
          serverBundleSha,
          actionId: action.actionId,
          inputs: action.inputs,
          context: {
            ...baseContext,
            threadId: context.threadId,
            ticketId: context.ticketId,
          },
          timeout: 30000,
        },
      })

      if (lambdaResult.isErr()) {
        const error = lambdaResult.error
        throw new Error(`Lambda execution failed: ${error.message}`)
      }

      const result = lambdaResult.value

      // Check for runtime errors
      if (result.metadata?.runtime_error) {
        throw new Error(result.metadata.runtime_error.message)
      }

      if (result.metadata?.validation_error) {
        throw new Error(result.metadata.validation_error.message)
      }

      const data = result.execution_result?.data || result.execution_result || {}
      const endTime = Date.now()

      // Persist console logs
      const consoleLogs = result.metadata?.consoleLogs || result.metadata?.console_logs || []
      if (consoleLogs.length > 0) {
        try {
          const { logAppExecution } = await import('@auxx/services/apps')
          await logAppExecution({
            appId: action.appId,
            organizationId: context.organizationId,
            appDeploymentId: deployment.id,
            userId: context.userId,
            installationId: installation.id,
            consoleLogs,
            durationMs: endTime - startTime,
            execution: {
              type: 'quick-action',
              actionId: action.actionId,
              threadId: context.threadId,
            },
          })
        } catch (logError) {
          logger.error('Failed to persist console logs', {
            appId: action.appId,
            actionId: action.actionId,
            error: logError instanceof Error ? logError.message : String(logError),
          })
        }
      }

      logger.info('Quick action executed successfully', {
        appId: action.appId,
        actionId: action.actionId,
        durationMs: endTime - startTime,
      })

      return {
        actionId: action.actionId,
        success: true,
        outputs: data,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      logger.error('Quick action execution failed', {
        appId: action.appId,
        actionId: action.actionId,
        error: message,
      })

      return {
        actionId: action.actionId,
        success: false,
        error: message,
      }
    }
  }

  /**
   * Execute multiple quick actions. Returns results for each action.
   * All actions run concurrently via Promise.allSettled.
   */
  async executeAll(
    actions: DraftActionPayload[],
    context: QuickActionExecutionContext
  ): Promise<QuickActionResult[]> {
    const results = await Promise.allSettled(actions.map((action) => this.execute(action, context)))

    return results.map((result, i) => {
      if (result.status === 'fulfilled') {
        return result.value
      }
      return {
        actionId: actions[i]!.actionId,
        success: false,
        error: result.reason instanceof Error ? result.reason.message : 'Unknown error',
      }
    })
  }
}
