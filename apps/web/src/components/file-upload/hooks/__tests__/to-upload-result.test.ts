// apps/web/src/components/file-upload/hooks/__tests__/to-upload-result.test.ts

import { describe, expect, it } from 'vitest'
import type { FileState } from '../../stores'
import { toUploadResult } from '../use-file-upload'

/**
 * `useFileUpload` used to report `metadata: { assetId: f.serverFileId || f.id }` unconditionally,
 * so a `FolderFile` id — and, worse, the upload-session nanoid parked in `serverFileId` at
 * session-create time — was handed to callers as a `MediaAsset` id. `qc-photo-strip` then fed it
 * to `AttachmentService.create({ assetId })` and produced zero attachments, silently
 * (docs/files-upload-architecture-guide.md §11.3).
 *
 * `toUploadResult` must gate `assetId` on the `serverIdKind` the store records.
 */
function fileState(overrides: Partial<FileState>): FileState {
  return {
    id: 'tmp_client_id',
    tempFileId: 'tmp_client_id',
    name: 'photo.jpg',
    type: 'file',
    displaySize: 1024,
    size: 1024,
    mimeType: 'image/jpeg',
    createdAt: new Date(),
    updatedAt: new Date(),
    path: '/',
    status: 'completed',
    isUploading: true,
    stages: [],
    ...overrides,
  } as FileState
}

describe('toUploadResult', () => {
  it('reports assetId when the server actually created a MediaAsset', () => {
    const result = toUploadResult(
      fileState({ serverFileId: 'ast_1', metadata: { serverIdKind: 'asset' } })
    )

    expect(result.metadata?.assetId).toBe('ast_1')
    expect(result.metadata?.fileId).toBeUndefined()
    expect(result.metadata?.serverIdKind).toBe('asset')
  })

  it('does NOT report an assetId when the server response carried only a fileId', () => {
    const result = toUploadResult(
      fileState({ serverFileId: 'fil_1', metadata: { serverIdKind: 'file' } })
    )

    // The load-bearing assertion: a FolderFile id must never masquerade as a MediaAsset id.
    expect(result.metadata?.assetId).toBeUndefined()
    // …but it is not discarded either — it is surfaced under its own name.
    expect(result.metadata?.fileId).toBe('fil_1')
    expect(result.metadata?.serverIdKind).toBe('file')
  })

  it('does NOT report the upload-session nanoid as an assetId or a fileId', () => {
    const result = toUploadResult(
      fileState({ serverFileId: 'ses_nanoid', metadata: { serverIdKind: 'session' } })
    )

    expect(result.metadata?.assetId).toBeUndefined()
    expect(result.metadata?.fileId).toBeUndefined()
    expect(result.metadata?.serverIdKind).toBe('session')
  })

  it('reports no record id at all when the store recorded no kind', () => {
    const result = toUploadResult(fileState({ serverFileId: 'whatever' }))

    expect(result.metadata?.assetId).toBeUndefined()
    expect(result.metadata?.fileId).toBeUndefined()
    expect(result.metadata?.serverIdKind).toBeUndefined()
  })

  it('never falls back to the client-side temp id', () => {
    const result = toUploadResult(fileState({ id: 'tmp_client_id', serverFileId: undefined }))

    expect(result.metadata?.assetId).toBeUndefined()
    // The client id is still reported, but under `fileId` on the result itself — where it has
    // always been a client id — not as a server record id inside `metadata`.
    expect(result.fileId).toBe('tmp_client_id')
  })

  it('carries the plain result fields through unchanged', () => {
    const result = toUploadResult(
      fileState({ status: 'failed', error: 'boom', url: 'https://cdn/1' })
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('boom')
    expect(result.filename).toBe('photo.jpg')
    expect(result.url).toBe('https://cdn/1')
    expect(result.size).toBe(1024)
    expect(result.mimeType).toBe('image/jpeg')
  })
})
