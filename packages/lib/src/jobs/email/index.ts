// packages/lib/src/jobs/email/index.ts

export type { EmailEnqueueContext } from './enqueue-email-job'
export { createEmailEnqueuer, enqueueEmailJob } from './enqueue-email-job'
export { sendEmailJob } from './send-email-job'
export type {
  EmailPayloadByType,
  EmailRecipient,
  EmailType,
  SendEmailJobData,
} from './types'
export { emailTypeSchema } from './types'
