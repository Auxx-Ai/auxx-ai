// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/procedure-set-body.ts

import { compileProcedure } from '../../../../../agents/procedures'
import {
  buildProcedureDoc,
  checkBodyPreservation,
  getAttachedProcedureDraft,
  PROCEDURE_DSL_SCHEMA,
  ProcedureBuildError,
  type ProcedureDsl,
  updateAttachedProcedureDraftIfHash,
  validateProcedureDsl,
} from '../../../../../agents/procedures/authoring'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { resolveProcedureAuthoring } from './procedure-authoring-guard'
import { validateSchemaReferences } from './schema-references'

const STALE_HINT =
  'The draft changed since you read it (an editor save or another edit landed). Call read_procedure again, reapply the user’s change to the new body, and retry.'

/**
 * Replace a procedure's whole DRAFT body with a re-emitted DSL. Surgical-edit
 * contract: read with `read_procedure`, change only what's asked (keep every
 * other step + its id, INCLUDING every `opaque` step verbatim), re-emit here with
 * the read's `draftContentHash` as `expectedDraftContentHash`. Carries code blocks
 * / rules conditions through losslessly and refuses to remove them. Writes a
 * draft; never publishes; never fires the runtime cache event. See Phase 7 §4.2.
 */
export function createSetProcedureBodyTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'set_procedure_body',
    displayName: 'Set procedure body',
    surfaces: ['builder'],
    description: `Replace a procedure's draft body with the full step DSL. To EDIT, call \`read_procedure\` first, change only the steps the user asked about (keep all others and their ids exactly — including every read-only \`opaque\` step), and re-emit the whole \`body\` with the returned \`draftContentHash\` as \`expectedDraftContentHash\`. If the tool reports a stale draft, read again and reapply. The compiler returns structured errors — fix and retry. You write a draft; the user publishes in the editor.`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['procedureId', 'expectedDraftContentHash', 'body'],
      properties: {
        procedureId: { type: 'string', minLength: 1 },
        expectedDraftContentHash: {
          type: 'string',
          minLength: 1,
          description:
            'The `draftContentHash` from your most recent `read_procedure` (or prior write) of this procedure.',
        },
        body: { ...PROCEDURE_DSL_SCHEMA, description: 'The full re-emitted step DSL.' },
      },
    },
    execute: async (args, agentDeps) => {
      const ctx = await resolveProcedureAuthoring(getDeps, agentDeps)
      if (!ctx.ok) return { success: false, output: null, error: ctx.error }

      const procedureId = typeof args.procedureId === 'string' ? args.procedureId : ''
      const expectedHash =
        typeof args.expectedDraftContentHash === 'string' ? args.expectedDraftContentHash : ''
      if (!procedureId || !expectedHash) {
        return {
          success: false,
          output: null,
          error: 'procedureId and expectedDraftContentHash are required.',
        }
      }

      const dslErrors = validateProcedureDsl(args.body)
      if (dslErrors.length > 0) {
        return {
          success: false,
          output: { errors: dslErrors },
          error: `Invalid procedure body: ${dslErrors[0]}`,
        }
      }
      const body = args.body as ProcedureDsl

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

      // Advisory stale check (the compare-and-set on write is authoritative).
      if (draft.value.draftContentHash !== expectedHash) {
        return { success: false, output: { stale: true }, error: STALE_HINT }
      }

      // Deletion guard: code blocks / rules conditions / existing sub-procedures
      // can't be removed via chat.
      const preserved = checkBodyPreservation(draft.value.draftDoc, body)
      if (!preserved.ok) {
        return { success: false, output: null, error: preserved.error }
      }

      let doc: ReturnType<typeof buildProcedureDoc>
      try {
        doc = buildProcedureDoc(body, draft.value.draftDoc)
      } catch (e) {
        if (e instanceof ProcedureBuildError)
          return { success: false, output: null, error: e.message }
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

      const written = await updateAttachedProcedureDraftIfHash({
        organizationId: agentDeps.organizationId,
        agentId: ctx.agentId,
        procedureId,
        expectedHash,
        doc,
      })
      if (written.isErr()) {
        if ((written.error as { code?: string }).code === 'STALE_DRAFT') {
          return { success: false, output: { stale: true }, error: STALE_HINT }
        }
        return {
          success: false,
          output: null,
          error: `Failed to save draft: ${errMsg(written.error)}`,
        }
      }

      const steps = Object.values(compiled.steps)
      return {
        success: true,
        output: {
          draftContentHash: written.value.draftContentHash,
          stepCount: steps.length,
          conditionCount: steps.filter((s) => s.kind === 'condition').length,
          subProcedureCount: Object.keys(compiled.subProcedures).length,
          warnings: warnings ?? [],
        },
      }
    },
  }
}

function errMsg(error: unknown): string {
  return (error as { message?: string } | undefined)?.message ?? String(error)
}
