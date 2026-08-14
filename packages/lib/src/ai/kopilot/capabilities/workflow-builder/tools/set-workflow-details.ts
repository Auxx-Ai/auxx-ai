// packages/lib/src/ai/kopilot/capabilities/workflow-builder/tools/set-workflow-details.ts

import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { buildWorkflowEditDigest } from '../../../digests'
import type { GetToolDeps } from '../../types'
import { workflowToolPermission } from './graph-tool-helpers'
import { resolveWorkflowAdminWrite } from './write-tool-helpers'

/** Update the open workflow's user-facing name and description. */
export function createSetWorkflowDetailsTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'set_workflow_details',
    permission: workflowToolPermission('admin'),
    displayName: 'Set workflow details',
    surfaces: ['builder'],
    description:
      'Update the open workflow’s name and/or description. This is a workflow settings action and requires Full access. The change is included in the current Kopilot turn and is reverted if that turn fails.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'New workflow name. Must not be empty.' },
        description: {
          type: 'string',
          description: 'New workflow description. Pass an empty string to clear it.',
        },
      },
      additionalProperties: false,
    },
    summary: () => 'Update workflow details',
    buildDigest: (output) => buildWorkflowEditDigest('Updated workflow details', output),
    execute: async (args, agentDeps) => {
      const write = await resolveWorkflowAdminWrite(getDeps, agentDeps)
      if (!write.ok) return { success: false, output: null, error: write.error }

      const nameValue = typeof args.name === 'string' ? args.name : undefined
      const descriptionValue = typeof args.description === 'string' ? args.description : undefined
      if (nameValue === undefined && descriptionValue === undefined) {
        return { success: false, output: null, error: 'Provide a name and/or description.' }
      }
      const name = nameValue?.trim()
      if (nameValue !== undefined && !name) {
        return { success: false, output: null, error: 'name must not be empty.' }
      }

      const { db } = getDeps()
      // Capture the same pre-turn state as graph mutations before this settings
      // write, so a failed turn restores both graph and workflow metadata.
      const { loadDraftContext } = await import('../../../../../workflows/graph-edit/read')
      const loaded = await loadDraftContext(db, write.scope)
      if (loaded.isErr()) return { success: false, output: null, error: loaded.error.message }
      const draft = loaded.value

      const { captureWorkflowTurnSnapshot } = await import(
        '../../../../../workflows/graph-edit/turn-snapshot'
      )
      await captureWorkflowTurnSnapshot(write.scope.workflowAppId, write.scope.turnId!, {
        graph: draft.graph,
        triggerType: draft.triggerType,
        name: draft.appName,
        description: draft.appDescription,
      })

      try {
        const { WorkflowService } = await import('../../../../../workflows/workflow-service')
        const updated = await new WorkflowService(db).update(write.scope.organizationId, {
          id: write.scope.workflowAppId,
          ...(name !== undefined ? { name } : {}),
          ...(descriptionValue !== undefined ? { description: descriptionValue } : {}),
          preserveTurnSnapshot: true,
        })
        const { publishDraftUpdatedSignal } = await import(
          '../../../../../workflows/graph-edit/persist'
        )
        await publishDraftUpdatedSignal(write.scope.organizationId, {
          workflowAppId: write.scope.workflowAppId,
          reason: 'kopilot',
        })
        return {
          success: true,
          output: {
            applied: true,
            summary: 'Updated workflow details',
            name: updated?.name ?? name ?? draft.appName,
            description:
              updated?.description ??
              (descriptionValue !== undefined ? descriptionValue : draft.appDescription),
            issues: [],
          },
        }
      } catch (error) {
        return {
          success: false,
          output: null,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }
}
