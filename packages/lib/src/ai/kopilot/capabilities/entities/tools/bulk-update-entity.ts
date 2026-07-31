// packages/lib/src/ai/kopilot/capabilities/entities/tools/bulk-update-entity.ts

import { z } from 'zod'
import { findCachedResource } from '../../../../../cache/org-cache-helpers'
import { FieldValueService } from '../../../../../field-values/field-value-service'
// Deep subpath, NOT the `resources` barrel — the barrel reaches the picker →
// the files service → `@auxx/database`'s `database` export. This module imports
// only `errors`, the RecordId parser and types; the picker sits behind a lazy
// `import()` inside it and is only paid for on the def-denied path.
import { assertRecordRowsEditableWithDb } from '../../../../../resources/crud/record-row-access'
import { getDefinitionId, isRecordId } from '../../../../../resources/resource-id'
import { getKnownDefIds, normalizeRecordIdArrayArg } from '../../../../agent-framework/tool-inputs'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

/** Full success output of `bulk_update_entity` — record counts and updated field labels. */
const BulkUpdateEntityOutput = z.object({
  total: z.number(),
  approved: z.number(),
  updated: z.number(),
  updatedFields: z.array(z.string()),
})

import {
  formatUnknownFieldsError,
  resolveFieldLabels,
  validateFieldKeys,
} from './field-label-helpers'
import { formatActorResolutionError, resolveActorValuesFlat } from './resolve-actor-values'

