// packages/lib/src/ai/kopilot/capabilities/entities/tools/list-entity-fields.ts

import { findCachedResource, getCachedResources } from '../../../../../cache/org-cache-helpers'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { ListEntityFieldsDigest } from '../../../digests'
import type { GetToolDeps } from '../../types'
import { buildListEntityFieldsOutput } from './list-entity-fields-output'

export function createListEntityFieldsTool(_getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'list_entity_fields',
    idempotent: true,
    outputDigestSchema: ListEntityFieldsDigest,
    buildDigest: (output) => {
      const out = (output ?? {}) as { entityDefinitionId?: string; fields?: unknown[] }
      return {
        entityType: typeof out.entityDefinitionId === 'string' ? out.entityDefinitionId : '',
        fieldCount: Array.isArray(out.fields) ? out.fields.length : 0,
      }
    },
    description: `List fields/attributes for an entity type. Use to discover field ids before searching, filtering, sorting, or mutating.

Response shape:
- requiredOnCreate: string[] — ids that MUST appear in \`values\` when calling create_entity
- autoFilled: string[] — ids the system populates automatically (don't pass these)
- fields[]: each entry has \`id\`, \`label\`, \`fieldType\`, plus optional flags:
    required: true       — must be set on create
    unique: true         — duplicates will be rejected
    readOnly: true       — can't be set on create or update
    createOnly: true     — set at create, never updated after
    options              — valid values for select / multi-select / status
    relationship         — target entity for RELATIONSHIP fields
  Computed fields are omitted — the LLM can't set them.`,
    parameters: {
      type: 'object',
      properties: {
        entityDefinitionId: {
          type: 'string',
          description:
            'Entity type — pass the apiSlug from the entity catalog (e.g. "contact", "company").',
        },
        query: {
          type: 'string',
          description: 'Optional filter by field name (case-insensitive)',
        },
      },
      required: ['entityDefinitionId'],
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const key = args.entityDefinitionId as string
      const query = (args.query as string | undefined)?.toLowerCase()

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

      let fields = resource.fields
      if (query) {
        fields = fields.filter(
          (f) =>
            f.label.toLowerCase().includes(query) ||
            (f.systemAttribute?.toLowerCase().includes(query) ?? false) ||
            f.key.toLowerCase().includes(query)
        )
      }

      const entityDefinitionId = resource.entityDefinitionId ?? resource.id
      const output = buildListEntityFieldsOutput(entityDefinitionId, fields)

      return {
        success: true,
        output,
      }
    },
  }
}
