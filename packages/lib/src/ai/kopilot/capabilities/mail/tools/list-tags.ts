// packages/lib/src/ai/kopilot/capabilities/mail/tools/list-tags.ts

import { z } from 'zod'
import { getCachedEntityDefId } from '../../../../../cache'
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
    permission: {
      target: 'definition',
      level: 'read',
      enforcement: 'enforced',
      note: 'canViewEntity on the `tag` definition, silent-empty on denial. Re-targeted from `unmodeled/mail` (19b G2/G7): tags are ordinary EntityInstances of the `tag` system def, which is NOT in NON_RECORD_DEF_SLUGS — so unlike threads/inboxes they DO resolve through the definition ladder, and a real rung existed all along. `update_thread` already resolves the same def id.',
    },
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
      const { db, capabilities } = getDeps()
      const query = args.query as string | undefined
      const limit = Math.min((args.limit as number) ?? DEFAULT_LIMIT, MAX_LIMIT)

      // Definition Read on `tag` (permissions v2 §3). Tags are EntityInstances of
      // the `tag` system def and that def is not mail-infra (it is absent from
      // NON_RECORD_DEF_SLUGS), so it resolves through the ordinary definition
      // ladder — the same gate `list_notes` uses for its owning def. Silent-empty
      // rather than an error, per the list-tool denial convention: a denied caller
      // must not be able to tell "denied" from "no tags". Absent capabilities ⇒
      // unrestricted, as before.
      const tagDefinitionId = await getCachedEntityDefId(agentDeps.organizationId, 'tag')
      if (tagDefinitionId && capabilities && !capabilities.canViewEntity(tagDefinitionId)) {
        return { success: true, output: { tags: [], count: 0 } }
      }

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