export function createBulkUpdateEntityTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'bulk_update_entity',
    permission: {
      target: 'definition',
      level: 'edit',
      enforcement: 'enforced',
      note: 'Own copy of the per-row edit gate — canEditEntity fast path, then an `_access` stamp read of the def-denied remainder (bypasses UnifiedCrudHandler by design).',
    },
    displayName: 'Bulk update records',
    toolsetSlug: 'auxx:entities:write',
    outputSchema: BulkUpdateEntityOutput,
    exampleOutput: {
      total: 3,
      approved: 3,
      updated: 3,
      updatedFields: ['Status'],
    } satisfies z.output<typeof BulkUpdateEntityOutput>,
    buildDigest: (output) => {
      const out = (output ?? {}) as { updated?: number; updatedFields?: string[] }
      return {
        recordCount: typeof out.updated === 'number' ? out.updated : 0,
        updatedFields: Array.isArray(out.updatedFields) ? out.updatedFields : [],
        sample: [],
      }
    },
    description: `Update the same field values on multiple entity instances at once. All records must be the same entity type.

REQUIRED BEFORE CALLING: If you have NOT already called \`list_entity_fields\` for this
entity's type in the current turn, call it first. Do NOT guess field ids from prior
turns, system prompt, or intuition — always use the exact \`id\` returned by the most
recent list_entity_fields call.

Each \`fieldId\` must be an id from list_entity_fields. Unknown ids are rejected.
Do NOT include ids flagged \`readOnly: true\` or \`createOnly: true\` — the backend ignores
them on update. Ids listed in \`autoFilled\` are also system-managed; don't pass them.

Use this tool instead of update_entity when updating 2+ records with the same field values.

Example (ids match list_entity_fields output):
  recordIds: ["abc123:def456", "abc123:ghi789"]
  values: [{ "fieldId": "ticket_status", "value": "COMPLETED" }]`,
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        recordIds: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Array of record IDs to update (format: entityDefinitionId:entityInstanceId)',
        },
        values: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              fieldId: {
                type: 'string',
                description:
                  'Exact `id` from the most recent list_entity_fields call (usually systemAttribute, e.g. ticket_status, company_website). Unknown ids are rejected.',
              },
              value: {
                description: 'The new value for the field (null to clear)',
              },
            },
            required: ['fieldId', 'value'],
          },
          description: 'Array of field values to set on all records.',
        },
      },
      required: ['recordIds', 'values'],
      additionalProperties: false,
    },
    validateInputs: async (args, ctx) => {
      const known = await getKnownDefIds(ctx.organizationId)
      const recordIds = normalizeRecordIdArrayArg(args.recordIds, {
        knownDefIds: known,
        argName: 'recordIds',
      })
      if (!recordIds.ok) return { ok: false, error: recordIds.error }
      if (recordIds.value.length === 0) {
        return { ok: false, error: 'recordIds must contain at least one record id.' }
      }
      return {
        ok: true,
        args: { ...args, recordIds: recordIds.value },
        warnings: recordIds.warnings,
      }
    },
    execute: async (args, agentDeps) => {
      const { db, capabilities } = getDeps()
      const rawRecordIds: unknown[] = Array.isArray(args.recordIds) ? args.recordIds : []
      const allRecordIds = rawRecordIds.filter(isRecordId)
      if (allRecordIds.length !== rawRecordIds.length) {
        return {
          success: false,
          output: null,
          error:
            "Every recordIds entry must have the form '<entityDefinitionId>:<entityInstanceId>'.",
        }
      }
      const values = args.values as Array<{ fieldId: string; value: unknown }>

      // inputAmendment._approvedRecordIds filters which records to actually update
      const approvedIds = args._approvedRecordIds as string[] | undefined
      const recordIds = approvedIds
        ? allRecordIds.filter((id) => approvedIds.includes(id))
        : allRecordIds

      const firstRecordId = recordIds[0]
      if (!firstRecordId) {
        return {
          success: false,
          output: null,
          error: 'No record IDs provided or none were approved.',
        }
      }

      if (!values || values.length === 0) {
        return {
          success: false,
          output: null,
          error:
            'No field values provided. Call list_entity_fields first to discover fields, then pass them in the "values" array.',
        }
      }

      // Write enforcement (plan v3/03 §5.3). This tool bypasses
      // `UnifiedCrudHandler` and writes straight through `FieldValueService`, so
      // it carries its own copy of the handler's write gate — and that copy is
      // now the SAME per-ROW gate the handler calls, not the def-only loop it
      // used to be (P5 skipped this one site; this is the catch-up).
      //
      // The shape is inherited wholesale, so it costs nothing on the ordinary
      // path: the def gate runs FIRST and short-circuits, memoized per
      // definition, so a 50-row single-def batch asks `canEditEntity` once and
      // never reads a row. Only def-DENIED ids are read back with their
      // `_access` stamp and re-judged against the row-effective `edit` floor. A
      // missing row or a missing stamp DENIES, and the batch fails WHOLE — a
      // partial bulk write is not something a user can reason about.
      //
      // Absent capabilities ⇒ unrestricted, as before (the gate returns early).
      //
      // For a pure AGENT principal this is outcome-identical to the old def
      // loop, and the reason is `AgentPolicyCapabilities.recordAccessAt`, which
      // DISCARDS `grantRank` (see its `_grantRank` parameter): an agent's stamp
      // is always its own published def rung, so a `ResourceAccess` row sitting
      // on the agent's synthetic user cannot lift it. Note the gate judges via
      // `canEditRecordAt` and never consults `hasRecordGrantsOn` — that flag
      // being `false` for agents is true but NOT what closes this hole.
      //
      // What changes is the case the old loop got wrong: a run clamped against
      // a HUMAN capability set may now write a row that member holds an `edit`
      // share on.
      await assertRecordRowsEditableWithDb({
        db,
        organizationId: agentDeps.organizationId,
        userId: agentDeps.userId,
        capabilities,
        recordIds,
      })

      const resource = await findCachedResource(
        agentDeps.organizationId,
        getDefinitionId(firstRecordId)
      )

      if (resource) {
        const { unknownKeys, validIds } = validateFieldKeys(
          values.map((v) => v.fieldId),
          resource
        )
        if (unknownKeys.length > 0) {
          return {
            success: false,
            output: null,
            error: formatUnknownFieldsError(unknownKeys, validIds, resource.label),
          }
        }
      }

      let resolvedPairs = values.map((v) => ({ fieldId: v.fieldId, value: v.value ?? null }))
      if (resource) {
        const actorResolution = await resolveActorValuesFlat(resolvedPairs, resource, {
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
        resolvedPairs = actorResolution.pairs.map((p) => ({
          fieldId: p.fieldId,
          value: p.value ?? null,
        }))
      }

      const service = new FieldValueService(agentDeps.organizationId, agentDeps.userId, db)

      try {
        const result = await service.setBulkValues({
          recordIds,
          values: resolvedPairs,
        })

        const fieldIds = resolvedPairs.map((v) => v.fieldId)
        const fieldLabels = resolveFieldLabels(resource, fieldIds)
        return {
          success: true,
          output: {
            total: allRecordIds.length,
            approved: recordIds.length,
            updated: result.count,
            updatedFields: fieldLabels,
          },
        }
      } catch (err) {
        return {
          success: false,
          output: null,
          error: err instanceof Error ? err.message : 'Failed to bulk update entities',
        }
      }
    },
  }
}
