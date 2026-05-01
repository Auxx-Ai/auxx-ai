// packages/lib/src/ai/kopilot/capabilities/actors/tools/list-members.ts

import { ActorService } from '../../../../../actors/actor-service'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { ListMembersDigest, takeSample } from '../../../digests'
import type { GetToolDeps } from '../../types'

export function createListMembersTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'list_members',
    idempotent: true,
    outputDigestSchema: ListMembersDigest,
    buildDigest: (output) => {
      const out = (output ?? {}) as {
        members?: Array<{ name?: string | null }>
        count?: number
      }
      const members = Array.isArray(out.members) ? out.members : []
      return {
        count: typeof out.count === 'number' ? out.count : members.length,
        names: takeSample(
          members
            .map((m) => (typeof m.name === 'string' && m.name ? m.name : null))
            .filter((n): n is string => Boolean(n))
        ),
      }
    },
    description:
      'List organization members (users). Use to find user IDs for assigning tasks, threads, etc.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search by name or email',
        },
        role: {
          type: 'string',
          enum: ['OWNER', 'ADMIN', 'USER'],
          description: 'Filter by role',
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
      const role = args.role as 'OWNER' | 'ADMIN' | 'USER' | undefined
      const limit = Math.min((args.limit as number) ?? 20, 50)
      const roles = role ? [role] : undefined

      const actorService = new ActorService({
        db,
        organizationId: agentDeps.organizationId,
        userId: agentDeps.userId,
      })

      const actors = query
        ? await actorService.searchActors({ query, target: 'user', roles, limit })
        : await actorService.listActors({ target: 'user', roles })

      const members = actors
        .map((actor) => {
          if (actor.type !== 'user') return null
          return {
            actorId: actor.actorId,
            name: actor.name,
            email: actor.email,
            role: actor.role,
            avatarUrl: actor.avatarUrl,
          }
        })
        .filter(Boolean)

      return {
        success: true,
        output: { members, count: members.length },
      }
    },
  }
}
