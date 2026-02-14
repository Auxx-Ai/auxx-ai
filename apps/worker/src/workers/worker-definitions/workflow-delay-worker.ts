// apps/worker/src/workers/worker-definitions/workflow-delay-worker.ts

import {
  approvalReminderJob,
  approvalTimeoutJob,
  executeResourceTrigger,
  resumeWorkflowJob,
} from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues/types'
import { createWorker } from '../utils/createWorker'

const jobMappings = {
  resumeWorkflowJob,
  approvalTimeoutJob,
  approvalReminderJob,
  executeResourceTrigger,
}

/**
 * Worker for processing workflow delay jobs
 */
export function startWorkflowDelayWorker() {
  return createWorker(Queues.workflowDelayQueue, jobMappings, {
    concurrency: 10,
    limiter: {
      max: 100,
      duration: 1000, // 100 jobs per second
    },
  })
}
