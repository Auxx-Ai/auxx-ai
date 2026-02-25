import { Queues } from '@auxx/lib/jobs/queues'
import { createWorker } from '../utils/createWorker'

const jobMappings = {
  // createDocumentLogJob: jobs.createDocumentLogJob,
  // createProviderLogJob: jobs.createProviderLogJob,
  // uploadDocumentLogsJob: jobs.uploadDocumentLogsJob,
  // checkScheduledDocumentTriggersJob: jobs.checkScheduledDocumentTriggersJob,
  // processScheduledTriggerJob: jobs.processScheduledTriggerJob,
  // runEmailTriggerJob: jobs.runEmailTriggerJob,
}

export function startDefaultWorker() {
  return createWorker(Queues.defaultQueue, jobMappings)
}
