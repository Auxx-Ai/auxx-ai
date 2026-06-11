// packages/lib/src/workflow-engine/credentials/is-credential-in-use.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'

const logger = createScopedLogger('workflow-credential-usage')

/**
 * Check whether a credential is referenced by any workflow graph in the org.
 * Fail-closed: if the scan errors, the credential is treated as in use so a
 * delete never severs a live workflow reference.
 */
export async function isCredentialInUse(
  credentialId: string,
  organizationId: string
): Promise<boolean> {
  try {
    const workflows = await db
      .select({
        id: schema.Workflow.id,
        graph: schema.Workflow.graph,
      })
      .from(schema.Workflow)
      .leftJoin(schema.WorkflowApp, eq(schema.Workflow.workflowAppId, schema.WorkflowApp.id))
      .where(eq(schema.WorkflowApp.organizationId, organizationId))

    for (const workflow of workflows) {
      if (workflow.graph && JSON.stringify(workflow.graph).includes(credentialId)) {
        logger.debug('Found credential in use', { credentialId, workflowId: workflow.id })
        return true
      }
    }

    return false
  } catch (error) {
    logger.error('Failed to check credential usage', {
      credentialId,
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
    return true
  }
}
