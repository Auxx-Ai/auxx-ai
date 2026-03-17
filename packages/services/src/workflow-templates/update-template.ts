// packages/services/src/workflow-templates/update-template.ts

import { database, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { UpdateWorkflowTemplateInput, WorkflowTemplateDetail } from './types'

/**
 * Update an existing workflow template
 *
 * @param input - Template data to update
 * @returns Result containing updated template
 */
export async function updateTemplate(input: UpdateWorkflowTemplateInput) {
  const updateData: any = {
    updatedAt: new Date(),
  }

  if (input.name !== undefined) updateData.name = input.name
  if (input.description !== undefined) updateData.description = input.description
  if (input.categories !== undefined) updateData.categories = input.categories
  if (input.imgUrl !== undefined) updateData.imgUrl = input.imgUrl
  if (input.graph !== undefined) updateData.graph = input.graph
  if (input.version !== undefined) updateData.version = input.version
  if (input.status !== undefined) updateData.status = input.status
  if (input.triggerType !== undefined) updateData.triggerType = input.triggerType
  if (input.triggerConfig !== undefined) updateData.triggerConfig = input.triggerConfig
  if (input.envVars !== undefined) updateData.envVars = input.envVars
  if (input.variables !== undefined) updateData.variables = input.variables
  if (input.requiredApps !== undefined) updateData.requiredApps = input.requiredApps
  if (input.requiredEntities !== undefined) updateData.requiredEntities = input.requiredEntities
  if (input.popularity !== undefined) updateData.popularity = input.popularity

  const result = await fromDatabase(
    database
      .update(schema.WorkflowTemplate)
      .set(updateData)
      .where(eq(schema.WorkflowTemplate.id, input.id))
      .returning(),
    'update-workflow-template'
  )

  if (result.isErr()) {
    return result
  }

  if (!result.value[0]) {
    return err({
      code: 'TEMPLATE_NOT_FOUND',
      message: 'Workflow template not found',
      templateId: input.id,
    })
  }

  return ok(result.value[0] as WorkflowTemplateDetail)
}
