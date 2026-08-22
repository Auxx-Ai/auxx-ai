// packages/lib/src/files/storage/__tests__/objects.test.ts

/**
 * `storage/objects.ts` against a fake {@link StoragePort}. **Zero `vi.mock`.**
 *
 * These five functions are thin by design, so the assertions are about the two
 * things that are not thin: the bucket reaching the port unchanged (the
 * #1816/#1817/#1818 family of bugs), and the error mapping that keeps a
 * not-found from arriving at a caller as "Internal error".
 */

import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { makeStoragePort, TEST_BUCKETS, TEST_IDS } from '../../__tests__/support'
import {
  StorageAdapterError,
  StorageAuthError,
  StorageFileNotFoundError,
} from '../../adapters/base-adapter'
import { deleteObject, getObject, headObject, putObject, streamObject } from '../objects'

const KEY = `${TEST_IDS.organizationId}/media-asset/ast_test/test-image.png`

describe('putObject', () => {
  it('forwards content, bucket and metadata, and returns what the provider reported', async () => {
    const storage = makeStoragePort({ results: { putObject: { etag: 'e1', size: 4 } } })

    const result = await putObject(storage.port, {
      provider: 'S3',
      bucket: TEST_BUCKETS.public,
      key: KEY,
      content: Buffer.from('test'),
      mimeType: 'image/png',
      size: 4,
      metadata: { organizationId: TEST_IDS.organizationId },
    })

    expect(result._unsafeUnwrap()).toEqual({ etag: 'e1', size: 4 })
    const params = storage.callsTo('putObject')[0]?.params
    expect(params?.bucket).toBe(TEST_BUCKETS.public)
    expect(params?.metadata).toEqual({ organizationId: TEST_IDS.organizationId })
  })

  it('passes a stream body through untouched', async () => {
    const storage = makeStoragePort()
    const body = Readable.from([Buffer.from('chunk')])

    await putObject(storage.port, {
      provider: 'S3',
      bucket: TEST_BUCKETS.private,
      key: KEY,
      content: body,
    })

    expect(storage.callsTo('putObject')[0]?.params.content).toBe(body)
  })
})

describe('getObject', () => {
  it('returns the buffer the port produced', async () => {
    const storage = makeStoragePort({ results: { getObject: Buffer.from('hello') } })

    const result = await getObject(storage.port, {
      provider: 'S3',
      bucket: TEST_BUCKETS.private,
      key: KEY,
    })

    expect(result._unsafeUnwrap().toString()).toBe('hello')
  })

  it('forwards versionId when the caller targets one', async () => {
    const storage = makeStoragePort()

    await getObject(storage.port, {
      provider: 'S3',
      bucket: TEST_BUCKETS.private,
      key: KEY,
      versionId: 'v2',
    })

    expect(storage.callsTo('getObject')[0]?.params.versionId).toBe('v2')
  })

  it('maps a missing object to NotFoundError rather than a generic 500', async () => {
    const storage = makeStoragePort({
      impl: {
        getObject: () => {
          throw new StorageFileNotFoundError('S3', KEY)
        },
      },
    })

    const error = (
      await getObject(storage.port, { provider: 'S3', bucket: TEST_BUCKETS.private, key: KEY })
    )._unsafeUnwrapErr()

    expect(error.statusCode).toBe(404)
    expect(error.message).toBe(`File not found: ${KEY}`)
  })
})

describe('streamObject', () => {
  it('returns the stream unbuffered', async () => {
    const stream = Readable.from([Buffer.from('a'), Buffer.from('b')])
    const storage = makeStoragePort({ results: { streamObject: stream } })

    const result = await streamObject(storage.port, {
      provider: 'S3',
      bucket: TEST_BUCKETS.private,
      key: KEY,
    })

    expect(result._unsafeUnwrap()).toBe(stream)
  })

  it('maps an auth failure to UnauthorizedError', async () => {
    const storage = makeStoragePort({
      impl: {
        streamObject: () => {
          throw new StorageAuthError('S3', 'openDownloadStream')
        },
      },
    })

    const error = (
      await streamObject(storage.port, { provider: 'S3', bucket: TEST_BUCKETS.private, key: KEY })
    )._unsafeUnwrapErr()

    expect(error.statusCode).toBe(401)
  })
})

describe('headObject', () => {
  it('returns provider metadata verbatim', async () => {
    const storage = makeStoragePort({
      results: {
        head: { name: 'test-image.png', size: 4096, mimeType: 'image/png', etagOrRev: 'e9' },
      },
    })

    const result = await headObject(storage.port, {
      provider: 'S3',
      bucket: TEST_BUCKETS.public,
      key: KEY,
    })

    expect(result._unsafeUnwrap()).toEqual({
      name: 'test-image.png',
      size: 4096,
      mimeType: 'image/png',
      etagOrRev: 'e9',
    })
  })

  it('heads the bucket it was given, not a configured default', async () => {
    const storage = makeStoragePort()

    await headObject(storage.port, { provider: 'S3', bucket: TEST_BUCKETS.public, key: KEY })

    expect(storage.callsTo('head')[0]?.params.bucket).toBe(TEST_BUCKETS.public)
  })
})

describe('deleteObject', () => {
  it('deletes from the bucket it was given', async () => {
    const storage = makeStoragePort()

    const result = await deleteObject(storage.port, {
      provider: 'S3',
      bucket: TEST_BUCKETS.public,
      key: KEY,
      credentialId: TEST_IDS.credentialId,
    })

    expect(result.isOk()).toBe(true)
    expect(storage.callsTo('deleteObject')[0]?.params).toEqual({
      provider: 'S3',
      bucket: TEST_BUCKETS.public,
      key: KEY,
      credentialId: TEST_IDS.credentialId,
    })
  })

  it('reports a refused delete instead of resolving quietly', async () => {
    // The adapter throws when the location cannot name a bucket, precisely so a
    // wrong-bucket delete cannot 204 its way to looking successful.
    const storage = makeStoragePort({
      impl: {
        deleteObject: () => {
          throw new StorageAdapterError(
            `Cannot delete S3 object '${KEY}': no bucket on the storage location.`,
            'S3',
            'deleteFile'
          )
        },
      },
    })

    const result = await deleteObject(storage.port, { provider: 'S3', bucket: '', key: KEY })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('no bucket on the storage location')
  })
})
