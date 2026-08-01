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

/**
 * Split the enqueue context off a flat `payload & context` argument.
 *
 * `EmailEnqueueContext`'s keys are disjoint from every `EmailPayloadByType`
 * member, so the rest of the object IS the payload. Expressed over a bare `P`
 * rather than inline over `EmailPayloadByType[T]` — through a generic indexed
 * access the compiler cannot relate `Omit<P & C, keyof C>` back to `P`.
 */
function splitEnqueueContext<P>(data: P & EmailEnqueueContext): {
  context: EmailEnqueueContext
  payload: P
} {
  const { actorId, source, organizationId, requestId, idempotencyKey, ...payload } = data
  return {
    context: { actorId, source, organizationId, requestId, idempotencyKey },
    payload: payload as P,
  }
}

export async function enqueueEmailJob<T extends EmailType>(
  emailType: T,
  data: EmailPayloadByType[T] & EmailEnqueueContext,
  options?: JobsOptions
) {
  const { context, payload } = splitEnqueueContext<EmailPayloadByType[T]>(data)
  const { actorId, source, organizationId, requestId, idempotencyKey } = context
  const queue = getQueue(Queues.emailQueue)
  const jobId = idempotencyKey ? `email-${emailType}-${idempotencyKey}` : undefined

  const jobData: SendEmailJobData<T> = {
    emailType,
    payload,
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
