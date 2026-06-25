// packages/lib/src/jobs/maintenance/agent-draft-cleanup-job.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, count, eq, isNull, lt, sql } from 'drizzle-orm'
import { archiveAgent } from '../../agents/agent-service'
import type { JobContext } from '../types'

const logger = createScopedLogger('agent-draft-cleanup')

interface AgentDraftCleanupJobData {
  /** Drafts older than this (in days) are eligible for archive. Defaults to 7. */
  staleDays?: number
  batchSize?: number
  dryRun?: boolean
}

export interface AgentDraftCleanupStats {
  scanned: number
  archived: number
  skipped: number
  errors: number
}

/**
 * Archive drafts (`setupCompletedAt IS NULL`) that are >N days old AND have
 * zero builder-session user activity. The cleanup is soft — admins can still
 * find archived drafts under the regular archive filter and recover them by
 * unarchiving. Hard-delete is reserved for the user-driven "Discard draft"
 * path on the agents list.
 */
export async function agentDraftCleanupJob(
  ctx: JobContext<AgentDraftCleanupJobData>
): Promise<AgentDraftCleanupStats> {
  const job = ctx.job
  const { staleDays = 7, batchSize = 100, dryRun = false } = job.data
  const cutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000)

  logger.info('Starting agent draft cleanup', { staleDays, batchSize, dryRun, cutoff })

  const candidates = await database
    .select({
      id: schema.Agent.id,
      organizationId: schema.Agent.organizationId,
    })
    .from(schema.Agent)
    .where(
      and(
        isNull(schema.Agent.setupCompletedAt),
        isNull(schema.Agent.archivedAt),
        lt(schema.Agent.createdAt, cutoff)
      )
    )
    .limit(batchSize)

  const stats: AgentDraftCleanupStats = {
    scanned: candidates.length,
    archived: 0,
    skipped: 0,
    errors: 0,
  }

  for (const candidate of candidates) {
    try {
      // "No chat activity" = no builder session for this agent has any
      // messages in its JSONB array. A session existing with `messages: []`
      // is treated as untouched (the seed prompt never fired a turn).
      const [activity] = await database
        .select({ touched: count() })
        .from(schema.AiAgentSession)
        .where(
          and(
            eq(schema.AiAgentSession.agentId, candidate.id),
            eq(schema.AiAgentSession.type, 'builder'),
            sql`jsonb_array_length(${schema.AiAgentSession.messages}) > 0`
          )
        )

      if (activity && activity.touched > 0) {
        stats.skipped++
        continue
      }

      if (dryRun) {
        stats.archived++
        continue
      }

      await archiveAgent(candidate.id, candidate.organizationId)
      stats.archived++
    } catch (err) {
      stats.errors++
      logger.warn('Failed to archive stale draft', {
        agentId: candidate.id,
        organizationId: candidate.organizationId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  logger.info('Agent draft cleanup finished', stats)
  return stats
}
