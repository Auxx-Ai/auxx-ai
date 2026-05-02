// packages/lib/src/ai/kopilot/capabilities/mail/tools/list-drafts.ts

import { generateId } from '@auxx/utils'
import type { Condition, ConditionGroup } from '../../../../../conditions'
import { DraftService } from '../../../../../drafts'
import { ThreadQueryService } from '../../../../../threads'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { type DraftDigestSnapshot, ListDraftsDigest, takeSample } from '../../../digests'
import type { GetToolDeps } from '../../types'

const MAX_RESULTS = 25

/**
 * Build ConditionGroups for the DRAFTS context. Always anchored on
 * `hasDraft=true`, which switches `ThreadQueryService.listThreadIds` into the
 * UNION query that returns both threads-with-drafts and standalone drafts.
 */
function buildDraftConditions(args: Record<string, unknown>): ConditionGroup[] {
  const conditions: Condition[] = [
    {
      id: generateId(),
      fieldId: 'hasDraft',
      operator: 'is',
      value: true,
    },
  ]

  if (args.query) {
    conditions.push({
      id: generateId(),
      fieldId: 'freeText',
      operator: 'contains',
      value: args.query as string,
    })
  }

  if (typeof args.hasAttachments === 'boolean') {
    conditions.push({
      id: generateId(),
      fieldId: 'hasAttachments',
      operator: 'is',
      value: args.hasAttachments,
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

export function createListDraftsTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'list_drafts',
    idempotent: true,
    outputDigestSchema: ListDraftsDigest,
    buildDigest: (output) => {
      const out = (output ?? {}) as { drafts?: DraftDigestSnapshot[]; count?: number }
      const drafts = Array.isArray(out.drafts) ? out.drafts : []
      return {
        count: typeof out.count === 'number' ? out.count : drafts.length,
        sample: takeSample(drafts),
      }
    },
    description:
      'List the current user\'s unsent drafts — both in-progress replies on existing threads and standalone new compositions. Returns subject, snippet, recipient summary, and scheduled-send time when present. Use this for any "drafts", "unsent", or "what am I composing" query. For sent threads, use find_threads instead.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Free-text search across draft subject and body',
        },
        hasAttachments: {
          type: 'boolean',
          description: 'Filter to drafts with (true) or without (false) attachments',
        },
        limit: {
          type: 'number',
          description: `Max results (default 10, max ${MAX_RESULTS})`,
        },
      },
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const { db } = getDeps()
      const threadService = new ThreadQueryService(agentDeps.organizationId, db)
      const draftService = new DraftService(db, agentDeps.organizationId, agentDeps.userId)

      const conditionGroups = buildDraftConditions(args)
      const limit = Math.min((args.limit as number) || 10, MAX_RESULTS)

      const { ids } = await threadService.listThreadIds({
        filter: conditionGroups,
        limit,
        userId: agentDeps.userId,
      })

      if (ids.length === 0) {
        return { success: true, output: { drafts: [], count: 0 } }
      }

      const threadRawIds: string[] = []
      const draftRawIds: string[] = []
      const order: Array<{ kind: 'reply' | 'standalone'; rawId: string; recordId: string }> = []

      for (const recordId of ids) {
        const [prefix, ...rest] = recordId.split(':')
        const rawId = rest.join(':')
        if (prefix === 'thread') {
          threadRawIds.push(rawId)
          order.push({ kind: 'reply', rawId, recordId })
        } else if (prefix === 'draft') {
          draftRawIds.push(rawId)
          order.push({ kind: 'standalone', rawId, recordId })
        }
      }

      const [threadMetas, standaloneMetas] = await Promise.all([
        threadRawIds.length > 0
          ? threadService.getThreadMetaBatch(threadRawIds, agentDeps.userId)
          : Promise.resolve([]),
        draftRawIds.length > 0
          ? draftService.getStandaloneDraftMetas(draftRawIds)
          : Promise.resolve([]),
      ])

      const threadMap = new Map(threadMetas.map((t) => [t.id, t]))
      const standaloneMap = new Map(standaloneMetas.map((d) => [d.id, d]))

      const drafts: DraftDigestSnapshot[] = []
      for (const item of order) {
        if (item.kind === 'reply') {
          const t = threadMap.get(item.rawId)
          if (!t) continue
          drafts.push({
            id: item.recordId,
            kind: 'reply',
            subject: t.subject || null,
            snippet: null,
            recipientSummary: null,
            updatedAt:
              t.lastMessageAt instanceof Date ? t.lastMessageAt.toISOString() : t.lastMessageAt,
            scheduledAt: null,
            threadId: t.id,
          })
        } else {
          const d = standaloneMap.get(item.rawId)
          if (!d) continue
          drafts.push({
            id: item.recordId,
            kind: 'standalone',
            subject: d.subject,
            snippet: d.snippet,
            recipientSummary: d.recipientSummary,
            updatedAt: d.updatedAt,
            scheduledAt: d.scheduledAt,
            threadId: null,
          })
        }
      }

      return {
        success: true,
        output: { drafts, count: drafts.length },
      }
    },
  }
}
