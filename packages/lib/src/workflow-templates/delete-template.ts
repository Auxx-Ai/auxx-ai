// packages/lib/src/workflow-templates/delete-template.ts

import { database, schema } from '@auxx/database'
import { fromDatabase } from '@auxx/services/shared/utils'
import { eq } from 'drizzle-orm'
import { ok } from 'neverthrow'

/**
 * Delete a workflow template
 *
 * @param id - Template ID to delete
 * @returns Result indicating success or error
 */
export async function deleteTemplate(id: string) {
  const result = await fromDatabase(
    database.delete(schema.WorkflowTemplate).where(eq(schema.WorkflowTemplate.id, id)),
    'delete-workflow-template'
  )

  if (result.isErr()) {
    return result
  }

  return ok(undefined)
}
