// apps/web/src/components/file-upload/stores/__tests__/server-id-kind.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUploadStore } from '../upload-store'

/**
 * `serverFileId` is parked with the UPLOAD SESSION nanoid at session-create time (it is what
 * SSE correlates on) and used to be overwritten only when the completion payload carried an
 * `assetId`. `FileProcessor` returns `{ fileId }` and no `assetId`, so for any entity type
 * served by it — which, before the registry stopped defaulting, included `visit_qc_item` —
 * `serverFileId` stayed the session nanoid and was then reported to callers as
 * `metadata.assetId` (docs/files-upload-architecture-guide.md §11.3).
 *
 * So: derive `serverFileId` from `assetId ?? fileId`, and record WHICH kind it is.
 */

vi.mock('../../utils/direct-upload', () => ({
  directUpload: () => ({
    abort: () => {},
    promise: Promise.resolve({ etag: 'etag-1' }),
  }),
}))

const SESSION_NANOID = 'ses_nanoid_from_server'

/** Stub the two endpoints `startUpload` hits, with `completion` as the /complete body. */
function stubFetch(completion: Record<string, unknown>) {
  const json = (body: unknown) =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response)

  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/complete')) return json(completion)
    return json({
      sessionId: SESSION_NANOID,
      uploadMethod: 'single',
      uploadType: 'PUT',
      presignedUrl: 'https://example.test/put',
      storageKey: 'org1/visit_qc_item/item1/photo.jpg',
    })
  })
}

async function uploadOne(completion: Record<string, unknown>) {
  const store = useUploadStore.getState()
  const sessionId = await store.createSession({
    entityType: 'visit_qc_item',
    entityId: 'qci_1',
  })
  const file = new File([new Uint8Array(4)], 'photo.jpg', { type: 'image/jpeg' })
  const [fileId] = useUploadStore.getState().addFiles([file], sessionId)
  if (!fileId) throw new Error('file was not added')

  vi.stubGlobal('fetch', stubFetch(completion))
  await useUploadStore.getState().startUpload()

  const state = useUploadStore.getState().files[fileId]
  if (!state) throw new Error('file state missing after upload')
  return state
}

describe('serverFileId derivation on upload completion', () => {
  beforeEach(() => {
    useUploadStore.getState().reset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses assetId and marks the id as an asset when the processor made a MediaAsset', async () => {
    const file = await uploadOne({ fileId: 'fil_1', assetId: 'ast_1', url: 'https://cdn/1' })

    expect(file.serverFileId).toBe('ast_1')
    expect(file.metadata?.serverIdKind).toBe('asset')
  })

  it('falls back to fileId and marks the id as a file when only a FolderFile was made', async () => {
    const file = await uploadOne({ fileId: 'fil_1' })

    expect(file.serverFileId).toBe('fil_1')
    // The load-bearing half: a FolderFile id must not be indistinguishable from an asset id.
    expect(file.metadata?.serverIdKind).toBe('file')
  })

  it('never reports the upload-session nanoid as an asset id', async () => {
    const file = await uploadOne({})

    // Nothing usable came back, so `serverFileId` is still the session nanoid — but it is
    // labelled as such, so no consumer can mistake it for a MediaAsset id.
    expect(file.serverFileId).toBe(SESSION_NANOID)
    expect(file.metadata?.serverIdKind).toBe('session')
  })
})
