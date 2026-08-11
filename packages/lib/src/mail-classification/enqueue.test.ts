// packages/lib/src/mail-classification/enqueue.test.ts
// The `then`-side door: the two free payload exits, the dedupe key, and the
// never-throws contract (a failed enqueue must not burn the event handler's
// retry budget).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ add: vi.fn(), getQueue: vi.fn() }))

vi.mock('../jobs/queues', () => ({ getQueue: h.getQueue }))

import { MAIL_CLASSIFICATION_JOB_NAME } from './client'
import { enqueueMailClassification } from './enqueue'

const event = (overrides: Record<string, unknown> = {}) =>
  ({
    data: {
      type: 'message:received',
      data: {
        organizationId: 'org_1',
        messageId: 'msg_1',
        threadId: 'thr_1',
        from: 'a@b.com',
        ...overrides,
      },
    },
  }) as never

beforeEach(() => {
  vi.clearAllMocks()
  h.getQueue.mockReturnValue({ add: h.add })
  h.add.mockResolvedValue({ id: '1' })
})

describe('enqueueMailClassification', () => {
  it('enqueues under the job name the worker maps, keyed for dedupe on messageId', async () => {
    await enqueueMailClassification(event())

    expect(h.add).toHaveBeenCalledWith(
      MAIL_CLASSIFICATION_JOB_NAME,
      {
        organizationId: 'org_1',
        messageId: 'msg_1',
        threadId: 'thr_1',
        from: 'a@b.com',
      },
      { jobId: 'mail-classify-msg_1' }
    )
  })

  // The previous id was `mail-classify:msg_1`, and this test asserted it happily
  // while BullMQ threw `Custom Id cannot contain :` on every single enqueue —
  // live classification never ran once. An equality assertion cannot catch that,
  // because it only proves we passed the string we meant to pass. This one
  // encodes BullMQ's actual rule (`job.js`): a `:` is legal ONLY when the id
  // splits into exactly three parts, a compat carve-out for old repeatable jobs.
  it('builds a jobId BullMQ will accept', async () => {
    await enqueueMailClassification(event())

    const { jobId } = h.add.mock.calls[0]![2] as { jobId: string }
    expect(jobId.includes(':') && jobId.split(':').length !== 3).toBe(false)
    expect(`${Number.parseInt(jobId, 10)}`).not.toBe(jobId)
  })

  it('ignores events that are not `message:received`', async () => {
    await enqueueMailClassification({ data: { type: 'message:sent', data: {} } } as never)
    expect(h.add).not.toHaveBeenCalled()
  })

  it('never queues hard-tier machine mail (exit 1)', async () => {
    await enqueueMailClassification(event({ machineMail: { tier: 'hard', reason: 'ndr' } }))
    expect(h.add).not.toHaveBeenCalled()
  })

  it('queues SOFT-tier machine mail — list/OOO mail is still categorisable', async () => {
    await enqueueMailClassification(event({ machineMail: { tier: 'soft', reason: 'list' } }))
    expect(h.add.mock.calls[0]?.[1]).toMatchObject({ machineMailTier: 'soft' })
  })

  it('never queues a message with no thread (exit 2)', async () => {
    await enqueueMailClassification(event({ threadId: undefined }))
    expect(h.add).not.toHaveBeenCalled()
  })

  it('swallows an enqueue failure rather than failing the fan-out', async () => {
    h.add.mockRejectedValue(new Error('redis down'))
    await expect(enqueueMailClassification(event())).resolves.toBeUndefined()
  })
})
