// packages/lib/src/jobs/email/enqueue-email-job.ts

import type { JobsOptions } from 'bullmq'
import { getQueue } from '../../jobs/queues'
import { Queues } from '../../jobs/queues/types'
import type { EmailPayloadByType, EmailType, SendEmailJobData } from './types'

const DEFAULT_EMAIL_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { count: 500 },
  removeOnFail: { count: 2000 },
}

export type EmailEnqueueContext = {
  actorId?: string
  source: string
  organizationId?: string
  requestId?: string
  idempotencyKey?: string
}

export async function enqueueEmailJob<T extends EmailType>(
  emailType: T,
  data: EmailPayloadByType[T] & EmailEnqueueContext,
  options?: JobsOptions
) {
  const { actorId, source, organizationId, requestId, idempotencyKey, ...payload } = data
  const queue = getQueue(Queues.emailQueue)
  const jobId = idempotencyKey ? `email:${emailType}:${idempotencyKey}` : undefined

  const jobData: SendEmailJobData<T> = {
    emailType,
    payload: payload as EmailPayloadByType[T],
    meta: { actorUserId: actorId, source, organizationId, requestId, idempotencyKey },
  }

  return queue.add('sendEmailJob', jobData, {
    ...DEFAULT_EMAIL_JOB_OPTIONS,
    ...options,
    jobId,
  })
}

/** Factory to create a scoped enqueue helper that pre-fills context fields. */
export function createEmailEnqueuer(base: Omit<EmailEnqueueContext, 'idempotencyKey'>) {
  return async function enqueueScopedEmailJob<T extends EmailType>(
    emailType: T,
    payload: EmailPayloadByType[T],
    params?: { options?: JobsOptions; idempotencyKey?: string }
  ) {
    return enqueueEmailJob(
      emailType,
      {
        ...payload,
        ...base,
        idempotencyKey: params?.idempotencyKey,
      },
      params?.options
    )
  }
}
