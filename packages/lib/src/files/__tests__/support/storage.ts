// packages/lib/src/files/__tests__/support/storage.ts

/**
 * A recording {@link StoragePort} double — the replacement for
 * `vi.mock('../storage/storage-manager')`.
 *
 * Everything here is typed *against the real port* rather than restated, so a
 * change to `StoragePort` breaks this file at compile time instead of letting a
 * test keep asserting a signature production no longer has.
 */

import { Readable } from 'node:stream'
import type { StoragePort } from '../../storage/ports'
import type { Journal } from './db'
import { makeJournal } from './db'

/** One recorded port call, in journal order. */
export interface StorageCall<K extends keyof StoragePort = keyof StoragePort> {
  method: K
  params: Parameters<StoragePort[K]>[0]
}

/**
 * Canned return values, keyed by method and typed from the port itself.
 *
 * `Awaited<ReturnType<...>>` means a test writes the real result shape — an
 * invented one will not compile.
 */
export type StorageResults = Partial<{
  [K in keyof StoragePort]: Awaited<ReturnType<StoragePort[K]>>
}>

export interface MakeStoragePortOptions {
  /** Share ordering with `makeDb` and the other doubles. */
  journal?: Journal
  /** What each method returns. Anything omitted returns a benign default. */
  results?: StorageResults
  /** Full per-method override, for tests that need to throw or vary per call. */
  impl?: Partial<StoragePort>
}

export interface FakeStoragePort {
  /** Pass this as `FilesDeps.storage`. */
  port: StoragePort
  calls: StorageCall[]
  journal: Journal
  /** Calls to one method, narrowed so `params` is that method's parameter type. */
  callsTo<K extends keyof StoragePort>(method: K): Array<StorageCall<K>>
}

const EXPIRES = new Date('2026-01-01T01:00:00.000Z')

/**
 * Benign defaults, built fresh per call so a stream default is never consumed
 * twice across two calls in one test.
 */
const DEFAULTS: { [K in keyof StoragePort]: () => Awaited<ReturnType<StoragePort[K]>> } = {
  presignUpload: () => ({ url: 'https://s3.test/upload', method: 'PUT', expiresAt: EXPIRES }),
  startMultipart: () => ({ uploadId: 'upload-1', expiresAt: EXPIRES }),
  presignPart: () => ({ url: 'https://s3.test/part', method: 'PUT', expiresAt: EXPIRES }),
  completeMultipart: () => ({ etag: 'etag-complete', size: 1024 }),
  head: () => ({ name: 'file.bin', size: 1024, mimeType: 'application/octet-stream' }),
  putObject: () => ({ etag: 'etag-put', size: 1024 }),
  getObject: () => Buffer.from('fake-object-body'),
  streamObject: () => Readable.from([Buffer.from('fake-object-body')]),
  deleteObject: () => undefined,
  presignDownload: () => ({ type: 'url', url: 'https://s3.test/download', expiresAt: EXPIRES }),
  buildExternalUrl: () => 'https://cdn.test/object',
}

/**
 * Build a storage double that records every call and returns whatever the test
 * queued for that method.
 *
 * `buildExternalUrl` stays synchronous here too — a double that returned a
 * promise would let code under test `await` something production cannot, and
 * the sync signature is what keeps I/O out of an open transaction.
 */
export function makeStoragePort(options: MakeStoragePortOptions = {}): FakeStoragePort {
  const journal = options.journal ?? makeJournal()
  const calls: StorageCall[] = []

  function record<K extends keyof StoragePort>(method: K, params: unknown) {
    journal.record('storage', method, { params: params as Record<string, unknown> })
    calls.push({ method, params: params as Parameters<StoragePort[K]>[0] })
  }

  function resultFor<K extends keyof StoragePort>(method: K): Awaited<ReturnType<StoragePort[K]>> {
    const queued = options.results?.[method]
    return (queued === undefined ? DEFAULTS[method]() : queued) as Awaited<
      ReturnType<StoragePort[K]>
    >
  }

  const port: StoragePort = {
    presignUpload: async (p) => {
      record('presignUpload', p)
      return options.impl?.presignUpload?.(p) ?? resultFor('presignUpload')
    },
    startMultipart: async (p) => {
      record('startMultipart', p)
      return options.impl?.startMultipart?.(p) ?? resultFor('startMultipart')
    },
    presignPart: async (p) => {
      record('presignPart', p)
      return options.impl?.presignPart?.(p) ?? resultFor('presignPart')
    },
    completeMultipart: async (p) => {
      record('completeMultipart', p)
      return options.impl?.completeMultipart?.(p) ?? resultFor('completeMultipart')
    },
    head: async (p) => {
      record('head', p)
      return options.impl?.head?.(p) ?? resultFor('head')
    },
    putObject: async (p) => {
      record('putObject', p)
      return options.impl?.putObject?.(p) ?? resultFor('putObject')
    },
    getObject: async (p) => {
      record('getObject', p)
      return options.impl?.getObject?.(p) ?? resultFor('getObject')
    },
    streamObject: async (p) => {
      record('streamObject', p)
      return options.impl?.streamObject?.(p) ?? resultFor('streamObject')
    },
    deleteObject: async (p) => {
      record('deleteObject', p)
      await options.impl?.deleteObject?.(p)
    },
    presignDownload: async (p) => {
      record('presignDownload', p)
      return options.impl?.presignDownload?.(p) ?? resultFor('presignDownload')
    },
    buildExternalUrl: (p) => {
      record('buildExternalUrl', p)
      return options.impl?.buildExternalUrl?.(p) ?? resultFor('buildExternalUrl')
    },
  }

  return {
    port,
    calls,
    journal,
    callsTo: <K extends keyof StoragePort>(method: K) =>
      calls.filter((c): c is StorageCall<K> => c.method === method),
  }
}
