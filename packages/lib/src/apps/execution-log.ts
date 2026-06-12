// packages/lib/src/apps/execution-log.ts

import { AppEventLog, database } from '@auxx/database'
import { fromDatabase } from '@auxx/services/shared/utils'
import { ok } from 'neverthrow'
import type { ConsoleLog } from './lambda'

/**
 * Execution context discriminated union
 */
export type ExecutionContext =
  | {
      type: 'server-function'
      functionIdentifier: string
    }
  | {
      type: 'workflow-block'
      workflowId: string
      runId: string
      nodeId: string
      blockId: string
    }
  | {
      // Tool invocation via the unified tool-executor (agent or action surface).
      // `invocationKind` mirrors `ToolInvocationContext.kind` on the lambda side.
      type: 'tool'
      toolId: string
      invocationKind: 'agent' | 'action'
      threadId?: string
      ticketId?: string
      sessionId?: string
      agentId?: string | null
      triggerId?: string | null
    }

/**
 * Log app execution (server function or workflow block) with console logs
 */
export async function logAppExecution(params: {
  appId: string
  organizationId: string
  appDeploymentId: string
  userId: string
  installationId: string
  consoleLogs: ConsoleLog[]
  durationMs?: number
  execution: ExecutionContext
}) {
  const {
    appId,
    organizationId,
    appDeploymentId,
    userId,
    installationId,
    consoleLogs,
    durationMs,
    execution,
  } = params

  // Only log if there are console logs
  if (!consoleLogs || consoleLogs.length === 0) {
    return ok({ logged: false })
  }

  const eventType =
    execution.type === 'server-function'
      ? 'server-function-execution'
      : execution.type === 'workflow-block'
        ? 'workflow-block-execution'
        : 'tool-execution'

  let eventData: Record<string, unknown>
  let requestPath: string
  switch (execution.type) {
    case 'server-function':
      eventData = {
        functionIdentifier: execution.functionIdentifier,
        installationId,
        consoleLogs,
      }
      requestPath = '/execute-server-function'
      break
    case 'workflow-block':
      eventData = {
        workflowId: execution.workflowId,
        runId: execution.runId,
        nodeId: execution.nodeId,
        blockId: execution.blockId,
        installationId,
        consoleLogs,
      }
      requestPath = `/workflows/${execution.workflowId}/runs/${execution.runId}/blocks/${execution.blockId}/execute`
      break
    case 'tool':
      eventData = {
        toolId: execution.toolId,
        invocationKind: execution.invocationKind,
        threadId: execution.threadId,
        ticketId: execution.ticketId,
        sessionId: execution.sessionId,
        agentId: execution.agentId,
        triggerId: execution.triggerId,
        installationId,
        consoleLogs,
      }
      requestPath = `/tools/${execution.toolId}/execute`
      break
  }

  const insertResult = await fromDatabase(
    database
      .insert(AppEventLog)
      .values({
        appId,
        organizationId,
        appDeploymentId,
        userId,
        eventType,
        eventData,
        requestMethod: 'POST',
        requestPath,
        responseStatus: 200,
        durationMs,
      })
      .returning(),
    'log-app-execution'
  )

  if (insertResult.isErr()) return insertResult

  const [logEntry] = insertResult.value

  return ok({ logged: true, logEntry })
}

/**
 * Log server function execution with console logs
 * Backward compatibility wrapper for existing code
 */
export async function logServerFunctionExecution(params: {
  appId: string
  organizationId: string
  appDeploymentId: string
  userId: string
  functionIdentifier: string
  installationId: string
  consoleLogs: ConsoleLog[]
  durationMs?: number
}) {
  return logAppExecution({
    appId: params.appId,
    organizationId: params.organizationId,
    appDeploymentId: params.appDeploymentId,
    userId: params.userId,
    installationId: params.installationId,
    consoleLogs: params.consoleLogs,
    durationMs: params.durationMs,
    execution: {
      type: 'server-function',
      functionIdentifier: params.functionIdentifier,
    },
  })
}
