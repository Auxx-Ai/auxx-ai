// packages/lib/src/jobs/recording/ai-post-process-job.ts

import { database as db } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { runAIPostProcess } from '../../recording/ai/post-process'
import type { PostProcessScope } from '../../recording/ai/types'

const logger = createScopedLogger('job:ai-post-process')

export interface AIPostProcessJobData {
  recordingId: string
  organizationId: string
  trigger: 'transcript.completed' | 'manual'
  scope?: PostProcessScope
  userId?: string
}

/**
 * Run AI post-processing (summary, chapters, default insights) for a recording.
 * Enqueued after transcription completes, or manually via the recording drawer.
 */
export const aiPostProcessJob = async (jobOrCtx: Job<AIPostProcessJobData>) => {
  const job: Job<AIPostProcessJobData> = (jobOrCtx as any).job ?? jobOrCtx
  const { recordingId, organizationId, scope, userId, trigger } = job.data

  logger.info('Starting AI post-processing', {
    jobId: job.id,
    recordingId,
    trigger,
    scope: scope ?? 'all',
  })

  const result = await runAIPostProcess({
    db,
    organizationId,
    callRecordingId: recordingId,
    scope,
    userId,
  })

  if (result.isErr()) {
    logger.error('AI post-processing failed', {
      jobId: job.id,
      recordingId,
      error: result.error.message,
    })
    throw result.error
  }

  logger.info('AI post-processing completed', {
    jobId: job.id,
    recordingId,
  })
}
