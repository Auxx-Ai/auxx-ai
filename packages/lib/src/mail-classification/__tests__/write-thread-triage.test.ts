// packages/lib/src/mail-classification/__tests__/write-thread-triage.test.ts
// The triage write must reach open lists: it publishes the four columns as a patch.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ publish: vi.fn(), returning: vi.fn() }))

vi.mock('../../realtime', () => ({
  getRealtimeService: () => 'rt',
  publishThreadUpdated: h.publish,
}))

import type { Database } from '@auxx/database'
import { writeThreadTriage } from '../apply'

const db = {
  update: () => ({ set: () => ({ where: () => ({ returning: h.returning }) }) }),
} as unknown as Database

const triage = {
  priority: 'URGENT' as const,
  needsReply: true,
  sentiment: 'NEGATIVE' as const,
  spamScore: 0.02,
  answers: {} as never,
}

describe('writeThreadTriage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('publishes the four columns on the thread inbox channel', async () => {
    h.returning.mockResolvedValue([{ inboxId: 'ibx_1', assigneeId: null }])
    await writeThreadTriage({ db, organizationId: 'org_1', threadId: 'thr_1', triage })
    expect(h.publish).toHaveBeenCalledWith('rt', 'org_1', {
      threadId: 'thr_1',
      inboxId: 'ibx_1',
      assigneeId: null,
      patch: { priority: 'URGENT', needsReply: true, sentiment: 'NEGATIVE', spamScore: 0.02 },
    })
  })

  it('does not publish when the thread is gone', async () => {
    h.returning.mockResolvedValue([])
    await writeThreadTriage({ db, organizationId: 'org_1', threadId: 'thr_1', triage })
    expect(h.publish).not.toHaveBeenCalled()
  })

  it('never throws', async () => {
    h.returning.mockRejectedValue(new Error('db down'))
    await expect(
      writeThreadTriage({ db, organizationId: 'org_1', threadId: 'thr_1', triage })
    ).resolves.toBeUndefined()
  })
})
