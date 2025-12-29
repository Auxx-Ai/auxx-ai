// packages/lib/src/jobs/workflow/workflow-file-cleanup-job.ts

import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('workflow-file-cleanup-job')

export async function workflowFileCleanupJob() {
  logger.info('Starting workflow file cleanup job')

  try {
    // Get stats before cleanup
    // const statsBefore = await WorkflowFileCleanupService.getCleanupStats()
    // logger.info('Cleanup stats before', statsBefore)

    // // Run cleanup
    // await WorkflowFileCleanupService.cleanupExpiredFiles()

    // // Get stats after cleanup
    // const statsAfter = await WorkflowFileCleanupService.getCleanupStats()
    // logger.info('Cleanup stats after', statsAfter)

    logger.info('Workflow file cleanup job completed successfully')
  } catch (error) {
    logger.error('Workflow file cleanup job failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

// Schedule this to run every hour
// Add to your job scheduler (BullMQ, etc.)
