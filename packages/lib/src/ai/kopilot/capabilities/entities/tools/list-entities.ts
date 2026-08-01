// packages/lib/src/ai/kopilot/capabilities/entities/tools/list-entities.ts

import { z } from 'zod'
import { getCachedResources } from '../../../../../cache/org-cache-helpers'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { isAiVisibleResource } from '../shared/ai-entity-visibility'

/** Full success output of `list_entities` — discovered entity TYPES (not records). */
const ListEntitiesOutput = z.object({
  entities: z.array(
    z.object({
      id: z.string(),
      apiSlug: z.string(),
      label: z.string(),
      plural: z.string(),
      entityType: z.string().nullable(),
      icon: z.string(),
      color: z.string(),
    })
  ),
  count: z.number(),
})

export function createListEntitiesTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'list_entities',
    permission: {
      target: 'definition',
      level: 'view',
      enforcement: 'enforced',
      note: 'Output filtered by canViewEntity — an unviewable def is absent from the catalog.',
    },
    displayName: 'List entity types',
    toolsetSlug: 'auxx:entities:search',
    category: 'system',
    idempotent: true,
    // Schema only — entity TYPES, no record data — so safe for an external
    // caller. See plans/chat/v6/chat-tool-availability.md.
    externalSafe: true,
    outputSchema: ListEntitiesOutput,
    exampleOutput: {
      entities: [
        {
          id: 'contact',
          apiSlug: 'contact',
          label: 'Contact',
          plural: 'Contacts',
          entityType: 'PERSON',
          icon: 'user',
          color: 'blue',
        },
        {
          id: 'company',
          apiSlug: 'company',
          label: 'Company',
          plural: 'Companies',
          entityType: 'COMPANY',
          icon: 'building',
          color: 'purple',
        },
        {
          id: 'ticket',
          apiSlug: 'ticket',
          label: 'Ticket',
          plural: 'Tickets',
          entityType: null,
          icon: 'ticket',
          color: 'orange',
        },
      ],
      count: 3,
    } satisfies z.output<typeof ListEntitiesOutput>,
    buildDigest: (output) => {
      const out = (output ?? {}) as { entities?: Array<{ apiSlug?: string; label?: string }> }
      return {
        entityTypes: Array.isArray(out.entities)
          ? out.entities.map((e) => e.label ?? e.apiSlug ?? '').filter(Boolean)
          : [],
      }
    },
    usageNotes:
      'Returns entity TYPES, not records. Use to discover what exists; then `query_records` or `search_entities` for actual records.',
    description:
      'Discover what entity TYPES exist in this workspace (e.g. Contact, Ticket, Company, custom entities). Returns type metadata, NOT individual records. Use search_entities to find specific records.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Optional filter by name (case-insensitive match on label, plural, or apiSlug)',
        },
      },
      additionalProperties: false,
    },
    execute: async (_args, agentDeps) => {
      const query = (_args.query as string | undefined)?.toLowerCase()
      const { capabilities } = getDeps()

      let resources = await getCachedResources(agentDeps.organizationId)

      // Two independent filters. `isAiVisibleResource` is the curated AI-visible
      // set — the Records-nav flag plus the infra defs the AI is allowed to know
      // about, minus the mail defs it must never reach this way. On top of that,
      // and separately, defs the member can't view (per-user type grant, §3).
      // AI-visible ≠ `defAccess`.
      resources = resources.filter(
        (r) =>
          isAiVisibleResource(r) &&
          (!capabilities || capabilities.canViewEntity(r.entityDefinitionId ?? r.id))
      )

      // Filter by query if provided
      if (query) {
        resources = resources.filter(
          (r) =>
            r.label.toLowerCase().includes(query) ||
            r.plural.toLowerCase().includes(query) ||
            r.apiSlug.toLowerCase().includes(query)
        )
      }

      const entities = resources.map((r) => ({
        id: r.entityDefinitionId ?? r.id,
        apiSlug: r.apiSlug,
        label: r.label,
        plural: r.plural,
        entityType: r.entityType ?? null,
        icon: r.icon,
        color: r.color,
      }))

      return {
        success: true,
        output: { entities, count: entities.length },
      }
    },
  }
}
