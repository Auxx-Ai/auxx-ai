// packages/lib/src/files/upload/__tests__/compensate.test.ts

/**
 * The Phase 6 exit criterion, on its own.
 *
 * > A forced-failure test proves the object is deleted **or** a cleanup job is
 * > enqueued.
 *
 * `complete.test.ts` proves it end to end, which is worth having — but reaching
 * those four lines there costs a session, a Redis double, a canned `head` result
 * and an insert rigged to return no row. Compensation is a policy over two
 * ports, so once it is a module the policy is testable as one, and the
 * `'failed'` branch (both ports down) becomes reachable at all.
 *
 * `vi.mock` count in this file: **zero**.
 */

import { describe, expect, it } from 'vitest'
import {
  makeJournal,
  makeQueuePort,
  makeStoragePort,
  TEST_BUCKETS,
  TEST_IDS,
} from '../../__tests__/support'
import { type CompensateInput, compensateUploadObject } from '../compensate'

const KEY = `${TEST_IDS.organizationId}/knowledge-base/kb_test/logo.png`

function anOrphan(overrides: Partial<CompensateInput> = {}): CompensateInput {
  return {
    provider: 'S3',
    bucket: TEST_BUCKETS.public,
    key: KEY,
    credentialId: TEST_IDS.credentialId,
    organizationId: TEST_IDS.organizationId,
    reason: 'Upload transaction failed: Error: boom',
    sessionId: 'sess_nanoid_000000000000',
    ...overrides,
  }
}

/** A storage port whose `deleteObject` always throws. */
function unreachableStorage(journal: ReturnType<typeof makeJournal>) {
  return makeStoragePort({
    journal,
    impl: {
      deleteObject: async () => {
        throw new Error('S3 unreachable')
      },
    },
  })
}

describe('compensateUploadObject', () => {
  it('deletes the object from the bucket it was written to, and enqueues nothing', async () => {
    const journal = makeJournal()
    const storage = makeStoragePort({ journal })
    const queue = makeQueuePort({ journal })

    const outcome = await compensateUploadObject(
      { storage: storage.port, queue: queue.port },
      anOrphan()
    )

    expect(outcome).toBe('deleted')

    const deletes = storage.callsTo('deleteObject')
    expect(deletes).toHaveLength(1)
    // A wrong bucket here is invisible in production: S3 answers 204 for a key
    // that is not in the bucket you named, so the object leaks with no error
    // anywhere (#1816/#1817/#1818). Never defaulted, never inferred.
    expect(deletes[0]?.params.bucket).toBe(TEST_BUCKETS.public)
    expect(deletes[0]?.params.key).toBe(KEY)
    expect(deletes[0]?.params.credentialId).toBe(TEST_IDS.credentialId)

    expect(queue.callsTo('enqueueStorageCleanup')).toHaveLength(0)
  })

  it('falls back to a durable cleanup job carrying the same bucket', async () => {
    const journal = makeJournal()
    const storage = unreachableStorage(journal)
    const queue = makeQueuePort({ journal })

    const outcome = await compensateUploadObject(
      { storage: storage.port, queue: queue.port },
      anOrphan()
    )

    expect(outcome).toBe('enqueued')

    const cleanups = queue.callsTo('enqueueStorageCleanup')
    expect(cleanups).toHaveLength(1)
    expect(cleanups[0]?.params).toMatchObject({
      bucket: TEST_BUCKETS.public,
      key: KEY,
      organizationId: TEST_IDS.organizationId,
      reason: 'Upload transaction failed: Error: boom',
    })
  })

  it('never throws, even when both the delete and the enqueue fail', async () => {
    const journal = makeJournal()
    const storage = unreachableStorage(journal)
    const queue = makeQueuePort({
      journal,
      impl: {
        enqueueStorageCleanup: async () => {
          throw new Error('Redis unreachable')
        },
      },
    })

    // Compensation runs while the caller is mid-failure. Replacing that failure
    // with a storage or queue error loses the only thing anyone can act on, and
    // is strictly worse than leaking one object the orphan sweep will find.
    const outcome = await compensateUploadObject(
      { storage: storage.port, queue: queue.port },
      anOrphan()
    )

    expect(outcome).toBe('failed')
  })

  it('tries the object store before the queue, never both when the first works', async () => {
    const journal = makeJournal()
    const storage = makeStoragePort({ journal })
    const queue = makeQueuePort({ journal })

    await compensateUploadObject({ storage: storage.port, queue: queue.port }, anOrphan())

    // The ordering matters: an immediate delete closes the orphan window now,
    // and a job that runs minutes later does not.
    expect(journal.entries.map((entry) => entry.channel)).toEqual(['storage'])
  })
})
