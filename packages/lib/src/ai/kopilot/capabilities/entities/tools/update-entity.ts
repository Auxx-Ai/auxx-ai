// packages/lib/src/ai/kopilot/capabilities/entities/tools/update-entity.ts

import { z } from 'zod'
import { findCachedResource } from '../../../../../cache/org-cache-helpers'
import { UnifiedCrudHandler } from '../../../../../resources/crud'
import { getDefinitionId, isRecordId } from '../../../../../resources/resource-id'
import { getKnownDefIds, normalizeRecordIdArg } from '../../../../agent-framework/tool-inputs'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { blockedEntityError, isAiBlockedDefKey } from '../shared/ai-entity-visibility'

/** Full success output of `update_entity` — the updated record and human-readable field labels. */
const UpdateEntityOutput = z.object({
  recordId: z.string(),
  updatedFields: z.array(z.string()),
})

import {
  formatUnknownFieldsError,
  isMultiValueField,
  resolveFieldLabels,
  validateFieldKeys,
} from './field-label-helpers'
import { formatActorResolutionError, resolveActorValues } from './resolve-actor-values'

export function createUpdateEntityTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'update_entity',
    permission: {
      target: 'definition',
      level: 'edit',
      enforcement: 'enforced',
      note: 'UnifiedCrudHandler → assertEditEntity.',
    },
    displayName: 'Update record',
    toolsetSlug: 'auxx:entities:write',
    outputSchema: UpdateEntityOutput,
    exampleOutput: {
      recordId: 'contact:9aB3xY',
      updatedFields: ['Status', 'Website'],
    } satisfies z.output<typeof UpdateEntityOutput>,
    buildDigest: (output) => {
      const out = (output ?? {}) as { recordId?: string; updatedFields?: string[] }
      return {
        recordId: String(out.recordId ?? ''),
        updatedFields: Array.isArray(out.updatedFields) ? out.updatedFields : [],
      }
    },
    description: `Update field values on an entity instance.
Email threads and messages are NOT record types here — this tool rejects them. Use update_thread instead.

REQUIRED BEFORE CALLING: If you have NOT already called \`list_entity_fields\` for this
entity's type in the current turn, call it first. Do NOT guess field ids from prior
turns, system prompt, or intuition — always use the exact \`id\` returned by the most
recent list_entity_fields call.

Each key in \`values\` must be an id from list_entity_fields. Unknown keys are rejected.
Do NOT include ids flagged \`readOnly: true\` or \`createOnly: true\` — the backend ignores
them on update. Ids listed in \`autoFilled\` are also system-managed; don't pass them.

Multi-value fields (list_entity_fields flags them): writing a value REPLACES the whole
stored list. To append without touching existing values, pass \`modes\` with \`"add"\` for
that field, e.g. modes: { "primary_email": "add" }.

Example (ids match list_entity_fields output):
  recordId: "abc123:def456"
  values: { "company_website": "https://new-site.com" }`,
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        recordId: {
          type: 'string',
          description: 'Record ID (format: entityDefinitionId:entityInstanceId)',
        },
        values: {
          type: 'object',
          description:
            'Object mapping field IDs to their new values. Keys MUST be exact ids from the most recent list_entity_fields call (usually systemAttribute, e.g. company_website, ticket_status). Only include fields you want to update.',
          additionalProperties: true,
        },
        modes: {
          type: 'object',
          description:
            "Optional per-field write mode, keyed like `values`. Only 'add' is meaningful: on a multi-value field (list_entity_fields flags `multi: true`) it APPENDS the given value(s) instead of replacing the stored list. Omitted fields default to replace. Ignored for single-value fields.",
          additionalProperties: { type: 'string', enum: ['replace', 'add'] },
        },
      },
      required: ['recordId', 'values'],
      additionalProperties: false,
    },
    validateInputs: async (args, ctx) => {
      const known = await getKnownDefIds(ctx.organizationId)
      const recordId = normalizeRecordIdArg(args.recordId, {
        knownDefIds: known,
        argName: 'recordId',
      })
      if (!recordId.ok) return { ok: false, error: recordId.error }
      return {
        ok: true,
        args: { ...args, recordId: recordId.value },
        warnings: recordId.warnings,
      }
    },
    execute: async (args, agentDeps) => {
      const { db, capabilities } = getDeps()
      const recordId = args.recordId
      if (!isRecordId(recordId)) {
        return {
          success: false,
          output: null,
          error: "recordId must have the form '<entityDefinitionId>:<entityInstanceId>'.",
        }
      }

      // Mail-lens block (step 0.1, write half): `thread:<id>` / `message:<id>`
      // would write through `UnifiedCrudHandler`, whose `canEditEntity('thread')`
      // is the same unconditional pass-through the read path had to route around.
      // Keyed on the parsed def id, so every spelling the model might use is one
      // test — `validateInputs` has already folded `threads:<id>` / `Thread:<id>`
      // onto the def id, and this runs before any resource read or write.
      const definitionId = getDefinitionId(recordId)
      if (isAiBlockedDefKey(definitionId)) {
        return { success: false, output: null, error: blockedEntityError(definitionId, 'write') }
      }

      // The LLM may nest field values under `values` or flatten them at the top level.
      const values =
        (args.values as Record<string, unknown>) ??
        Object.fromEntries(
          Object.entries(args).filter(([k]) => k !== 'recordId' && k !== 'values' && k !== 'modes')
        )

      if (!values || Object.keys(values).length === 0) {
        return {
          success: false,
          output: null,
          error:
            'No field values provided. Call list_entity_fields first to discover fields, then pass them in the "values" object.',
        }
      }

      const resource = await findCachedResource(agentDeps.organizationId, definitionId)

      if (resource) {
        const { unknownKeys, validIds } = validateFieldKeys(Object.keys(values), resource)
        if (unknownKeys.length > 0) {
          return {
            success: false,
            output: null,
            error: formatUnknownFieldsError(unknownKeys, validIds, resource.label),
          }
        }
      }

      let resolvedValues = values
      if (resource) {
        const actorResolution = await resolveActorValues(values, resource, {
          organizationId: agentDeps.organizationId,
          userId: agentDeps.userId,
        })
        if (actorResolution.errors.length > 0) {
          return {
            success: false,
            output: null,
            error: formatActorResolutionError(actorResolution.errors, agentDeps.userId),
          }
        }
        resolvedValues = actorResolution.values
      }

      // Write enforcement (permissions v2 §3.3): the handler asserts
      // `canEditEntity` on `update`. Absent capabilities (workflow AI node) ⇒
      // unrestricted, exactly as before.
      const handler = new UnifiedCrudHandler(
        agentDeps.organizationId,
        agentDeps.userId,
        db,
        undefined,
        { capabilities }
      )

      // Per-field write modes: `'add'` appends on multi-value fields instead of
      // replacing the stored list (default replace). Guarded on the field
      // actually being multi — the append primitive throws on single-value
      // fields, and a model-guessed 'add' on a scalar should just replace.
      const rawModes = (args.modes ?? {}) as Record<string, unknown>
      let modes: Record<string, 'set' | 'add' | 'remove'> | undefined
      for (const [key, mode] of Object.entries(rawModes)) {
        if (mode !== 'add' || !(key in resolvedValues)) continue
        if (resource && !isMultiValueField(resource, key)) continue
        modes = { ...modes, [key]: 'add' }
      }

      try {
        await handler.update(recordId, resolvedValues, modes)
        const fieldIds = Object.keys(resolvedValues)
        const labels = resolveFieldLabels(resource, fieldIds)
        return {
          success: true,
          output: { recordId, updatedFields: labels },
        }
      } catch (err) {
        return {
          success: false,
          output: null,
          error: err instanceof Error ? err.message : 'Failed to update entity',
        }
      }
    },
  }
}
