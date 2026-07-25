// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/procedure-create.ts

import { compileProcedure } from '../../../../../agents/procedures'
import {
  buildProcedureDoc,
  createAttachedProcedureDraft,
  emptyDoc,
  PROCEDURE_DSL_SCHEMA,
  ProcedureBuildError,
  type ProcedureDsl,
  validateProcedureDsl,
} from '../../../../../agents/procedures/authoring'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { resolveProcedureAuthoring } from './procedure-authoring-guard'
import { validateSchemaReferences } from './schema-references'
import { validateTriggerExamples } from './trigger-examples'

const triggerExampleSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'behavior'],
  properties: {
    text: { type: 'string', minLength: 1 },
    behavior: { enum: ['use', 'avoid'] },
  },
}

/**
 * Create a new procedure as a compile-clean DRAFT, attached to the session agent.
 * Draft-only: an attached-but-unpublished procedure has no `activeVersionId`, so
 * the org-cache `agents` projection (inner-join on active version) correctly
 * excludes it from the runtime until the user publishes in the editor. Never fires
 * the runtime cache event. See Phase 7 §4.1.
 */
export function createCreateProcedureTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'create_procedure',
    permission: {
      target: 'area',
      area: 'agents',
      level: 'full',
      enforcement: 'enforced',
      note: 'resolveAgentAuthoring — PermissionKey.agentsManage (the agents area’s only rung) on the caller’s own CapabilitySet, plus an org-scope check on the session agent ref. Enforcement is proven behaviourally by agents-builder/tools/__tests__/agent-authoring-guard.test.ts.',
    },
    displayName: 'Create procedure',
    surfaces: ['builder'],
    description: `Create a new branching procedure (a deterministic, multi-step playbook for one situation) and attach it to this agent as a DRAFT.

Optionally pass \`body\` (the step DSL) to seed the procedure now, or omit it and fill it in later with \`set_procedure_body\`. You write a draft — tell the user to review it in the procedure editor and hit Publish; you do not publish. Do NOT include \`opaque\` steps (there is no prior draft to carry through).`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        name: {
          type: 'string',
          minLength: 1,
          maxLength: 200,
          description: 'Short name for the procedure.',
        },
        whenToUse: {
          type: 'string',
          description:
            'One or two sentences describing the situation this procedure handles (drives selection).',
        },
        triggerExamples: {
          type: 'array',
          description:
            'Example phrases the procedure should be used for (`use`) or avoided for (`avoid`).',
          items: triggerExampleSchema,
        },
        body: { ...PROCEDURE_DSL_SCHEMA, description: 'Optional initial step DSL.' },
      },
    },
    execute: async (args, agentDeps) => {
      const ctx = await resolveProcedureAuthoring(getDeps, agentDeps)
      if (!ctx.ok) return { success: false, output: null, error: ctx.error }

      const name = typeof args.name === 'string' ? args.name.trim() : ''
      if (!name) return { success: false, output: null, error: 'name must be a non-empty string.' }

      const whenToUse = typeof args.whenToUse === 'string' ? args.whenToUse : undefined
      if (args.triggerExamples !== undefined) {
        const teError = validateTriggerExamples(args.triggerExamples)
        if (teError) return { success: false, output: null, error: teError }
      }
      const triggerExamples = Array.isArray(args.triggerExamples)
        ? (args.triggerExamples as unknown[])
        : undefined
      const defaults = { whenToUse, triggerExamples }

      const hasBody = args.body !== undefined && args.body !== null
      if (!hasBody) {
        const created = await createAttachedProcedureDraft({
          organizationId: agentDeps.organizationId,
          agentId: ctx.agentId,
          name,
          defaults,
        })
        if (created.isErr()) {
          return {
            success: false,
            output: null,
            error: `Failed to create procedure: ${errMsg(created.error)}`,
          }
        }
        return {
          success: true,
          output: {
            procedureId: created.value.procedureId,
            attached: true,
            draftContentHash: created.value.draftContentHash,
            stepCount: 0,
          },
        }
      }

      // Validate DSL shape, then lower → schema-chip check → compile, all BEFORE any DB write.
      const dslErrors = validateProcedureDsl(args.body)
      if (dslErrors.length > 0) {
        return {
          success: false,
          output: { errors: dslErrors },
          error: `Invalid procedure body: ${dslErrors[0]}`,
        }
      }
      const body = args.body as ProcedureDsl

      let doc: ReturnType<typeof buildProcedureDoc>
      try {
        doc = buildProcedureDoc(body, emptyDoc())
      } catch (e) {
        if (e instanceof ProcedureBuildError) {
          return {
            success: false,
            output: null,
            error: `Can't create with opaque/read-only steps — there's no prior draft to carry through. ${e.message}`,
          }
        }
        throw e
      }

      const schema = await validateSchemaReferences(doc, agentDeps.organizationId)
      if (schema.unresolvedReferences.length > 0) {
        return {
          success: false,
          output: { unresolvedReferences: schema.unresolvedReferences, warnings: schema.warnings },
          error: schema.errorMessage,
        }
      }

      const { compiled, errors, warnings } = compileProcedure(doc)
      if (errors && errors.length > 0) {
        return {
          success: false,
          output: { errors },
          error: `Procedure has errors: ${errors[0]!.message}`,
        }
      }

      const created = await createAttachedProcedureDraft({
        organizationId: agentDeps.organizationId,
        agentId: ctx.agentId,
        name,
        defaults,
        doc,
      })
      if (created.isErr()) {
        return {
          success: false,
          output: null,
          error: `Failed to create procedure: ${errMsg(created.error)}`,
        }
      }

      return {
        success: true,
        output: {
          procedureId: created.value.procedureId,
          attached: true,
          draftContentHash: created.value.draftContentHash,
          stepCount: Object.keys(compiled.steps).length,
          compileWarnings: warnings ?? [],
        },
      }
    },
  }
}

function errMsg(error: unknown): string {
  return (error as { message?: string } | undefined)?.message ?? String(error)
}
