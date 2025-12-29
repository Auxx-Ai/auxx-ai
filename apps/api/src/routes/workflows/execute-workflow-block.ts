// apps/api/src/routes/workflows/execute-workflow-block.ts

/**
 * API endpoint for executing workflow blocks from apps
 */

import { Hono } from 'hono'
import { errorResponse, ERROR_STATUS_MAP } from '../../lib/response'
import type { AppContext } from '../../types/context'
import { getInstallationBundle } from '@auxx/services/app-installations'
import { resolveAppConnectionForRuntime } from '@auxx/services/app-connections'
import { getWorkflowRun, createWorkflowNodeExecution } from '@auxx/services/workflows'
import { prepareLambdaContext, invokeLambdaExecutor } from '@auxx/services/lambda-execution'
import { logAppExecution } from '@auxx/services/apps'

const executeWorkflowBlock = new Hono<AppContext>()

/**
 * POST /api/v1/workflows/:workflowId/runs/:runId/blocks/:blockId/execute
 *
 * Execute a workflow block from an app's server bundle.
 *
 * Request body:
 *   {
 *     appId: string
 *     installationId: string
 *     nodeId: string
 *     data: Record<string, any>
 *     variables: Record<string, any>
 *   }
 *
 * Response:
 *   {
 *     success: boolean
 *     data: any
 *     metadata: {
 *       duration: number
 *       logs: Array<{level, message, data, timestamp}>
 *       consoleLogs: Array<{level, message, args, timestamp}>
 *     }
 *   }
 */
executeWorkflowBlock.post('/:workflowId/runs/:runId/blocks/:blockId/execute', async (c) => {
  const organization = c.get('organization')
  const user = c.get('user')
  const workflowId = c.req.param('workflowId')
  const runId = c.req.param('runId')
  const blockId = c.req.param('blockId')

  try {
    const body = await c.req.json()
    const { appId, installationId, nodeId, data, variables } = body

    // 1. Validate workflow run exists
    const runResult = await getWorkflowRun({
      runId,
      workflowId,
    })

    if (runResult.isErr()) {
      const error = runResult.error
      return c.json(errorResponse(error.code, error.message), 404)
    }

    const run = runResult.value

    // 2. Verify workflow belongs to organization
    if (run.workflow.organizationId !== organization.id) {
      return c.json(errorResponse('FORBIDDEN', 'Workflow does not belong to organization'), 403)
    }

    // 3. Get app installation and bundle
    const installationResult = await getInstallationBundle({
      installationId,
      organizationHandle: organization.handle!,
      appId,
    })

    if (installationResult.isErr()) {
      const error = installationResult.error
      const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
      return c.json(errorResponse(error.code, error.message), statusCode)
    }

    const { installation, bundle } = installationResult.value

    if (!bundle.serverBundleS3Key) {
      return c.json(errorResponse('NO_SERVER_BUNDLE', 'App does not have a server bundle'), 400)
    }

    // 4. Resolve app connections
    const connectionsResult = await resolveAppConnectionForRuntime({
      appId,
      organizationId: organization.id,
      userId: user.id,
      versionMajor: installation.currentVersion?.major || 1,
    })

    if (connectionsResult.isErr()) {
      const error = connectionsResult.error
      console.error('[ExecuteWorkflowBlock] Failed to resolve connections:', error)
      return c.json(errorResponse(error.code as any, error.message), 500)
    }

    const connections = connectionsResult.value

    const startTime = Date.now()

    // Build workflow-specific context
    const workflowContext = {
      workflowId,
      runId,
      nodeId,
      variables: variables || {},
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      organization: {
        id: organization.id,
        handle: organization.handle,
        name: organization.name || organization.handle,
      },
    }

    // Build base Lambda context using helper
    const baseContext = prepareLambdaContext({
      appId,
      installationId: installation.id,
      organizationId: organization.id,
      organizationHandle: organization.handle,
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
      userConnection: connections.userConnection,
      organizationConnection: connections.organizationConnection,
    })

    // Invoke Lambda using helper
    const lambdaResult = await invokeLambdaExecutor({
      payload: {
        type: 'workflow-block',
        bundleKey: bundle.serverBundleS3Key,
        blockId,
        workflowContext,
        workflowInput: data,
        context: baseContext,
        timeout: 30000,
      },
    })

    if (lambdaResult.isErr()) {
      const error = lambdaResult.error

      // Handle connection errors specially
      if (error.code === 'CONNECTION_REQUIRED') {
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

      // Other errors
      return c.json(
        {
          error: {
            message: error.message,
            code: error.code,
            details: error.details,
          },
        },
        error.statusCode as 403
      )
    }

    const result = lambdaResult.value
    const endTime = Date.now()

    // 6. Store execution result in database
    const nodeExecutionResult = await createWorkflowNodeExecution({
      organizationId: organization.id,
      workflowAppId: run.workflowAppId,
      workflowId: workflowId,
      workflowRunId: runId,
      nodeId,
      nodeType: 'app-block', // This is a workflow block from an app
      title: blockId, // Use blockId as title for now
      index: 0, // TODO: Get actual index from workflow graph
      triggeredFrom: 'SINGLE_STEP',
      status: result.error ? 'failed' : 'succeeded',
      inputs: data,
      outputs: result.execution_result?.data,
      error: result.error ? JSON.stringify(result.error) : undefined,
      elapsedTime: endTime - startTime,
      executionMetadata: result.metadata,
      finishedAt: new Date(endTime),
      createdById: user.id,
    })

    if (nodeExecutionResult.isErr()) {
      console.error(
        '[ExecuteWorkflowBlock] Failed to store node execution:',
        nodeExecutionResult.error
      )
      // Don't fail the request - just log the error
    }

    // 7. Store console logs (if any)
    if (result.metadata?.consoleLogs && result.metadata.consoleLogs.length > 0) {
      const logResult = await logAppExecution({
        appId,
        organizationId: organization.id,
        appVersionId: installation.currentVersionId!,
        userId: user.id,
        installationId: installation.id,
        consoleLogs: result.metadata.consoleLogs,
        durationMs: endTime - startTime,
        execution: {
          type: 'workflow-block',
          workflowId,
          runId,
          nodeId,
          blockId,
        },
      })

      if (logResult.isErr()) {
        console.error('[ExecuteWorkflowBlock] Failed to store console logs:', logResult.error)
        // Don't fail the request - just log the error
      }
    }

    // 8. Return execution result
    return c.json({
      success: !result.error,
      data: result.execution_result?.data,
      metadata: {
        duration: endTime - startTime,
        logs: result.metadata?.logs || [],
        consoleLogs: result.metadata?.consoleLogs || [],
      },
      error: result.error,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : ''
    console.error('[ExecuteWorkflowBlock] Error:', message)
    return c.json(
      {
        error: {
          message: message || 'Unknown error',
          code: 'WORKFLOW_BLOCK_EXECUTION_ERROR',
        },
      },
      500
    )
  }
})

export default executeWorkflowBlock
