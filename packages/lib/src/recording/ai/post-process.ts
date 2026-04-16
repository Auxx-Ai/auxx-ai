// packages/lib/src/recording/ai/post-process.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { publisher } from '../../events/publisher'
import { generateChapters } from './chapter-generator'
import { runDefaultInsights } from './insight-runner'
import { generateSummary } from './summary-generator'
import type { PostProcessScope } from './types'

const logger = createScopedLogger('recording:ai:post-process')

export interface RunAIPostProcessParams {
  db: Database
  organizationId: string
  callRecordingId: string
  scope?: PostProcessScope
  userId?: string
}

/**
 * Fan out summary, chapter, and insight generation for a recording.
 * Summary is the primary signal — if it fails, overall status is 'failed'.
 * Individual insight failures don't flip overall status.
 */
export async function runAIPostProcess(
  params: RunAIPostProcessParams
): Promise<Result<void, Error>> {
  const { db, organizationId, callRecordingId, scope = 'all', userId } = params

  await db
    .update(schema.CallRecording)
    .set({ aiProcessingStatus: 'processing', aiProcessingError: null })
    .where(eq(schema.CallRecording.id, callRecordingId))

  const runSummary = scope === 'all' || scope === 'summary'
  const runChapters = scope === 'all' || scope === 'chapters'
  const runInsights = scope === 'all' || scope === 'insights'

  const tasks: Array<{
    name: 'summary' | 'chapters' | 'insights'
    promise: Promise<Result<unknown, Error>>
  }> = []

  if (runSummary) {
    tasks.push({
      name: 'summary',
      promise: generateSummary({ db, organizationId, callRecordingId, userId }),
    })
  }
  if (runChapters) {
    tasks.push({
      name: 'chapters',
      promise: generateChapters({ db, organizationId, callRecordingId, userId }),
    })
  }
  if (runInsights) {
    tasks.push({
      name: 'insights',
      promise: runDefaultInsights({ db, organizationId, callRecordingId, userId }),
    })
  }

  const settled = await Promise.allSettled(tasks.map((t) => t.promise))

  const outcomes: Record<string, { ok: boolean; error?: string }> = {}
  settled.forEach((result, idx) => {
    const name = tasks[idx]!.name
    if (result.status === 'rejected') {
      outcomes[name] = {
        ok: false,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      }
      return
    }
    if (result.value.isErr()) {
      outcomes[name] = { ok: false, error: result.value.error.message }
      return
    }
    outcomes[name] = { ok: true }
  })

  // Emit per-task events.
  if (outcomes.summary?.ok) {
    await publisher.publishLater({
      type: 'recording:ai.summary_ready',
      data: { recordingId: callRecordingId, organizationId },
    })
  } else if (outcomes.summary && !outcomes.summary.ok) {
    await publisher.publishLater({
      type: 'recording:ai.failed',
      data: {
        recordingId: callRecordingId,
        organizationId,
        scope: 'summary',
        error: outcomes.summary.error ?? 'unknown',
      },
    })
  }

  if (outcomes.chapters?.ok) {
    const chapterRows = await db
      .select({ id: schema.RecordingChapter.id })
      .from(schema.RecordingChapter)
      .where(eq(schema.RecordingChapter.callRecordingId, callRecordingId))
    await publisher.publishLater({
      type: 'recording:ai.chapters_ready',
      data: {
        recordingId: callRecordingId,
        organizationId,
        chapterCount: chapterRows.length,
      },
    })
  } else if (outcomes.chapters && !outcomes.chapters.ok) {
    await publisher.publishLater({
      type: 'recording:ai.failed',
      data: {
        recordingId: callRecordingId,
        organizationId,
        scope: 'chapters',
        error: outcomes.chapters.error ?? 'unknown',
      },
    })
  }

  if (outcomes.insights?.ok) {
    const insightRows = await db
      .select({
        id: schema.RecordingInsight.id,
        templateId: schema.RecordingInsight.insightTemplateId,
      })
      .from(schema.RecordingInsight)
      .where(eq(schema.RecordingInsight.callRecordingId, callRecordingId))
    await Promise.all(
      insightRows.map((row) =>
        publisher.publishLater({
          type: 'recording:ai.insights_ready',
          data: {
            recordingId: callRecordingId,
            organizationId,
            insightId: row.id,
            templateId: row.templateId,
          },
        })
      )
    )
  } else if (outcomes.insights && !outcomes.insights.ok) {
    await publisher.publishLater({
      type: 'recording:ai.failed',
      data: {
        recordingId: callRecordingId,
        organizationId,
        scope: 'insights',
        error: outcomes.insights.error ?? 'unknown',
      },
    })
  }

  // Summary is the primary signal for overall completion.
  const summaryFailed = runSummary && outcomes.summary && !outcomes.summary.ok
  const anyFailed = Object.values(outcomes).some((o) => !o.ok)

  if (summaryFailed) {
    const message = formatErrorSummary(outcomes)
    await db
      .update(schema.CallRecording)
      .set({
        aiProcessingStatus: 'failed',
        aiProcessingError: message,
      })
      .where(eq(schema.CallRecording.id, callRecordingId))

    logger.error('AI post-processing failed (summary failed)', {
      callRecordingId,
      outcomes,
    })

    return err(new Error(message))
  }

  await db
    .update(schema.CallRecording)
    .set({
      aiProcessingStatus: 'completed',
      aiProcessingError: anyFailed ? formatErrorSummary(outcomes) : null,
      aiProcessedAt: new Date(),
    })
    .where(eq(schema.CallRecording.id, callRecordingId))

  logger.info('AI post-processing completed', {
    callRecordingId,
    outcomes,
    partialFailure: anyFailed,
  })

  return ok(undefined)
}

function formatErrorSummary(outcomes: Record<string, { ok: boolean; error?: string }>): string {
  return Object.entries(outcomes)
    .filter(([, v]) => !v.ok)
    .map(([k, v]) => `${k}: ${v.error ?? 'unknown'}`)
    .join('; ')
}
