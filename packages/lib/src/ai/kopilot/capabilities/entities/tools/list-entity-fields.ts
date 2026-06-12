// packages/lib/src/ai/kopilot/capabilities/entities/tools/list-entity-fields.ts

import { z } from 'zod'
import { findCachedResource, getCachedResources } from '../../../../../cache/org-cache-helpers'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { buildListEntityFieldsOutput } from './list-entity-fields-output'

/** Full success output of `list_entity_fields` — field definitions + create-time summaries. */
const ListEntityFieldsOutput = z.object({
  entityDefinitionId: z.string(),
  requiredOnCreate: z.array(z.string()),
  autoFilled: z.array(z.string()),
  fields: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      fieldType: z.string().optional(),
      required: z.literal(true).optional(),
      unique: z.literal(true).optional(),
      readOnly: z.literal(true).optional(),
      createOnly: z.literal(true).optional(),
      options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
      moreOptions: z.literal(true).optional(),
      totalOptions: z.number().optional(),
      relationship: z
        .object({
          targetEntityDefinitionId: z.string().nullable(),
          relationshipType: z.string(),
        })
        .optional(),
    })
  ),
})

export function createListEntityFieldsTool(_getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'list_entity_fields',
    displayName: 'List entity fields',
    toolsetSlug: 'auxx:entities:search',
    category: 'system',
    idempotent: true,
    // Schema only — field definitions, no record data — so safe for an external
    // caller. See plans/chat/v6/chat-tool-availability.md.
    externalSafe: true,
    outputSchema: ListEntityFieldsOutput,
    exampleOutput: {
      entityDefinitionId: 'contact',
      requiredOnCreate: ['contact_name'],
      autoFilled: ['created_by_id'],
      fields: [
        { id: 'contact_name', label: 'Name', fieldType: 'NAME', required: true },
        { id: 'contact_email', label: 'Email', fieldType: 'EMAIL', unique: true },
        {
          id: 'contact_status',
          label: 'Status',
          fieldType: 'SINGLE_SELECT',
          options: [
            { value: 'LEAD', label: 'Lead' },
            { value: 'ACTIVE', label: 'Active' },
            { value: 'CHURNED', label: 'Churned' },
          ],
        },
        {
          id: 'contact_company',
          label: 'Company',
          fieldType: 'RELATIONSHIP',
          relationship: { targetEntityDefinitionId: 'company', relationshipType: 'many-to-one' },
        },
      ],
    } satisfies z.output<typeof ListEntityFieldsOutput>,
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
