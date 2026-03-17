// packages/services/src/workflow-templates/create-template.ts

import { database, schema } from '@auxx/database'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { CreateWorkflowTemplateInput, WorkflowTemplateDetail } from './types'

/**
 * Create a new workflow template
 *
 * @param input - Template data
 * @returns Result containing created template
 */
export async function createTemplate(input: CreateWorkflowTemplateInput) {
  const result = await fromDatabase(
    database
      .insert(schema.WorkflowTemplate)
      .values({
        name: input.name,
        description: input.description,
        categories: input.categories,
        imgUrl: input.imgUrl,
        graph: input.graph,
        version: input.version ?? 1,
        status: input.status ?? 'private',
        triggerType: input.triggerType,
        triggerConfig: input.triggerConfig,
        envVars: input.envVars,
        variables: input.variables,
        requiredApps: input.requiredApps ?? [],
        requiredEntities: input.requiredEntities ?? [],
        popularity: input.popularity ?? 0,
        updatedAt: new Date(),
      })
      .returning(),
    'create-workflow-template'
  )

  if (result.isErr()) {
    return result
  }

  return ok(result.value[0] as WorkflowTemplateDetail)
}
