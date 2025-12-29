// packages/services/src/workflows/create-workflow-node-execution.ts

import { database, schema } from '@auxx/database'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { WorkflowNodeExecutionEntity } from '@auxx/database/models'

/**
 * Create a workflow node execution record
 * Records the execution result of a workflow block/node
 *
 * @param params - Object containing execution details
 * @returns Result with created workflow node execution record
 */
export async function createWorkflowNodeExecution(params: {
  organizationId: string
  workflowAppId: string
  workflowId: string
  workflowRunId: string | null
  nodeId: string
  nodeType: string
  title: string
  index: number
  triggeredFrom: 'SINGLE_STEP' | 'WORKFLOW_RUN'
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'exception' | 'skipped' | 'stopped' | 'waiting'
  inputs?: Record<string, any>
  outputs?: Record<string, any>
  processData?: Record<string, any>
  error?: string
  elapsedTime?: number
  executionMetadata?: Record<string, any>
  finishedAt?: Date
  createdById?: string
  predecessorNodeId?: string
}) {
  const dbResult = await fromDatabase(
    database
      .insert(schema.WorkflowNodeExecution)
      .values({
        organizationId: params.organizationId,
        workflowAppId: params.workflowAppId,
        workflowId: params.workflowId,
        workflowRunId: params.workflowRunId,
        nodeId: params.nodeId,
        nodeType: params.nodeType,
        title: params.title,
        index: params.index,
        triggeredFrom: params.triggeredFrom,
        status: params.status,
        inputs: params.inputs,
        outputs: params.outputs,
        processData: params.processData,
        error: params.error,
        elapsedTime: params.elapsedTime,
        executionMetadata: params.executionMetadata,
        finishedAt: params.finishedAt,
        createdById: params.createdById,
        predecessorNodeId: params.predecessorNodeId,
      })
      .returning(),
    'create-workflow-node-execution'
  )

  if (dbResult.isErr()) {
    return dbResult
  }

  const created = dbResult.value[0]
  return ok(created as WorkflowNodeExecutionEntity)
}
