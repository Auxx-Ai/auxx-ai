// apps/web/src/components/file-upload/stores/__tests__/upload-transport.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { httpUploadTransport } from '../../transport'
import { createFakeUploadTransport } from '../../transport/__fixtures__/fake-upload-transport'
import { UploadTransportError } from '../../transport/upload-error'
import { useUploadStore } from '../upload-store'

/**
 * What the transport seam buys: these assertions are about the *orchestration*
 * — the concurrency pool, the per-file failure isolation, the status and error
 * bookkeeping — and none of them stubs `fetch` or matches a URL string.
 *
 * `fetch` is stubbed here only to *assert it is never called*.
 */

function addFiles(sessionId: string, names: string[]): string[] {
  const files = names.map((name) => new File([new Uint8Array(4)], name, { type: 'image/jpeg' }))
  return useUploadStore.getState().addFiles(files, sessionId)
}

async function newSession() {
  return useUploadStore.getState().createSession({ entityType: 'FILE', entityId: 'fld_1' })
}

describe('startUpload over a substituted transport', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    useUploadStore.getState().reset()
    useUploadStore.getState().setTransport(httpUploadTransport)
    fetchSpy = vi.fn(() => Promise.reject(new Error('the uploader must not call fetch')))
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uploads every file without touching the network', async () => {
    const transport = createFakeUploadTransport()
    useUploadStore.getState().setTransport(transport)

    const sessionId = await newSession()
    const fileIds = addFiles(sessionId, ['a.jpg', 'b.jpg', 'c.jpg'])

    const result = await useUploadStore.getState().startUpload()

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.successCount).toBe(3)
    expect(result.failedCount).toBe(0)
    expect(transport.createdSessions().map((s) => s.fileName)).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
    // Every completion is addressed to the session id its own presign returned.
    expect(
      transport
        .completedSessions()
        .map((c) => c.sessionId)
        .sort()
    ).toEqual(['ses_1', 'ses_2', 'ses_3'])

    const files = useUploadStore.getState().files
    for (const id of fileIds) {
      expect(files[id]?.status).toBe('completed')
      expect(files[id]?.metadata?.serverIdKind).toBe('asset')
    }
    expect(useUploadStore.getState().uploading).toBe(false)
  })

  it('isolates a failure on file 3 of 5 — the other four still complete', async () => {
    const transport = createFakeUploadTransport({
      completeSession: async (sessionId, body) => {
        if (body.storageKey?.endsWith('c.jpg')) {
          throw new UploadTransportError('Uploaded object is not an image', {
            status: 422,
            code: 'VALIDATION_ERROR',
            errorType: 'validation',
            retryable: false,
          })
        }
        return { success: true, sessionId, assetId: `ast_${sessionId}` }
      },
    })
    useUploadStore.getState().setTransport(transport)
    // Two workers over five files: the pool has to keep going past the failure.
    useUploadStore.getState().updateConfig({ maxConcurrentUploads: 2 })

    const sessionId = await newSession()
    const fileIds = addFiles(sessionId, ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg'])

    const result = await useUploadStore.getState().startUpload()

    expect(result.successCount).toBe(4)
    expect(result.failedCount).toBe(1)

    const files = useUploadStore.getState().files
    const failed = fileIds.map((id) => files[id]).find((f) => f?.status === 'failed')
    expect(failed?.name).toBe('c.jpg')
    // The server's own prose, on the file and in the batch result — not a status code.
    expect(failed?.error).toBe('Uploaded object is not an image')
    expect(result.results.find((r) => r.filename === 'c.jpg')?.error).toBe(
      'Uploaded object is not an image'
    )

    const storeError = useUploadStore.getState().errors.at(-1)
    expect(storeError?.message).toBe('Uploaded object is not an image')
    expect(storeError?.code).toBe('VALIDATION_ERROR')
    expect(useUploadStore.getState().uploading).toBe(false)
  })

  it('reports the storage-limit prompt when the presign is refused', async () => {
    const transport = createFakeUploadTransport({
      createSession: async () => {
        throw new UploadTransportError(
          'You have reached your storage limit. Usage: 4.8GB/5GB. Upgrade your plan for more storage.',
          {
            status: 403,
            code: 'USAGE_LIMIT',
            retryable: false,
            details: { upgradeRequired: 'true' },
          }
        )
      },
    })
    useUploadStore.getState().setTransport(transport)

    const sessionId = await newSession()
    addFiles(sessionId, ['big.jpg'])

    const result = await useUploadStore.getState().startUpload()

    expect(result.failedCount).toBe(1)
    const storeError = useUploadStore.getState().errors.at(-1)
    expect(storeError?.message).toContain('Upgrade your plan for more storage')
    expect(storeError?.code).toBe('USAGE_LIMIT')
    expect(storeError?.details?.upgradeRequired).toBe('true')
    // Nothing was written, so nothing is completed.
    expect(transport.completedSessions()).toHaveLength(0)
  })

  it('records the abort handle so cancelUpload can stop an in-flight file', async () => {
    let settle: (() => void) | undefined
    const transport = createFakeUploadTransport({
      uploadObject: (params) => {
        const promise = new Promise<{ etag: string }>((_resolve, reject) => {
          settle = () => reject(new Error('Upload aborted'))
        })
        return { abort: () => settle?.(), promise }
      },
    })
    useUploadStore.getState().setTransport(transport)

    const sessionId = await newSession()
    const [fileId] = addFiles(sessionId, ['slow.jpg'])
    if (!fileId) throw new Error('file was not added')

    const uploading = useUploadStore.getState().startUpload()

    // Wait for the presign to resolve and the handle to be registered.
    await vi.waitFor(() => {
      expect(useUploadStore.getState().inFlight[fileId]).toBeDefined()
    })

    useUploadStore.getState().cancelUpload()
    await uploading

    expect(useUploadStore.getState().inFlight[fileId]).toBeUndefined()
    expect(transport.completedSessions()).toHaveLength(0)
  })

  it('survives a store reset — the transport is wiring, not work', async () => {
    const transport = createFakeUploadTransport()
    useUploadStore.getState().setTransport(transport)

    useUploadStore.getState().reset()

    expect(useUploadStore.getState().transport).toBe(transport)
  })
})
