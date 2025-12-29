// packages/services/src/workflow-templates/duplicate-template.ts

import { database, schema } from '@auxx/database'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import { getTemplateById } from './get-template-by-id'
import type { WorkflowTemplateDetail } from './types'

/**
 * Duplicate a workflow template (for creating variants)
 *
 * @param id - Template ID to duplicate
 * @returns Result containing the new duplicated template
 */
export async function duplicateTemplate(id: string) {
  // Get original template
  const originalResult = await getTemplateById(id)

  if (originalResult.isErr()) {
    return originalResult
  }

  const original = originalResult.value

  // Create duplicate
  const result = await fromDatabase(
    database
      .insert(schema.WorkflowTemplate)
      .values({
        name: `${original.name} (Copy)`,
        description: original.description,
        categories: original.categories,
        imgUrl: original.imgUrl,
        graph: original.graph,
        version: 1,
        status: 'private',
        triggerType: original.triggerType,
        triggerConfig: original.triggerConfig,
        envVars: original.envVars,
        variables: original.variables,
        popularity: 0,
        updatedAt: new Date(),
      })
      .returning(),
    'duplicate-workflow-template'
  )

  if (result.isErr()) {
    return result
  }

  return ok(result.value[0] as WorkflowTemplateDetail)
}
