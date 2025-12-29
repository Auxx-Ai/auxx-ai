// packages/services/src/apps/log-server-function-execution.ts

import { database, AppEventLog } from '@auxx/database'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * Console log from app execution (server function or workflow block)
 */
export interface ConsoleLog {
  level: 'log' | 'warn' | 'error'
  message: string
  args: any[]
  timestamp: number
}

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

/**
 * Log app execution (server function or workflow block) with console logs
 * Supports both server function and workflow block executions
 *
 * @param params - Execution context and console logs
 * @returns Result with log entry or error
 */
export async function logAppExecution(params: {
  appId: string
  organizationId: string
  appVersionId: string
  userId: string
  installationId: string
  consoleLogs: ConsoleLog[]
  durationMs?: number
  execution: ExecutionContext
}) {
  const {
    appId,
    organizationId,
    appVersionId,
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

  // Build event type and data based on execution type
  const eventType =
    execution.type === 'server-function' ? 'server-function-execution' : 'workflow-block-execution'

  const eventData =
    execution.type === 'server-function'
      ? {
          functionIdentifier: execution.functionIdentifier,
          installationId,
          consoleLogs,
        }
      : {
          workflowId: execution.workflowId,
          runId: execution.runId,
          nodeId: execution.nodeId,
          blockId: execution.blockId,
          installationId,
          consoleLogs,
        }

  const requestPath =
    execution.type === 'server-function'
      ? '/execute-server-function'
      : `/workflows/${execution.workflowId}/runs/${execution.runId}/blocks/${execution.blockId}/execute`

  const insertResult = await fromDatabase(
    database
      .insert(AppEventLog)
      .values({
        appId,
        organizationId,
        appVersionId,
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

  if (insertResult.isErr()) {
    return insertResult
  }

  const [logEntry] = insertResult.value

  return ok({ logged: true, logEntry })
}

/**
 * Log server function execution with console logs
 * Backward compatibility wrapper for existing code
 *
 * @param params - Execution context and console logs
 * @returns Result with log entry or error
 */
export async function logServerFunctionExecution(params: {
  appId: string
  organizationId: string
  appVersionId: string
  userId: string
  functionIdentifier: string
  installationId: string
  consoleLogs: ConsoleLog[]
  durationMs?: number
}) {
  return logAppExecution({
    appId: params.appId,
    organizationId: params.organizationId,
    appVersionId: params.appVersionId,
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
