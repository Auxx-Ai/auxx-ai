// packages/lib/src/ai/kopilot/capabilities/actors/tools/list-groups.ts

import { ActorService } from '../../../../../actors/actor-service'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { ListGroupsDigest, takeSample } from '../../../digests'
import type { GetToolDeps } from '../../types'

export function createListGroupsTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'list_groups',
    idempotent: true,
    outputDigestSchema: ListGroupsDigest,
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
    description: 'List organization groups. Use to find group IDs for assignments.',
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
