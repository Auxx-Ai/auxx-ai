// packages/services/src/workflows/get-public-workflow-app.ts

import { database, schema } from '@auxx/database'
import { and, eq, isNotNull } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import type { DatabaseError } from '../shared/errors'
import { fromDatabase } from '../shared/utils'

/**
 * Public workflow error types
 */
export type PublicWorkflowAppError =
  | DatabaseError
  | {
      code: 'WORKFLOW_APP_NOT_FOUND'
      message: string
      workflowAppId: string
    }
  | {
      code: 'WORKFLOW_NOT_PUBLISHED'
      message: string
      workflowAppId: string
    }

/**
 * Column selection for WorkflowApp table
 */
export interface WorkflowAppColumns {
  id?: boolean
  name?: boolean
  description?: boolean
  enabled?: boolean
  isPublic?: boolean
  updatedAt?: boolean
  createdAt?: boolean
}

/**
 * Column selection for published workflow
 */
export interface PublishedWorkflowColumns {
  id?: boolean
  version?: boolean
  graph?: boolean
  createdAt?: boolean
  envVars?: boolean
}

/**
 * Options for fetching public workflow
 */
export interface GetPublicWorkflowAppOptions {
  workflowAppId: string
  /** Restrict columns returned from WorkflowApp table */
  columns?: WorkflowAppColumns
  /** Restrict columns returned from published workflow */
  publishedWorkflowColumns?: PublishedWorkflowColumns
}

/**
 * Default columns for public workflow queries
 */
export const DEFAULT_PUBLIC_COLUMNS: WorkflowAppColumns = {
  id: true,
  name: true,
  description: true,
  updatedAt: true,
}

/**
 * Default columns for published workflow
 */
export const DEFAULT_PUBLISHED_WORKFLOW_COLUMNS: PublishedWorkflowColumns = {
  id: true,
  version: true,
  graph: true,
  envVars: true,
}

/**
 * Get public workflow app for embedding/viewing
 * Only returns workflows marked as public with a published version
 *
 * @param options - Query options with column restrictions
 * @returns Result with workflow app data or an error
 */
export async function getPublicWorkflowApp(options: GetPublicWorkflowAppOptions) {
  const {
    workflowAppId,
    columns = DEFAULT_PUBLIC_COLUMNS,
    publishedWorkflowColumns = DEFAULT_PUBLISHED_WORKFLOW_COLUMNS,
  } = options

  const dbResult = await fromDatabase(
    database.query.WorkflowApp.findFirst({
      where: and(
        eq(schema.WorkflowApp.id, workflowAppId),
        eq(schema.WorkflowApp.isPublic, true),
        eq(schema.WorkflowApp.enabled, true),
        isNotNull(schema.WorkflowApp.workflowId)
      ),
      columns,
      with: {
        publishedWorkflow: {
          columns: publishedWorkflowColumns,
        },
      },
    }),
    'get-public-workflow-app'
  )

  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  const workflowApp = dbResult.value

  if (!workflowApp) {
    return err({
      code: 'WORKFLOW_APP_NOT_FOUND' as const,
      message: `Workflow ${workflowAppId} not found or not public`,
      workflowAppId,
    })
  }

  if (!workflowApp.publishedWorkflow) {
    return err({
      code: 'WORKFLOW_NOT_PUBLISHED' as const,
      message: `Workflow ${workflowAppId} does not have a published version`,
      workflowAppId,
    })
  }

  return ok({
    workflowApp,
    publishedWorkflow: workflowApp.publishedWorkflow,
  })
}
