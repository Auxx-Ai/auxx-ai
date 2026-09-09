// packages/lib/src/money/fulfillment-posting/__tests__/auto.test.ts
//
// The `auto` lane is four lines of code and three of them are load bearing, so
// this file tests exactly those three:
//
//  1. **`manual` enqueues NOTHING.** It is the default, and it is the whole
//     promise of the setting: the dialog's preview is the only review this
//     feature has, and a mode that posted anyway would make the setting a lie.
//  2. **`auto` enqueues once, on a per-organization `jobId` with HYPHENS.** The
//     id is what collapses a burst of sync-finishes into the one run that has
//     not started yet, and BullMQ throws on a two-part `jobId` containing a
//     colon - a throw the catch below would swallow, leaving the automatic lane
//     silently dead.
//  3. **It never throws.** Its caller is a finalize pass at the end of a
//     connector sync; a throw there aborts the pass chain to skip a posting the
//     very next sync would pick up anyway.

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  mode: 'manual' as unknown,
  settingError: null as Error | null,
  add: vi.fn<(name: string, data: unknown, options: unknown) => Promise<unknown>>(),
  getQueue: vi.fn<(queue: string) => unknown>(),
  loggerError: vi.fn<(message: string, meta?: unknown) => void>(),
}))

vi.mock('../../../jobs/queues', () => ({
  Queues: { fulfillmentPostingQueue: 'fulfillment-posting' },
  getQueue: (queue: string) => {
    h.getQueue(queue)
    return { add: h.add }
  },
}))
vi.mock('../../../settings/settings-service', () => ({
  getOrganizationSetting: async () => {
    if (h.settingError) throw h.settingError
    return h.mode
  },
}))
vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({
    error: h.loggerError,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}))

const { autoPostFulfillmentsAfterSync, FULFILLMENT_POSTING_JOB_NAME, fulfillmentPostingJobId } =
  await import('../auto')

const ORG = 'org_1'
// The setting read and the enqueue are both mocked, so a sentinel is the honest
// double - this file never touches a connection.
const db = {} as Database

beforeEach(() => {
  h.mode = 'manual'
  h.settingError = null
  h.add.mockReset()
  h.add.mockResolvedValue({ id: 'job_1' })
  h.getQueue.mockReset()
  h.loggerError.mockReset()
})

describe('autoPostFulfillmentsAfterSync', () => {
  it('enqueues nothing while the setting is manual', async () => {
    await autoPostFulfillmentsAfterSync(db, ORG)

    expect(h.getQueue).not.toHaveBeenCalled()
    expect(h.add).not.toHaveBeenCalled()
  })

  it('enqueues nothing for an unset or unknown mode', async () => {
    for (const mode of [null, undefined, '', 'automatic', true]) {
      h.mode = mode
      await autoPostFulfillmentsAfterSync(db, ORG)
    }

    expect(h.add).not.toHaveBeenCalled()
  })

  it('enqueues one job on the per-org jobId when the setting is auto', async () => {
    h.mode = 'auto'

    await autoPostFulfillmentsAfterSync(db, ORG)

    expect(h.getQueue).toHaveBeenCalledWith('fulfillment-posting')
    expect(h.add).toHaveBeenCalledTimes(1)
    expect(h.add).toHaveBeenCalledWith(
      FULFILLMENT_POSTING_JOB_NAME,
      { organizationId: ORG },
      { jobId: `fulfillment-posting-${ORG}` }
    )
  })

  it('uses the same jobId for every enqueue of one organization, so a burst coalesces', async () => {
    h.mode = 'auto'

    await autoPostFulfillmentsAfterSync(db, ORG)
    await autoPostFulfillmentsAfterSync(db, ORG)
    await autoPostFulfillmentsAfterSync(db, ORG)

    const ids = h.add.mock.calls.map((call) => (call[2] as { jobId: string }).jobId)
    expect(new Set(ids)).toEqual(new Set([`fulfillment-posting-${ORG}`]))
  })

  it('never puts a colon in the jobId', () => {
    // ⚠️ BullMQ rejects a custom `jobId` containing `:` unless it splits into
    // exactly three parts, and the enqueue's own catch would swallow the throw.
    expect(fulfillmentPostingJobId('org_with_underscores')).not.toContain(':')
    expect(fulfillmentPostingJobId(ORG)).toBe(`fulfillment-posting-${ORG}`)
  })

  it('swallows and logs a failed setting read', async () => {
    h.settingError = new Error('cache is down')

    await expect(autoPostFulfillmentsAfterSync(db, ORG)).resolves.toBeUndefined()
    expect(h.add).not.toHaveBeenCalled()
    expect(h.loggerError).toHaveBeenCalledTimes(1)
  })

  it('swallows and logs a failed enqueue', async () => {
    h.mode = 'auto'
    h.add.mockRejectedValue(new Error('redis is down'))

    await expect(autoPostFulfillmentsAfterSync(db, ORG)).resolves.toBeUndefined()
    expect(h.loggerError).toHaveBeenCalledTimes(1)
  })
})
