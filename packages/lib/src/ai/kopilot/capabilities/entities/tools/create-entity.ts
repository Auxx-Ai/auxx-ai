// packages/lib/src/ai/kopilot/capabilities/entities/tools/create-entity.ts

import { findCachedResource, getCachedResources } from '../../../../../cache/org-cache-helpers'
import { UnprocessableEntityError } from '../../../../../errors'
import { UnifiedCrudHandler } from '../../../../../resources/crud'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { CreateEntityDigest } from '../../../digests'
import type { GetToolDeps } from '../../types'
import { formatUnknownFieldsError, validateFieldKeys } from './field-label-helpers'
import { formatActorResolutionError, resolveActorValues } from './resolve-actor-values'

export function createCreateEntityTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'create_entity',
    outputBlock: 'entity-card',
    outputDigestSchema: CreateEntityDigest,
    buildDigest: (output) => {
      const out = (output ?? {}) as { recordId?: string }
      const recordId = String(out.recordId ?? '')
      return {
        recordId,
        displayName: recordId,
        entityDefinitionId: recordId.split(':')[0] || undefined,
      }
    },
    description: `Create a new entity instance.

REQUIRED BEFORE CALLING: Call \`search_entities\` with the proposed values (name,
email, SKU, etc.) scoped to this \`entityDefinitionId\` to check for duplicates.

A search result is a duplicate only if it probably represents the SAME entity:
same full name, same email, or same phone (for people/companies); same SKU or
identifier (for things). Partial overlap is NOT a duplicate — searching
"Cornelia Klooth" and getting back "Lutz Klooth" or "Carolin Klooth" is just a
last-name match; proceed with creation.

Only stop and ask the user if at least one search result has the same full name
OR the same email/phone/identifier as the entity you're creating. Otherwise
proceed straight to \`list_entity_fields\` → \`create_entity\`. Skip the dedupe
prompt entirely if the user explicitly said "create a new one even if it
exists" or similar.

REQUIRED BEFORE CALLING: If you have NOT already called \`list_entity_fields\` for this
entityDefinitionId in the current turn, call it first. Do NOT guess field ids from prior
turns, system prompt, or intuition — always use the exact \`id\` returned by the most
recent list_entity_fields call.

Each key in \`values\` must be an id from list_entity_fields. Unknown keys are rejected.

Every id in the \`requiredOnCreate\` summary from list_entity_fields MUST appear in \`values\`.
If the user hasn't provided one of them, ask before calling.
Do NOT include ids listed in \`autoFilled\` or fields flagged \`readOnly: true\` — those are
populated by the system. Fields flagged \`createOnly: true\` can be set here but not changed later.

Example (ids match list_entity_fields output):
  entityDefinitionId: "abc123"
  values: { "company_name": "Acme", "company_website": "https://acme.com" }`,
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        entityDefinitionId: {
          type: 'string',
          description:
            'Entity type — pass the apiSlug from the entity catalog (e.g. "contact", "company").',
        },
        values: {
          type: 'object',
          description:
            'Object mapping field IDs to their values. Keys MUST be exact ids from the most recent list_entity_fields call (usually systemAttribute, e.g. company_website, ticket_status). Only include fields you want to set.',
          additionalProperties: true,
        },
      },
      required: ['entityDefinitionId', 'values'],
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const { db } = getDeps()
      const key = args.entityDefinitionId as string

      // The LLM may nest field values under `values` or flatten them at the top level.
      const values =
        (args.values as Record<string, unknown>) ??
        Object.fromEntries(
          Object.entries(args).filter(([k]) => k !== 'entityDefinitionId' && k !== 'values')
        )

      if (!values || Object.keys(values).length === 0) {
        return {
          success: false,
          output: null,
          error:
            'No field values provided. Call list_entity_fields first to discover fields, then pass them in the "values" object.',
        }
      }

      const resource = await findCachedResource(agentDeps.organizationId, key)
      if (!resource) {
        const allResources = await getCachedResources(agentDeps.organizationId)
        const validSlugs = allResources.map((r) => r.apiSlug).join(', ')
        return {
          success: false,
          output: null,
          error: `Entity type "${key}" not found. Use one of these apiSlugs: ${validSlugs}.`,
        }
      }

      const entityDefId = resource.entityDefinitionId ?? resource.id

      // Reject unknown field keys before calling the handler — the backend's key
      // resolution is strict and silently drops unrecognised ids.
      const { unknownKeys, validIds } = validateFieldKeys(Object.keys(values), resource)
      if (unknownKeys.length > 0) {
        return {
          success: false,
          output: null,
          error: formatUnknownFieldsError(unknownKeys, validIds, resource.label),
        }
      }

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

      const handler = new UnifiedCrudHandler(agentDeps.organizationId, agentDeps.userId, db)

      try {
        const result = await handler.create(entityDefId, actorResolution.values)
        // Return only the recordId. The frontend hydrates displayName via
        // useRecord → record.getByIds, which reads the denormalized column
        // already populated by setFieldValues inside handler.create.
        return {
          success: true,
          output: { recordId: result.recordId },
        }
      } catch (err) {
        if (err instanceof UnprocessableEntityError && 'missingFields' in err.details) {
          return {
            success: false,
            output: {
              missingFields: err.details.missingFields,
              missingFieldLabels: err.details.missingFieldLabels,
            },
            error: `${err.message}. Ask the user for the missing fields, or call list_entity_fields to inspect them.`,
          }
        }
        return {
          success: false,
          output: null,
          error: err instanceof Error ? err.message : 'Failed to create entity',
        }
      }
    },
  }
}
