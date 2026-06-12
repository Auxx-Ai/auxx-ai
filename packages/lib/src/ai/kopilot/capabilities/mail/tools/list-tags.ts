// packages/lib/src/ai/kopilot/capabilities/mail/tools/list-tags.ts

import { z } from 'zod'
import { TagService } from '../../../../../tags'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { takeSample } from '../../../digests'
import type { GetToolDeps } from '../../types'

/** Full success output of `list_tags` — the workspace's tags with hierarchy. */
const ListTagsOutput = z.object({
  tags: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      color: z.string(),
      emoji: z.string().nullable(),
      isSystemTag: z.boolean(),
      parentId: z.string().nullable(),
    })
  ),
  count: z.number(),
})

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export function createListTagsTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'list_tags',
    displayName: 'List tags',
    toolsetSlug: 'auxx:mail:threads',
    idempotent: true,
    outputSchema: ListTagsOutput,
    exampleOutput: {
      tags: [
        {
          id: 'tag_shipping',
          name: 'Shipping',
          color: 'blue',
          emoji: null,
          isSystemTag: false,
          parentId: null,
        },
        {
          id: 'tag_refund',
          name: 'Refund',
          color: 'red',
          emoji: '💸',
          isSystemTag: false,
          parentId: null,
        },
        {
          id: 'tag_urgent',
          name: 'Urgent',
          color: 'orange',
          emoji: null,
          isSystemTag: true,
          parentId: null,
        },
      ],
      count: 3,
    } satisfies z.output<typeof ListTagsOutput>,
    buildDigest: (output) => {
      const out = (output ?? {}) as {
        tags?: Array<{ name?: string | null }>
        count?: number
      }
      const tags = Array.isArray(out.tags) ? out.tags : []
      return {
        count: typeof out.count === 'number' ? out.count : tags.length,
        names: takeSample(
          tags
            .map((t) => (typeof t.name === 'string' && t.name ? t.name : null))
            .filter((n): n is string => Boolean(n))
        ),
      }
    },
    usageNotes: 'Tag IDs from this tool are what update_thread expects in addTagIds/removeTagIds.',
    description:
      "List the workspace's tags with their IDs, names, colors, and hierarchy. Use to resolve a tag name to an ID before calling update_thread (addTagIds/removeTagIds) or filtering find_threads by tagIds.",
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional case-insensitive filter on tag name',
        },
        limit: {
          type: 'number',
          description: `Max results (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT})`,
        },
      },
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const { db } = getDeps()
      const query = args.query as string | undefined
      const limit = Math.min((args.limit as number) ?? DEFAULT_LIMIT, MAX_LIMIT)

      const service = new TagService(agentDeps.organizationId, agentDeps.userId, db)

      const all = await service.getAllTags()
      const lower = query?.toLowerCase()
      const filtered = lower ? all.filter((t) => t.title.toLowerCase().includes(lower)) : all

      const tags = filtered.slice(0, limit).map((t) => ({
        id: t.id,
        name: t.title,
        color: t.tag_color,
        emoji: t.tag_emoji,
        isSystemTag: t.isSystemTag,
        parentId: t.parentId,
      }))

      return {
        success: true,
        output: { tags, count: tags.length },
      }
    },
  }
}
