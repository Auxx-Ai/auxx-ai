// packages/lib/src/files/upload/__tests__/abort.test.ts

/**
 * Releasing an abandoned multipart upload.
 *
 * The gap this closes was found by hand, not by a test: cancelling a 184 MB
 * multipart upload in the browser left its parts in `auxx-dev-private`, and
 * nothing in the codebase could ever remove them — there was no abort call
 * anywhere, and the bucket had no `AbortIncompleteMultipartUpload` rule.
 *
 * The three properties worth pinning are all about *not* making a cancel worse:
 * a single-part session must not call storage at all, a failed abort must not
 * throw into the caller's cancel path, and the bucket must be the one the upload
 * was started in.
 *
 * `vi.mock` count in this file: **zero**.
 */

import { describe, expect, it } from 'vitest'
import { makeJournal, makeStoragePort, TEST_BUCKETS, TEST_IDS } from '../../__tests__/support'
import { type AbortInput, abortMultipartUpload } from '../abort'

const KEY = `${TEST_IDS.organizationId}/file/temp/1787608775497_Ollama-darwin.zip`

function anAbandonedUpload(overrides: Partial<AbortInput> = {}): AbortInput {
  return {
    provider: 'S3',
    bucket: TEST_BUCKETS.private,
    key: KEY,
    credentialId: TEST_IDS.credentialId,
    uploadId: 'Sk86dPkYGArqgRbYYsG',
    reason: 'user-cancelled',
    sessionId: 'sess_nanoid_000000000000',
    ...overrides,
  }
}

describe('abortMultipartUpload', () => {
  it('releases the upload against the bucket it was started in', async () => {
    const journal = makeJournal()
    const storage = makeStoragePort({ journal })

    const outcome = await abortMultipartUpload({ storage: storage.port }, anAbandonedUpload())

    expect(outcome).toBe('aborted')

    const calls = storage.callsTo('abortMultipart')
    expect(calls).toHaveLength(1)
    // The bucket is carried from the session, never re-derived: an abort against
    // the wrong bucket raises NoSuchUpload and the real parts stay behind.
    expect(calls[0]?.params).toMatchObject({
      bucket: TEST_BUCKETS.private,
      key: KEY,
      uploadId: 'Sk86dPkYGArqgRbYYsG',
    })
  })

  it('does not touch storage when the session was single-part', async () => {
    const journal = makeJournal()
    const storage = makeStoragePort({ journal })

    // No `uploadId`: an abandoned PUT never becomes an object, so there is
    // nothing for S3 to hold and nothing to release.
    const outcome = await abortMultipartUpload(
      { storage: storage.port },
      anAbandonedUpload({ uploadId: undefined })
    )

    expect(outcome).toBe('skipped')
    expect(storage.callsTo('abortMultipart')).toHaveLength(0)
  })

  it('swallows a storage failure so a cancel never surfaces as an error', async () => {
    const journal = makeJournal()
    const storage = makeStoragePort({
      journal,
      impl: {
        abortMultipart: async () => {
          throw new Error('S3 unreachable')
        },
      },
    })

    // The caller is already cancelling. Replacing that with a storage error the
    // user cannot act on is strictly worse than leaking parts the bucket's
    // lifecycle rule reclaims.
    const outcome = await abortMultipartUpload({ storage: storage.port }, anAbandonedUpload())

    expect(outcome).toBe('failed')
  })
})
