// packages/lib/src/ai/kopilot/capabilities/mail/tools/find-threads.ts

import { generateId } from '@auxx/utils'
import type { Condition, ConditionGroup } from '../../../../../conditions'
import { ThreadQueryService } from '../../../../../threads'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { FindThreadsDigest, takeSample } from '../../../digests'
import type { GetToolDeps } from '../../types'

const MAX_RESULTS = 25

/**
 * Build ConditionGroups from flat search args.
 * Maps user-friendly args to the condition format ThreadQueryService expects.
 */
function buildThreadConditions(args: Record<string, unknown>): ConditionGroup[] {
  const conditions: Condition[] = []

  if (args.status) {
    conditions.push({
      id: generateId(),
      fieldId: 'status',
      operator: 'is',
      value: (args.status as string).toLowerCase(),
    })
  }

  if (args.assigneeId) {
    conditions.push({
      id: generateId(),
      fieldId: 'assignee',
      operator: 'is',
      value: args.assigneeId as string,
    })
  }

  if (args.query) {
    conditions.push({
      id: generateId(),
      fieldId: 'freeText',
      operator: 'contains',
      value: args.query as string,
    })
  }

  if (args.sender) {
    conditions.push({
      id: generateId(),
      fieldId: 'sender',
      operator: 'contains',
      value: args.sender as string,
    })
  }

  if (args.tagIds && Array.isArray(args.tagIds) && args.tagIds.length > 0) {
    conditions.push({
      id: generateId(),
      fieldId: 'tag',
      operator: 'in',
      value: args.tagIds as string[],
    })
  }

  if (conditions.length === 0) {
    // Default: show open threads
    conditions.push({
      id: generateId(),
      fieldId: 'status',
      operator: 'is',
      value: 'open',
    })
  }

  return [
    {
      id: generateId(),
      conditions,
      logicalOperator: 'AND',
    },
  ]
}

export function createFindThreadsTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'find_threads',
    idempotent: true,
    outputDigestSchema: FindThreadsDigest,
    buildDigest: (output) => {
      const out = (output ?? {}) as { threads?: Array<Record<string, unknown>>; count?: number }
      const threads = Array.isArray(out.threads) ? out.threads : []
      return {
        count: typeof out.count === 'number' ? out.count : threads.length,
        sample: takeSample(threads).map((t) => ({
          threadId: String(t.id ?? ''),
          subject: typeof t.subject === 'string' ? t.subject : null,
          sender: typeof t.sender === 'string' ? t.sender : undefined,
          lastMessageAt: typeof t.lastMessageAt === 'string' ? t.lastMessageAt : null,
          isUnread: typeof t.isUnread === 'boolean' ? t.isUnread : undefined,
        })),
      }
    },
    description:
      'Search and filter email threads by status, assignee, tags, sender, or free-text query. Returns a list of matching thread summaries.',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['OPEN', 'ARCHIVED', 'SPAM', 'TRASH'],
          description: 'Filter by thread status',
        },
        assigneeId: {
          type: 'string',
          description: 'Filter by assigned user ID',
        },
        query: {
          type: 'string',
          description: 'Free-text search across subject and body',
        },
        sender: {
          type: 'string',
          description: 'Filter by sender email or domain',
        },
        tagIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by tag IDs',
        },
        limit: {
          type: 'number',
          description: `Max results (default 10, max ${MAX_RESULTS})`,
        },
        sortBy: {
          type: 'string',
          enum: ['lastMessageAt', 'subject'],
          description: 'Sort field (default: lastMessageAt)',
        },
        sortDirection: {
          type: 'string',
          enum: ['asc', 'desc'],
          description: 'Sort direction (default: desc)',
        },
      },
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const { db } = getDeps()
      const service = new ThreadQueryService(agentDeps.organizationId, db)

      const conditionGroups = buildThreadConditions(args)
      const limit = Math.min((args.limit as number) || 10, MAX_RESULTS)

      const { ids } = await service.listThreadIds({
        filter: conditionGroups,
        sort: {
          field: (args.sortBy as 'lastMessageAt' | 'subject') ?? 'lastMessageAt',
          direction: (args.sortDirection as 'asc' | 'desc') ?? 'desc',
        },
        limit,
        userId: agentDeps.userId,
      })

      if (ids.length === 0) {
        return { success: true, output: { threads: [], count: 0 } }
      }

      // Extract raw IDs from RecordId format ("thread:abc" → "abc")
      const rawIds = ids.map((id) => {
        const parts = id.split(':')
        return parts.length > 1 ? parts.slice(1).join(':') : id
      })

      const threadMetas = await service.getThreadMetaBatch(rawIds, agentDeps.userId)

      const threads = threadMetas.map((t) => ({
        id: t.id,
        subject: t.subject,
        status: t.status,
        assigneeId: t.assigneeId,
        lastMessageAt:
          t.lastMessageAt instanceof Date ? t.lastMessageAt.toISOString() : t.lastMessageAt,
        messageCount: t.messageCount,
        isUnread: t.isUnread,
        tagIds: t.tagIds,
      }))

      return {
        success: true,
        output: { threads, count: threads.length },
      }
    },
  }
}
