// packages/services/src/workflow-templates/get-template-by-id.ts

import { database, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { WorkflowTemplateDetail } from './types'

/**
 * Get a single workflow template by ID including full graph data
 *
 * @param id - Template ID
 * @returns Result containing template with complete graph data
 */
export async function getTemplateById(id: string) {
  const result = await fromDatabase(
    database.query.WorkflowTemplate.findFirst({
      where: eq(schema.WorkflowTemplate.id, id),
    }),
    'get-workflow-template-by-id'
  )

  if (result.isErr()) {
    return result
  }

  if (!result.value) {
    return err({
      code: 'TEMPLATE_NOT_FOUND',
      message: 'Workflow template not found',
      templateId: id,
    })
  }

  return ok(result.value as WorkflowTemplateDetail)
}
