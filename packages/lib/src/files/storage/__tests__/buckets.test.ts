// packages/lib/src/files/storage/__tests__/buckets.test.ts

/**
 * The pure half of the storage layer, tested the way this refactor says pure
 * code should be: **`vi.mock` is called zero times in this file.**
 *
 * These four functions used to be a method on `S3Adapter` and three exports in
 * `upload/util.ts`, reachable only by constructing an adapter or a
 * `StorageManager`. Everything below is a table over strings.
 *
 * The one ambient input is `configService`, which resolves `process.env` at
 * call time (not at import time), so {@link withConfig} sets the four keys per
 * case and restores them afterwards. That is deliberately not a mock: the real
 * resolution order — env, then the registry's own defaults — is part of what is
 * under test, and a `vi.mock('@auxx/credentials')` would assert against a
 * fiction. Every case sets every key it depends on, so an ambient `.env` on a
 * developer machine cannot change an outcome.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { assertBucket, bucketForVisibility, buildExternalUrl, publicCdnUrl } from '../buckets'

const CONFIG_KEYS = ['CDN_URL', 'S3_PUBLIC_BUCKET', 'S3_PRIVATE_BUCKET', 'S3_REGION'] as const
type ConfigKey = (typeof CONFIG_KEYS)[number]

const originals = new Map<ConfigKey, string | undefined>(
  CONFIG_KEYS.map((key) => [key, process.env[key]])
)

/** Set exactly the keys named; `undefined` unsets, falling back to the registry default. */
function withConfig(values: Partial<Record<ConfigKey, string | undefined>>): void {
  for (const key of CONFIG_KEYS) {
    const value = values[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

afterEach(() => {
  for (const [key, value] of originals) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('bucketForVisibility', () => {
  it.each([
    ['PUBLIC' as const, 'cfg-public'],
    ['PRIVATE' as const, 'cfg-private'],
  ])('routes %s to the configured bucket', (visibility, expected) => {
    withConfig({ S3_PUBLIC_BUCKET: 'cfg-public', S3_PRIVATE_BUCKET: 'cfg-private' })

    expect(bucketForVisibility(visibility)).toBe(expected)
  })

  it('never returns the private bucket for a PUBLIC object', () => {
    // The bug this union exists to prevent: `DatasetAssetProcessor` declared
    // lowercase `'private'`, which is neither branch, so it fell through to the
    // PUBLIC arm. A misspelling is now a compile error, and the two arms must
    // stay distinguishable at runtime too.
    withConfig({ S3_PUBLIC_BUCKET: 'cfg-public', S3_PRIVATE_BUCKET: 'cfg-private' })

    expect(bucketForVisibility('PUBLIC')).not.toBe(bucketForVisibility('PRIVATE'))
  })
})

describe('buildExternalUrl', () => {
  it('prefers CDN_URL over every bucket input', () => {
    withConfig({ CDN_URL: 'https://cdn.test', S3_PUBLIC_BUCKET: 'cfg-public' })

    expect(
      buildExternalUrl({
        provider: 'S3',
        key: 'org_1/a.png',
        bucket: 'explicit',
        region: 'eu-west-1',
      })
    ).toBe('https://cdn.test/org_1/a.png')
  })

  it.each([
    {
      name: 'explicit bucket wins over visibility',
      input: { bucket: 'explicit-bucket', visibility: 'PUBLIC' as const },
      expected: 'https://explicit-bucket.s3.eu-west-1.amazonaws.com/org_1/a.png',
    },
    {
      name: 'visibility picks the configured bucket when none is passed',
      input: { visibility: 'PRIVATE' as const },
      expected: 'https://cfg-private.s3.eu-west-1.amazonaws.com/org_1/a.png',
    },
    {
      name: 'falls back to the public bucket with neither',
      input: {},
      expected: 'https://cfg-public.s3.eu-west-1.amazonaws.com/org_1/a.png',
    },
  ])('$name', ({ input, expected }) => {
    withConfig({
      S3_PUBLIC_BUCKET: 'cfg-public',
      S3_PRIVATE_BUCKET: 'cfg-private',
      S3_REGION: 'eu-west-1',
    })

    expect(buildExternalUrl({ provider: 'S3', key: 'org_1/a.png', ...input })).toBe(expected)
  })

  it('lets the caller-supplied region win over S3_REGION', () => {
    // This is what keeps the function synchronous: the caller has already read
    // the StorageLocation row, so the port never has to fetch a credential to
    // learn a region while a write transaction is open.
    withConfig({ S3_PUBLIC_BUCKET: 'cfg-public', S3_REGION: 'eu-west-1' })

    expect(buildExternalUrl({ provider: 'S3', key: 'a.png', region: 'ap-south-1' })).toBe(
      'https://cfg-public.s3.ap-south-1.amazonaws.com/a.png'
    )
  })

  it('returns the bare key for a provider that is not bucket-addressed', () => {
    withConfig({ S3_PUBLIC_BUCKET: 'cfg-public', S3_REGION: 'eu-west-1' })

    expect(buildExternalUrl({ provider: 'DROPBOX', key: 'org_1/a.png' })).toBe('org_1/a.png')
  })

  it('is synchronous', () => {
    withConfig({ CDN_URL: 'https://cdn.test' })

    // Not `await`-ed anywhere: a Promise here would mean the upload-complete
    // route could hold its transaction open on I/O. See `StoragePort`.
    const url: string = buildExternalUrl({ provider: 'S3', key: 'a.png' })
    expect(url).toBe('https://cdn.test/a.png')
    expect(url).not.toBeInstanceOf(Promise)
  })
})

describe('publicCdnUrl', () => {
  it('uses CDN_URL when configured', () => {
    withConfig({ CDN_URL: 'https://cdn.test' })

    expect(publicCdnUrl('org_1/a.png')).toBe('https://cdn.test/org_1/a.png')
  })

  it('falls back to the public bucket, never the private one', () => {
    withConfig({
      S3_PUBLIC_BUCKET: 'cfg-public',
      S3_PRIVATE_BUCKET: 'cfg-private',
      S3_REGION: 'eu-west-1',
    })

    expect(publicCdnUrl('org_1/a.png')).toBe(
      'https://cfg-public.s3.eu-west-1.amazonaws.com/org_1/a.png'
    )
  })
})

describe('assertBucket', () => {
  it('returns the bucket when there is one', () => {
    expect(assertBucket('some-bucket', 'S3 putObject')).toBe('some-bucket')
  })

  it.each([[undefined], ['']])('throws a 400 naming the operation for %p', (bucket) => {
    // The whole point: no configured default is substituted. S3 answers 204 for
    // a delete of a key that is not in the bucket you named, so a fallback here
    // is a silent object leak (#1816/#1817/#1818).
    try {
      assertBucket(bucket, 'S3 deleteFile')
      expect.unreachable('assertBucket must throw without a bucket')
    } catch (error) {
      expect((error as { statusCode: number }).statusCode).toBe(400)
      expect((error as Error).message).toContain('S3 deleteFile')
    }
  })
})
