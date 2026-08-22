// packages/lib/src/files/storage/__tests__/upload-policy.test.ts

/**
 * `enforceUploadPolicy` — the whole upload gate, table-driven, zero mocks.
 *
 * This is the Phase-3 exit criterion (`plans/attachments/03-storage-layer.md`,
 * "Exit criteria"). The same rules used to be `StorageManager.enforcePolicy`, a
 * `private` method reachable only by constructing a `StorageManager`, mocking
 * `@auxx/credentials`, `@auxx/credentials/store`, `@auxx/logger`, the S3 adapter
 * *and* `storage/locations.ts`, and then calling `generatePresignedUploadUrl` —
 * six `vi.mock` calls to test four `if` statements. `policy-enforcement.test.ts`
 * still does exactly that, because it is testing the facade's forwarding.
 *
 * This file calls `vi.mock` zero times, because there is nothing to intercept:
 * the function takes data and returns nothing.
 */

import { describe, expect, it } from 'vitest'
import { BadRequestError } from '../../../errors'
import type { UploadPolicy } from '../../upload/init-types'
import { enforceUploadPolicy, type UploadCandidate } from '../presign'

const POLICY: UploadPolicy = {
  keyPrefix: 'org123/',
  contentLengthRange: [100, 10 * 1024 * 1024],
  maxTtl: 3600,
  allowedMimeTypes: ['application/pdf', 'image/*'],
}

const CANDIDATE: UploadCandidate = {
  storageKey: 'org123/file/report.pdf',
  ttlSec: 600,
  expectedSize: 1024,
  mimeType: 'application/pdf',
}

/** A candidate that differs from the compliant baseline in exactly one way. */
function candidate(overrides: Partial<UploadCandidate> = {}): UploadCandidate {
  return { ...CANDIDATE, ...overrides }
}

function policy(overrides: Partial<UploadPolicy> = {}): UploadPolicy {
  return { ...POLICY, ...overrides }
}

