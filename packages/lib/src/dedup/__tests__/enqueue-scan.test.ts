// packages/lib/src/dedup/__tests__/enqueue-scan.test.ts
//
// The enqueue contract, which is entirely about the jobId and the delay.
//
// BullMQ collapses a repeated `add` with the same jobId while the job is still
// in the DELAYED state. That is the whole burst-absorption mechanism, so the
// queue fake here models exactly that one property (a Map keyed by jobId) —
// nothing else about BullMQ is being asserted.

import { beforeEach, describe, expect, it, vi } from 'vitest'

interface AddCall {
  name: string
  data: Record<string, unknown>
  opts: { jobId: string; delay: number }
}

const h = vi.hoisted(() => ({
  calls: [] as AddCall[],
  /** jobId → job, mimicking BullMQ's delayed-set dedupe. */
  delayed: new Map<string, AddCall>(),
}))

vi.mock('../../jobs/queues', () => ({
  getQueue: () => ({
    add: async (name: string, data: Record<string, unknown>, opts: AddCall['opts']) => {
      const call = { name, data, opts }
      h.calls.push(call)
      // BullMQ: a same-jobId add while the job is delayed is DROPPED.
      if (!h.delayed.has(opts.jobId)) h.delayed.set(opts.jobId, call)
      return { id: opts.jobId }
    },
  }),
}))
vi.mock('../../jobs/queues/types', () => ({ Queues: { maintenanceQueue: 'maintenance' } }))

import {
  DUPLICATE_SCAN_DELAY_MS,
  DUPLICATE_SCAN_JOB_NAME,
  enqueueDuplicateScan,
  enqueueDuplicateScanForRecords,
} from '../enqueue-scan'

beforeEach(() => {
  h.calls.length = 0
  h.delayed.clear()
})

describe('enqueueDuplicateScan — the org+def jobId IS the burst absorber', () => {
  it('collapses N creates for the same org+def into ONE delayed job', async () => {
    // The mail-sync case: a first-connect mailbox sync creates hundreds of
    // contacts through `findOrCreate`, which fires the mutation seam LIVE — the
    // same landmine family as polling backfill mass-firing `message:received`.
    for (let i = 0; i < 200; i++) {
      await enqueueDuplicateScan('org_1', 'def_contact')
    }

    expect(h.calls).toHaveLength(200)
    expect(h.delayed.size).toBe(1)
    expect([...h.delayed.keys()]).toEqual(['dup-scan:org_1:def_contact'])
  })

  it('never keys the job on a record — the watermark finds the dirty records', async () => {
    // A per-record jobId only dedupes re-writes of the SAME record, so a backfill
    // would enqueue one job per created contact.
    await enqueueDuplicateScan('org_1', 'def_contact')
    const call = h.calls[0]!
    expect(call.data).toEqual({ organizationId: 'org_1', entityDefinitionId: 'def_contact' })
    expect(call.data).not.toHaveProperty('recordIds')
    expect(call.opts.jobId).toBe('dup-scan:org_1:def_contact')
  })

  it('keeps orgs and definitions on separate jobIds', async () => {
    await enqueueDuplicateScan('org_1', 'def_contact')
    await enqueueDuplicateScan('org_1', 'def_company')
    await enqueueDuplicateScan('org_2', 'def_contact')
    expect(h.delayed.size).toBe(3)
  })

  it('enqueues under the name the worker maps', async () => {
    await enqueueDuplicateScan('org_1', 'def_contact')
    expect(h.calls[0]?.name).toBe(DUPLICATE_SCAN_JOB_NAME)
    expect(DUPLICATE_SCAN_JOB_NAME).toBe('duplicateScanJob')
  })

  it('delays the job — a zero delay would defeat the coalescing entirely', async () => {
    await enqueueDuplicateScan('org_1', 'def_contact')
    expect(h.calls[0]?.opts.delay).toBe(DUPLICATE_SCAN_DELAY_MS)
    expect(DUPLICATE_SCAN_DELAY_MS).toBeGreaterThan(0)
  })
})

describe('enqueueDuplicateScanForRecords — one job per RUN', () => {
  it('scopes the jobId to the run, so a redelivered pointer event is a no-op', async () => {
    await enqueueDuplicateScanForRecords({
      organizationId: 'org_1',
      recordIds: ['def_contact:a', 'def_contact:b'],
      scopeKey: 'run_1',
    })
    await enqueueDuplicateScanForRecords({
      organizationId: 'org_1',
      recordIds: ['def_contact:a', 'def_contact:b'],
      scopeKey: 'run_1',
    })

    expect(h.calls).toHaveLength(2)
    expect(h.delayed.size).toBe(1)
    expect([...h.delayed.keys()]).toEqual(['dup-scan:run_1'])
  })

  it('carries the manifest ids and runs immediately', async () => {
    // The point of this door is that a connector record's pairs appear right
    // after its run rather than up to 6h later.
    await enqueueDuplicateScanForRecords({
      organizationId: 'org_1',
      recordIds: ['def_contact:a'],
      scopeKey: 'import_9',
    })
    expect(h.calls[0]?.data).toEqual({
      organizationId: 'org_1',
      recordIds: ['def_contact:a'],
    })
    expect(h.calls[0]?.opts.delay).toBe(0)
  })

  it('enqueues nothing for an empty manifest', async () => {
    const id = await enqueueDuplicateScanForRecords({
      organizationId: 'org_1',
      recordIds: [],
      scopeKey: 'run_1',
    })
    expect(id).toBeUndefined()
    expect(h.calls).toHaveLength(0)
  })
})
