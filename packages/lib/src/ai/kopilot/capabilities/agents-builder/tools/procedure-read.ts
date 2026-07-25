// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/procedure-read.ts

import { docToDsl, getAttachedProcedureDraft } from '../../../../../agents/procedures/authoring'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { resolveProcedureAuthoring } from './procedure-authoring-guard'

/**
 * Read a procedure's current draft back as the model-facing DSL — the read path
 * for surgical edits. The response carries NO code source, output bindings, or
 * structured condition groups (those surface as read-only `opaque` steps). Pair
 * the returned `draftContentHash` with `set_procedure_body`. See Phase 7 §4.3.
 */
export function createReadProcedureTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'read_procedure',
    permission: {
      target: 'area',
      area: 'agents',
      level: 'full',
      enforcement: 'enforced',
      note: 'resolveAgentAuthoring — PermissionKey.agentsManage (the agents area’s only rung) on the caller’s own CapabilitySet, plus an org-scope check on the session agent ref. Enforcement is proven behaviourally by agents-builder/tools/__tests__/agent-authoring-guard.test.ts.',
    },
    displayName: 'Read procedure',
    surfaces: ['builder'],
    description: `Read a procedure attached to this agent back as the step DSL (with stable ids), so you can change only what the user asks and re-emit via \`set_procedure_body\` using the returned \`draftContentHash\`. Code blocks and rules-mode conditions appear as read-only \`opaque\` steps — keep them exactly.`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['procedureId'],
      properties: { procedureId: { type: 'string', minLength: 1 } },
    },
    execute: async (args, agentDeps) => {
      const ctx = await resolveProcedureAuthoring(getDeps, agentDeps)
      if (!ctx.ok) return { success: false, output: null, error: ctx.error }

      const procedureId = typeof args.procedureId === 'string' ? args.procedureId : ''
      if (!procedureId) return { success: false, output: null, error: 'procedureId is required.' }

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

      const body = docToDsl(draft.value.draftDoc)
      return {
        success: true,
        output: {
          procedureId: draft.value.procedureId,
          name: draft.value.name,
          whenToUse: draft.value.whenToUse,
          triggerExamples: draft.value.triggerExamples,
          hasUnpublishedChanges: draft.value.hasUnpublishedChanges,
          draftContentHash: draft.value.draftContentHash,
          body,
        },
      }
    },
  }
}
