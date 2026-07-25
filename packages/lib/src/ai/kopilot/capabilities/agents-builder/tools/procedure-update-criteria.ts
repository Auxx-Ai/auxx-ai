// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/procedure-update-criteria.ts

import {
  getAttachedProcedureDraft,
  updateAttachedProcedureCriteria,
} from '../../../../../agents/procedures/authoring'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { resolveProcedureAuthoring } from './procedure-authoring-guard'
import { validateTriggerExamples } from './trigger-examples'

/**
 * Update a procedure's name / selection criteria (`whenToUse` / `triggerExamples`).
 * Draft-only: criteria are versioned and only go live on publish, so this never
 * fires the runtime cache event — but the write emits the `procedure:updated`
 * UI-refresh event so an open editor/rail refreshes. `ruleset` (the deterministic
 * pre-filter) stays editor-only in v1. See Phase 7 §4.4.
 */
export function createUpdateProcedureCriteriaTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'update_procedure_criteria',
    permission: {
      target: 'area',
      area: 'agents',
      level: 'full',
      enforcement: 'enforced',
      note: 'resolveAgentAuthoring — PermissionKey.agentsManage (the agents area’s only rung) on the caller’s own CapabilitySet, plus an org-scope check on the session agent ref. Enforcement is proven behaviourally by agents-builder/tools/__tests__/agent-authoring-guard.test.ts.',
    },
    displayName: 'Update procedure criteria',
    surfaces: ['builder'],
    description: `Update a procedure's name and/or selection criteria (\`whenToUse\`, \`triggerExamples\`). These drive when the procedure is selected at runtime and go live when the user publishes. To change the step flow, use \`set_procedure_body\` instead.`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['procedureId'],
      properties: {
        procedureId: { type: 'string', minLength: 1 },
        name: { type: 'string', minLength: 1, maxLength: 200 },
        whenToUse: { type: 'string' },
        triggerExamples: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['text', 'behavior'],
            properties: {
              text: { type: 'string', minLength: 1 },
              behavior: { enum: ['use', 'avoid'] },
            },
          },
        },
      },
    },
    execute: async (args, agentDeps) => {
      const ctx = await resolveProcedureAuthoring(getDeps, agentDeps)
      if (!ctx.ok) return { success: false, output: null, error: ctx.error }

      const procedureId = typeof args.procedureId === 'string' ? args.procedureId : ''
      if (!procedureId) return { success: false, output: null, error: 'procedureId is required.' }

      const name = typeof args.name === 'string' ? args.name : undefined
      const whenToUse = typeof args.whenToUse === 'string' ? args.whenToUse : undefined
      if (args.triggerExamples !== undefined) {
        const teError = validateTriggerExamples(args.triggerExamples)
        if (teError) return { success: false, output: null, error: teError }
      }
      const triggerExamples = Array.isArray(args.triggerExamples)
        ? (args.triggerExamples as unknown[])
        : undefined
      if (name === undefined && whenToUse === undefined && triggerExamples === undefined) {
        return {
          success: false,
          output: null,
          error: 'Provide at least one of name, whenToUse, or triggerExamples.',
        }
      }

      // Authorize via the attachment invariant (rejects an unattached procedure id).
      const draft = await getAttachedProcedureDraft({
        organizationId: agentDeps.organizationId,
        agentId: ctx.agentId,
        procedureId,
      })
      if (draft.isErr()) {
        return {
          success: false,
          output: null,
          error: 'Procedure not found or not attached to this agent.',
        }
      }

      const updated = await updateAttachedProcedureCriteria({
        organizationId: agentDeps.organizationId,
        agentId: ctx.agentId,
        procedureId,
        patch: { name, whenToUse, triggerExamples },
      })
      if (updated.isErr()) {
        return {
          success: false,
          output: null,
          error: `Failed to update criteria: ${(updated.error as { message?: string }).message ?? String(updated.error)}`,
        }
      }

      return {
        success: true,
        output: {
          procedureId,
          name: updated.value.name,
          whenToUse: updated.value.whenToUse,
          hasUnpublishedChanges: updated.value.hasUnpublishedChanges,
        },
      }
    },
  }
}
