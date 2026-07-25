// packages/lib/src/ai/kopilot/capabilities/mail/tools/update-thread.ts

import { toRecordId } from '@auxx/types/resource'
import { z } from 'zod'
import { getCachedUserMailVisibility, requireCachedEntityDefId } from '../../../../../cache'
import { ThreadMutationService } from '../../../../../threads'
import { parseStringArg } from '../../../../agent-framework/tool-inputs'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

/** Full success output of `update_thread` — the applied status/assignee/tag changes. */
const UpdateThreadOutput = z.object({
  threadId: z.string(),
  updated: z.boolean(),
  changes: z.object({
    status: z.string().optional(),
    assigneeId: z.string().optional(),
    addedTags: z.array(z.string()).optional(),
    removedTags: z.array(z.string()).optional(),
  }),
})

export function createUpdateThreadTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'update_thread',
    permission: {
      target: 'unmodeled',
      domain: 'mail',
      level: 'read_write',
      enforcement: 'enforced',
      note: 'ThreadMutationService is constructed with the viewer; its write gate requires a full lens on the thread.',
    },
    displayName: 'Update thread',
    toolsetSlug: 'auxx:mail:threads',
    outputSchema: UpdateThreadOutput,
    exampleOutput: {
      threadId: 'thread_8fK2pQ',
      updated: true,
      changes: {
        status: 'ARCHIVED',
        assigneeId: 'user_7Hd2',
        addedTags: ['tag_shipping'],
        removedTags: ['tag_urgent'],
      },
    } satisfies z.output<typeof UpdateThreadOutput>,
    buildDigest: (output) => {
      const out = (output ?? {}) as { threadId?: string; changes?: Record<string, unknown> }
      const changes: string[] = []
      const c = out.changes ?? {}
      if (typeof c.status === 'string') changes.push(`status → ${c.status}`)
      if (typeof c.assigneeId === 'string') changes.push(`assignee → ${c.assigneeId}`)
      if (Array.isArray(c.addedTags) && c.addedTags.length > 0) {
        changes.push(`+${c.addedTags.length} tag${c.addedTags.length === 1 ? '' : 's'}`)
      }
      if (Array.isArray(c.removedTags) && c.removedTags.length > 0) {
        changes.push(`-${c.removedTags.length} tag${c.removedTags.length === 1 ? '' : 's'}`)
      }
      return {
        threadId: String(out.threadId ?? ''),
        changes,
      }
    },
    description:
      "Update a thread's status, assignee, or tags. At least one update field must be provided besides threadId.",
    parameters: {
      type: 'object',
      properties: {
        threadId: {
          type: 'string',
          description: 'Thread to update',
        },
        status: {
          type: 'string',
          enum: ['OPEN', 'ARCHIVED', 'SPAM', 'TRASH'],
          description: 'New thread status',
        },
        assigneeId: {
          type: 'string',
          description: 'User ID to assign to (use "unassign" to remove assignment)',
        },
        addTagIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tag IDs to add',
        },
        removeTagIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tag IDs to remove',
        },
      },
      required: ['threadId'],
      additionalProperties: false,
    },
    validateInputs: async (args) => {
      const threadId = parseStringArg(args.threadId, {
        name: 'threadId',
        required: true,
        max: 200,
        stripPrefix: 'thread:',
      })
      if (!threadId.ok) return { ok: false, error: threadId.error }
      return { ok: true, args: { ...args, threadId: threadId.value } }
    },
    execute: async (args, agentDeps) => {
      const { db } = getDeps()
      const threadId = args.threadId as string
      const status = args.status as string | undefined
      const assigneeId = args.assigneeId as string | undefined
      const addTagIds = args.addTagIds as string[] | undefined
      const removeTagIds = args.removeTagIds as string[] | undefined

      const hasStatusOrAssignee = status || assigneeId
      const hasTags =
        (addTagIds && addTagIds.length > 0) || (removeTagIds && removeTagIds.length > 0)

      if (!hasStatusOrAssignee && !hasTags) {
        return {
          success: false,
          output: null,
          error:
            'At least one update field (status, assigneeId, addTagIds, removeTagIds) is required',
        }
      }

      // Kopilot acts as the invoking user (§8.1): mutations require `full`
      // lens on the thread — the service's write gate enforces it.
      const viewer = await getCachedUserMailVisibility(agentDeps.userId, agentDeps.organizationId)
      const service = new ThreadMutationService(
        agentDeps.organizationId,
        db,
        undefined,
        agentDeps.userId,
        viewer
      )
      const changes: Record<string, unknown> = {}

      // Update status and/or assignee
      if (hasStatusOrAssignee) {
        const updates: Record<string, unknown> = {}
        if (status) updates.status = status
        if (assigneeId) {
          updates.assigneeId = assigneeId === 'unassign' ? null : `user:${assigneeId}`
        }
        await service.update(`thread:${threadId}`, updates)
        if (status) changes.status = status
        if (assigneeId) changes.assigneeId = assigneeId
      }

      // Handle tag operations — resolve entity def ids for RecordId shape
      if (hasTags) {
        const [threadEntityDefId, tagEntityDefId] = await Promise.all([
          requireCachedEntityDefId(agentDeps.organizationId, 'thread'),
          requireCachedEntityDefId(agentDeps.organizationId, 'tag'),
        ])
        const threadRecordIds = [toRecordId(threadEntityDefId, threadId)]

        if (addTagIds && addTagIds.length > 0) {
          const tagRecordIds = addTagIds.map((id) => toRecordId(tagEntityDefId, id))
          await service.tagThreadsBulk(threadRecordIds, tagRecordIds, 'add')
          changes.addedTags = addTagIds
        }

        if (removeTagIds && removeTagIds.length > 0) {
          const tagRecordIds = removeTagIds.map((id) => toRecordId(tagEntityDefId, id))
          await service.tagThreadsBulk(threadRecordIds, tagRecordIds, 'remove')
          changes.removedTags = removeTagIds
        }
      }

      return {
        success: true,
        output: { threadId, updated: true, changes },
      }
    },
  }
}
