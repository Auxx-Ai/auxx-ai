// packages/lib/src/files/__tests__/support/queue.ts

/**
 * A recording {@link QueuePort} double.
 *
 * The thing this replaces is `getQueue(Queues.thumbnailQueue)` called from
 * inside a service method — a live BullMQ/Redis connection opened as a side
 * effect of the code under test. Here the enqueue is just a recorded call, so a
 * test can assert *what* was scheduled and, via the shared {@link Journal},
 * *when* relative to the surrounding transaction.
 */

import type { QueuePort } from '../../storage/ports'
import type { Journal } from './db'
import { makeJournal } from './db'

/** One enqueued job, in journal order. */
export interface QueueCall<K extends keyof QueuePort = keyof QueuePort> {
  method: K
  params: Parameters<QueuePort[K]>[0]
  /** The job id handed back to the caller. */
  jobId: string
}

export interface MakeQueuePortOptions {
  /** Share ordering with `makeDb` and the other doubles. */
  journal?: Journal
  /** Job ids to hand out, in call order. Defaults to `job_1`, `job_2`, … */
  jobIds?: string[]
  /** Full per-method override, for tests that need an enqueue to throw. */
  impl?: Partial<QueuePort>
}

export interface FakeQueuePort {
  /** Pass this as `FilesDeps.queue`. */
  port: QueuePort
  calls: QueueCall[]
  journal: Journal
  callsTo<K extends keyof QueuePort>(method: K): Array<QueueCall<K>>
}

/** Build a queue double that records every enqueue and returns a deterministic job id. */
export function makeQueuePort(options: MakeQueuePortOptions = {}): FakeQueuePort {
  const journal = options.journal ?? makeJournal()
  const calls: QueueCall[] = []
  const jobIds = [...(options.jobIds ?? [])]
  let issued = 0

  function nextJobId(): string {
    issued += 1
    return jobIds.shift() ?? `job_${issued}`
  }

  /**
   * Journals the enqueue BEFORE running any override, so an override that
   * throws still leaves the ordering evidence a Phase-6 assertion needs.
   */
  async function record<K extends keyof QueuePort>(
    method: K,
    params: Parameters<QueuePort[K]>[0],
    override: ((p: never) => Promise<string>) | undefined
  ): Promise<string> {
    const entry = journal.record('queue', method, { params: params as Record<string, unknown> })
    const jobId = (await override?.(params as never)) ?? nextJobId()
    entry.detail = { ...entry.detail, jobId }
    calls.push({ method, params, jobId })
    return jobId
  }

  const port: QueuePort = {
    enqueueThumbnail: (p) => record('enqueueThumbnail', p, options.impl?.enqueueThumbnail),
    enqueueStorageCleanup: (p) =>
      record('enqueueStorageCleanup', p, options.impl?.enqueueStorageCleanup),
  }

  return {
    port,
    calls,
    journal,
    callsTo: <K extends keyof QueuePort>(method: K) =>
      calls.filter((c): c is QueueCall<K> => c.method === method),
  }
}
