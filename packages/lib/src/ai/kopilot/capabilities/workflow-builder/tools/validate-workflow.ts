// packages/lib/src/ai/kopilot/capabilities/workflow-builder/tools/validate-workflow.ts

import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { workflowToolPermission } from './graph-tool-helpers'
import { resolveWorkflowAuthoring } from './workflow-authoring-guard'

/**
 * The publish gate without publishing: the three validation tiers plus the
 * REAL `validateDraftWorkflowForPublish` verdict. Publishing itself stays the
 * user's action — no publish tool exists.
 */
export function createValidateWorkflowTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'validate_workflow',
    permission: workflowToolPermission('view'),
    displayName: 'Validate workflow',
    toolsetSlug: 'workflow.builder',
    surfaces: ['builder'],
    idempotent: true,
    description:
      'Check whether the open workflow draft would pass the publish gate — without publishing (publishing stays the user’s action). Returns publishability, publish errors/warnings, and the structural/config/reference issues.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async (_args, agentDeps) => {
      const auth = await resolveWorkflowAuthoring(getDeps, agentDeps, 'view')
      if (!auth.ok) return { success: false, output: null, error: auth.error }

      const { db } = getDeps()
      // Lazy import — see get-workflow.ts.
      const { validateWorkflow } = await import('../../../../../workflows/graph-edit')
      const result = await validateWorkflow(db, {
        workflowAppId: auth.workflowAppId,
        organizationId: agentDeps.organizationId,
      })
      if (result.isErr()) {
        return { success: false, output: null, error: result.error.message }
      }
      const report = result.value
      return {
        success: true,
        output: {
          publishable: report.publishable,
          publishErrors: report.publishErrors,
          publishWarnings: report.publishWarnings,
          issues: report.issues,
        },
      }
    },
  }
}
