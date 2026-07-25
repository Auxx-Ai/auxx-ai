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
      note: 'KNOWN GAP (19b G7). Returns every group org-wide INCLUDING visibility:"private" ones, with member counts. Same missing-read-rung ambiguity as list_members.',
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

      const actors = query
        ? await actorService.searchActors({ query, target: 'group', limit })
        : await actorService.listActors({ target: 'group' })

      const groups = actors
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
