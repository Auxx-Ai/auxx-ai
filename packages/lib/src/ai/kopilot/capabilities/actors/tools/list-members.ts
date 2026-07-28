// packages/lib/src/ai/kopilot/capabilities/actors/tools/list-members.ts

import { z } from 'zod'
import { ActorService } from '../../../../../actors/actor-service'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { takeSample } from '../../../digests'
import type { GetToolDeps } from '../../types'

/** Full success output of `list_members` — matched workspace members with a count. */
const ListMembersOutput = z.object({
  members: z.array(
    z.object({
      actorId: z.string(),
      name: z.string(),
      email: z.string(),
      role: z.enum(['OWNER', 'ADMIN', 'USER']),
      avatarUrl: z.string().nullable(),
    })
  ),
  count: z.number(),
})

export function createListMembersTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'list_members',
    permission: {
      target: 'unmodeled',
      domain: 'directory',
      level: 'view',
      enforcement: 'unenforced',
      note: 'KNOWN GAP (19b G7) — NARROWED, not gated. The documented `limit` (default 20, max 50) is now honoured on the no-query path too, where it was silently ignored and the whole org roster — name, email, role, every member — came back in one call. The read itself is still unasserted: Area.members is a Full-only ladder about *managing* members, so there is no read rung to bind a directory lookup to; asserting membersManage would demand Full manage authority for a name→actorId lookup, which is a bad mapping, not a fix. The level above is the intent, not an existing rung. A `directory` area is the missing model.',
    },
    displayName: 'List members',
    toolsetSlug: 'auxx:actors',
    idempotent: true,
    outputSchema: ListMembersOutput,
    exampleOutput: {
      members: [
        {
          actorId: 'user:7Hd2aK',
          name: 'Maya Chen',
          email: 'maya@acme.com',
          role: 'OWNER',
          avatarUrl: 'https://cdn.auxx.ai/avatars/7Hd2aK.png',
        },
        {
          actorId: 'user:9rLpQ3',
          name: 'Tom Rivera',
          email: 'tom@acme.com',
          role: 'USER',
          avatarUrl: null,
        },
      ],
      count: 2,
    } satisfies z.output<typeof ListMembersOutput>,
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
      "List workspace members — teammates who use Auxx with the caller. Use to find a member's actorId for assigning tasks, threads, owner/assignee fields, etc. Does NOT return contacts — contacts are CRM entity records (use search_entities for those).",
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

      // `listActors` takes no limit, so the unqueried call used to return the ENTIRE
      // roster — every name, email and role in the org — in one turn, contradicting
      // this tool's own documented `limit`. Bound it here. This caps the dump; it is
      // NOT an authorization check (see `permission.note`).
      const members = actors
        .slice(0, limit)
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
