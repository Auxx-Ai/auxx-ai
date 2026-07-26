// packages/lib/src/ai/kopilot/capabilities/actors/tools/list-groups.ts

import { z } from 'zod'
import { ActorService } from '../../../../../actors/actor-service'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { takeSample } from '../../../digests'
import type { GetToolDeps } from '../../types'

/** Full success output of `list_groups` — matched groups with a count. */
const ListGroupsOutput = z.object({
  groups: z.array(
    z.object({
      actorId: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      memberCount: z.number(),
      visibility: z.enum(['public', 'private']),
    })
  ),
  count: z.number(),
})

export function createListGroupsTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'list_groups',
    permission: {
      target: 'unmodeled',
      domain: 'directory',
      level: 'read',
      enforcement: 'unenforced',
      note: 'KNOWN GAP (19b G7) — NARROWED, not gated. The private-group leak is fixed: both the list and the search path now go through ActorService\'s accessible-groups filter (ResourceAccess on the group instance), where before only the no-query path did and any `query` fell through to the raw org group cache, returning every visibility:"private" group. What remains ungated is the directory read itself: Area.members is a Full-only ladder about *managing* members, so there is no read rung to bind a lookup to — the level above is the intent, not an existing rung. A `directory` area (or an instance-access key for groups) is the missing model.',
    },
    displayName: 'List groups',
    toolsetSlug: 'auxx:actors',
    idempotent: true,
    outputSchema: ListGroupsOutput,
    exampleOutput: {
      groups: [
        {
          actorId: 'group:supp7Hd2',
          name: 'Support',
          description: 'Front-line customer support team',
          memberCount: 6,
          visibility: 'public',
        },
        {
          actorId: 'group:billQ9rL',
          name: 'Billing',
          description: null,
          memberCount: 2,
          visibility: 'private',
        },
      ],
      count: 2,
    } satisfies z.output<typeof ListGroupsOutput>,
    buildDigest: (output) => {
      const out = (output ?? {}) as {
        groups?: Array<{ name?: string | null }>
        count?: number
      }
      const groups = Array.isArray(out.groups) ? out.groups : []
      return {
        count: typeof out.count === 'number' ? out.count : groups.length,
        names: takeSample(
          groups
            .map((g) => (typeof g.name === 'string' && g.name ? g.name : null))
            .filter((n): n is string => Boolean(n))
        ),
      }
    },
    description:
      "List workspace groups (teams of members). Use to find a group's actorId for assignments and ACTOR-typed fields.",
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search by group name',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 20, max: 50)',
        },
      },
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const { db } = getDeps()
      const query = args.query as string | undefined
      const limit = Math.min((args.limit as number) ?? 20, 50)

      const actorService = new ActorService({
        db,
        organizationId: agentDeps.organizationId,
        userId: agentDeps.userId,
      })

      // ALWAYS list, never search. `searchActors({ target: 'group' })` reads the raw
      // org group cache and applies NO accessibility filter, so passing a `query`
      // returned every group in the org — `visibility: 'private'` ones included,
      // with their member counts. `listActors` routes through
      // `listAccessibleGroups` (ResourceAccess on the group instance, the same
      // filter the human group picker uses), so the name match is applied here,
      // over the already-filtered set, instead of in the service. A private group
      // now surfaces only when the caller holds an explicit grant to it.
      const actors = await actorService.listActors({ target: 'group' })

      const term = query?.trim().toLowerCase()
      const matched = term
        ? actors
            .filter((actor) => actor.name.toLowerCase().includes(term))
            // Same relevance order `searchActors` applied: prefix matches, then alphabetical.
            .sort((a, b) => {
              const aExact = a.name.toLowerCase().startsWith(term)
              const bExact = b.name.toLowerCase().startsWith(term)
              if (aExact !== bExact) return aExact ? -1 : 1
              return a.name.localeCompare(b.name)
            })
        : actors

      const groups = matched
        .slice(0, limit)
        .map((actor) => {
          if (actor.type !== 'group') return null
          return {
            actorId: actor.actorId,
            name: actor.name,
            description: actor.description,
            memberCount: actor.memberCount,
            visibility: actor.visibility,
          }
        })
        .filter(Boolean)

      return {
        success: true,
        output: { groups, count: groups.length },
      }
    },
  }
}