describe('enforceUploadPolicy', () => {
  it('accepts a candidate that satisfies every rule', () => {
    expect(() => enforceUploadPolicy(POLICY, CANDIDATE)).not.toThrow()
  })

  describe.each<[string, UploadPolicy, UploadCandidate]>([
    ['key exactly at the prefix', POLICY, candidate({ storageKey: 'org123/' })],
    ['ttl exactly at the ceiling', POLICY, candidate({ ttlSec: 3600 })],
    ['size exactly at the floor', POLICY, candidate({ expectedSize: 100 })],
    ['size exactly at the ceiling', POLICY, candidate({ expectedSize: 10 * 1024 * 1024 })],
    [
      'zero floor admits a zero-byte upload',
      policy({ contentLengthRange: [0, 10] }),
      candidate({ expectedSize: 0 }),
    ],
    ['family wildcard matches its family', POLICY, candidate({ mimeType: 'image/png' })],
    [
      'family wildcard matches a parameterised type',
      POLICY,
      candidate({ mimeType: 'image/svg+xml' }),
    ],
    [
      'universal wildcard matches anything',
      policy({ allowedMimeTypes: ['*/*'] }),
      candidate({ mimeType: 'application/x-msdownload' }),
    ],
    [
      'exact match wins even with no wildcards',
      policy({ allowedMimeTypes: ['text/csv'] }),
      candidate({ mimeType: 'text/csv' }),
    ],
    [
      'an empty prefix admits any key',
      policy({ keyPrefix: '' }),
      candidate({ storageKey: 'anything/at/all' }),
    ],
  ])('accepts: %s', (_name, p, c) => {
    it('does not throw', () => {
      expect(() => enforceUploadPolicy(p, c)).not.toThrow()
    })
  })

  describe.each<[string, UploadPolicy, UploadCandidate, string]>([
    [
      'key outside the org prefix',
      POLICY,
      candidate({ storageKey: 'org456/file/report.pdf' }),
      "Key must start with 'org123/'",
    ],
    [
      'key missing the prefix entirely',
      POLICY,
      candidate({ storageKey: 'report.pdf' }),
      "Key must start with 'org123/'",
    ],
    [
      'prefix match is case sensitive',
      POLICY,
      candidate({ storageKey: 'ORG123/report.pdf' }),
      "Key must start with 'org123/'",
    ],
    ['ttl one second over', POLICY, candidate({ ttlSec: 3601 }), 'TTL exceeds 3600s'],
    ['ttl absurdly over', POLICY, candidate({ ttlSec: 86400 * 365 }), 'TTL exceeds 3600s'],
    [
      'size below the floor',
      POLICY,
      candidate({ expectedSize: 99 }),
      `Size 99 outside [100, ${10 * 1024 * 1024}]`,
    ],
    [
      'size above the ceiling',
      POLICY,
      candidate({ expectedSize: 10 * 1024 * 1024 + 1 }),
      `Size ${10 * 1024 * 1024 + 1} outside [100, ${10 * 1024 * 1024}]`,
    ],
    [
      'MAX_SAFE_INTEGER size',
      POLICY,
      candidate({ expectedSize: Number.MAX_SAFE_INTEGER }),
      `Size ${Number.MAX_SAFE_INTEGER} outside [100, ${10 * 1024 * 1024}]`,
    ],
    [
      'disallowed mime type',
      POLICY,
      candidate({ mimeType: 'application/x-msdownload' }),
      "MIME 'application/x-msdownload' not allowed",
    ],
    [
      'wrong family for a family wildcard',
      policy({ allowedMimeTypes: ['image/*'] }),
      candidate({ mimeType: 'video/mp4' }),
      "MIME 'video/mp4' not allowed",
    ],
    [
      'empty allow-list admits nothing',
      policy({ allowedMimeTypes: [] }),
      candidate({ mimeType: 'application/pdf' }),
      "MIME 'application/pdf' not allowed",
    ],
    [
      'a charset parameter defeats an exact match',
      policy({ allowedMimeTypes: ['text/html'] }),
      candidate({ mimeType: 'text/html; charset=utf-8' }),
      "MIME 'text/html; charset=utf-8' not allowed",
    ],
  ])('rejects: %s', (_name, p, c, message) => {
    it(`throws BadRequestError "${message}"`, () => {
      expect(() => enforceUploadPolicy(p, c)).toThrow(BadRequestError)
      expect(() => enforceUploadPolicy(p, c)).toThrow(message)
    })
  })

  describe('order of the checks', () => {
    it('reports the key before the TTL, size or MIME', () => {
      expect(() =>
        enforceUploadPolicy(
          POLICY,
          candidate({
            storageKey: 'other/x.exe',
            ttlSec: 99999,
            expectedSize: 0,
            mimeType: 'application/x-msdownload',
          })
        )
      ).toThrow("Key must start with 'org123/'")
    })

    it('reports the TTL before the size or MIME', () => {
      expect(() =>
        enforceUploadPolicy(
          POLICY,
          candidate({ ttlSec: 99999, expectedSize: 0, mimeType: 'application/x-msdownload' })
        )
      ).toThrow('TTL exceeds 3600s')
    })

    it('reports the size before the MIME', () => {
      expect(() =>
        enforceUploadPolicy(
          POLICY,
          candidate({ expectedSize: 0, mimeType: 'application/x-msdownload' })
        )
      ).toThrow('Size 0 outside [100')
    })
  })

  describe('documented non-guarantees', () => {
    /**
     * The prefix rule is `startsWith`, not path containment. This is not a bug
     * to fix here: S3 object keys are opaque strings and `..` has no traversal
     * meaning to them, so the key below addresses a literal object named
     * `org123/../../../etc/passwd` inside the org's own prefix. The test exists
     * so nobody reads `keyPrefix` as a path-containment guarantee.
     */
    it('does not canonicalise the key, so `..` segments pass the prefix rule', () => {
      expect(() =>
        enforceUploadPolicy(POLICY, candidate({ storageKey: 'org123/../../../etc/passwd' }))
      ).not.toThrow()
    })

    /**
     * `expectedSize` and `mimeType` are what the *client* declared. For a
     * single-shot upload S3 re-enforces both through the presigned POST policy;
     * for a multipart upload nothing does, until the `headObject` after
     * completion. See the header of `storage/presign.ts`.
     */
    it('judges the declared size, not the delivered one', () => {
      expect(() => enforceUploadPolicy(POLICY, candidate({ expectedSize: 1024 }))).not.toThrow()
    })
  })
})
