// packages/lib/src/email/inbound/__tests__/attachment-ingest.service.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AttachmentIngestContext, AttachmentIngestInput } from '../ingest-types'
import { deriveAttachmentId } from '../object-keys'

const mocks = vi.hoisted(() => {
  return {
    uploadContent: vi.fn(),
    createWithVersion: vi.fn(),
    attachmentCreate: vi.fn(),
  }
})

vi.mock('../../../files/storage/storage-manager', () => ({
  createStorageManager: () => ({
    uploadContent: mocks.uploadContent,
  }),
}))

vi.mock('../../../files/core/media-asset-service', () => ({
  createMediaAssetService: () => ({
    createWithVersion: mocks.createWithVersion,
  }),
}))

vi.mock('../../../files/core/attachment-service', () => ({
  createAttachmentService: () => ({
    create: mocks.attachmentCreate,
  }),
}))

/**
 * Builds a chainable Drizzle-like mock DB.
 * Each call to select() or delete() consumes the next entry from the provided arrays.
 */
function buildMockDb(selectResults: unknown[][] = [[]], deleteResults: unknown[] = []) {
  let selectIdx = 0
  let deleteIdx = 0

  function makeSelectChain(rows: unknown[]) {
    const thenable = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      then: (resolve: (v: unknown) => void) => resolve(rows),
    }
    return thenable
  }

  function makeDeleteChain() {
    const thenable = {
      where: vi.fn().mockReturnThis(),
      then: (resolve: (v: unknown) => void) => resolve(deleteResults[deleteIdx++]),
    }
    return thenable
  }

  return {
    select: vi.fn().mockImplementation(() => makeSelectChain(selectResults[selectIdx++] ?? [])),
    delete: vi.fn().mockImplementation(() => makeDeleteChain()),
  }
}

import { InboundAttachmentIngestService } from '../attachment-ingest.service'

const baseContext: AttachmentIngestContext = {
  organizationId: 'org_abc',
  messageId: 'msg_123',
  contentScopeId: 'ses-msg-456',
  createdById: 'user_1',
}

function makeAttachment(overrides: Partial<AttachmentIngestInput> = {}): AttachmentIngestInput {
  return {
    content: Buffer.from('fake-image-data'),
    filename: 'image.png',
    mimeType: 'image/png',
    inline: true,
    contentId: 'image001@example.com',
    attachmentOrder: 0,
    ...overrides,
  }
}

describe('InboundAttachmentIngestService', () => {
  beforeEach(() => {
    mocks.uploadContent.mockReset()
    mocks.createWithVersion.mockReset()
    mocks.attachmentCreate.mockReset()

    mocks.uploadContent.mockResolvedValue({ id: 'sl_att_1' })
    mocks.createWithVersion.mockResolvedValue({
      asset: { id: 'ma_1' },
      version: { id: 'mav_1' },
    })
    mocks.attachmentCreate.mockResolvedValue({ id: 'att_1' })
  })

  it('returns empty array when no attachments are provided', async () => {
    const mockDb = buildMockDb()
    const service = new InboundAttachmentIngestService(mockDb as never)

    const result = await service.ingestAll([], baseContext)

    expect(result).toEqual([])
    expect(mocks.uploadContent).not.toHaveBeenCalled()
  })

  it('uses caller-supplied deterministic ID from deriveAttachmentId', async () => {
    // select 1: duplicate check (empty = not found), select 2: reconciliation
    const mockDb = buildMockDb([[], []])
    const service = new InboundAttachmentIngestService(mockDb as never)

    const input = makeAttachment({ filename: 'photo.jpg', attachmentOrder: 0 })
    const expectedId = deriveAttachmentId('ses-msg-456', 0, 'photo.jpg')

    await service.ingestAll([input], baseContext)

    expect(mocks.attachmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expectedId,
        entityType: 'MESSAGE',
        entityId: 'msg_123',
      })
    )
  })

  it('creates Attachment with correct role for inline attachments', async () => {
    const mockDb = buildMockDb([[], []])
    const service = new InboundAttachmentIngestService(mockDb as never)

    await service.ingestAll([makeAttachment({ inline: true })], baseContext)

    expect(mocks.attachmentCreate).toHaveBeenCalledWith(expect.objectContaining({ role: 'INLINE' }))
  })

  it('creates Attachment with correct role for non-inline attachments', async () => {
    const mockDb = buildMockDb([[], []])
    const service = new InboundAttachmentIngestService(mockDb as never)

    await service.ingestAll([makeAttachment({ inline: false, contentId: null })], baseContext)

    expect(mocks.attachmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'ATTACHMENT' })
    )
  })

  it('stores contentId on Attachment for inline parts', async () => {
    const mockDb = buildMockDb([[], []])
    const service = new InboundAttachmentIngestService(mockDb as never)

    await service.ingestAll([makeAttachment({ contentId: 'img001@mail.example.com' })], baseContext)

    expect(mocks.attachmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ contentId: 'img001@mail.example.com' })
    )
  })

  it('uploads attachment bytes to object storage with PRIVATE visibility', async () => {
    const mockDb = buildMockDb([[], []])
    const service = new InboundAttachmentIngestService(mockDb as never)

    const content = Buffer.from('png-bytes')
    await service.ingestAll([makeAttachment({ content, mimeType: 'image/png' })], baseContext)

    expect(mocks.uploadContent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'S3',
        content,
        mimeType: 'image/png',
        size: content.length,
        visibility: 'PRIVATE',
        organizationId: 'org_abc',
      })
    )
  })

  it('creates MediaAsset + MediaAssetVersion via createWithVersion', async () => {
    const mockDb = buildMockDb([[], []])
    const service = new InboundAttachmentIngestService(mockDb as never)

    const content = Buffer.from('file-bytes')
    await service.ingestAll(
      [
        makeAttachment({
          content,
          filename: 'doc.pdf',
          mimeType: 'application/pdf',
          inline: false,
          contentId: null,
        }),
      ],
      baseContext
    )

    expect(mocks.createWithVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'EMAIL_ATTACHMENT',
        purpose: 'email-attachment',
        name: 'doc.pdf',
        mimeType: 'application/pdf',
        size: BigInt(content.length),
        isPrivate: true,
        organizationId: 'org_abc',
      }),
      'sl_att_1'
    )
  })

  it('sets purpose to inline-email-image for inline attachments', async () => {
    const mockDb = buildMockDb([[], []])
    const service = new InboundAttachmentIngestService(mockDb as never)

    await service.ingestAll([makeAttachment({ inline: true })], baseContext)

    expect(mocks.createWithVersion).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'inline-email-image' }),
      expect.any(String)
    )
  })

  it('pins assetId and assetVersionId on the Attachment record', async () => {
    mocks.createWithVersion.mockResolvedValue({
      asset: { id: 'ma_pinned' },
      version: { id: 'mav_pinned' },
    })

    const mockDb = buildMockDb([[], []])
    const service = new InboundAttachmentIngestService(mockDb as never)

    await service.ingestAll([makeAttachment()], baseContext)

    expect(mocks.attachmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: 'ma_pinned',
        assetVersionId: 'mav_pinned',
      })
    )
  })

  it('returns correct StoredAttachmentMeta for each ingested attachment', async () => {
    mocks.createWithVersion.mockResolvedValue({
      asset: { id: 'ma_result' },
      version: { id: 'mav_result' },
    })

    const mockDb = buildMockDb([[], []])
    const service = new InboundAttachmentIngestService(mockDb as never)

    const content = Buffer.from('some-data')
    const results = await service.ingestAll(
      [
        makeAttachment({
          content,
          filename: 'photo.jpg',
          mimeType: 'image/jpeg',
          inline: false,
          contentId: null,
          attachmentOrder: 2,
        }),
      ],
      baseContext
    )

    expect(results).toHaveLength(1)
    expect(results[0]).toEqual({
      attachmentId: deriveAttachmentId('ses-msg-456', 2, 'photo.jpg'),
      assetId: 'ma_result',
      assetVersionId: 'mav_result',
      filename: 'photo.jpg',
      mimeType: 'image/jpeg',
      size: content.length,
      inline: false,
      contentId: null,
      attachmentOrder: 2,
    })
  })

  it('skips upload for already-existing attachment (idempotency)', async () => {
    const existingId = deriveAttachmentId('ses-msg-456', 0, 'image.png')

    // select 1: duplicate check (found), select 2: load existing metadata, select 3: reconciliation
    const mockDb = buildMockDb([
      [{ id: existingId }],
      [{ assetId: 'ma_existing', assetVersionId: 'mav_existing' }],
      [{ id: existingId, role: 'INLINE' }],
    ])
    const service = new InboundAttachmentIngestService(mockDb as never)

    const results = await service.ingestAll([makeAttachment()], baseContext)

    expect(mocks.uploadContent).not.toHaveBeenCalled()
    expect(mocks.createWithVersion).not.toHaveBeenCalled()
    expect(mocks.attachmentCreate).not.toHaveBeenCalled()
    expect(results).toHaveLength(1)
    expect(results[0]!.attachmentId).toBe(existingId)
  })

  it('processes multiple attachments in order', async () => {
    // 2 duplicate checks (empty) + reconciliation
    const mockDb = buildMockDb([[], [], []])
    const service = new InboundAttachmentIngestService(mockDb as never)

    mocks.createWithVersion
      .mockResolvedValueOnce({ asset: { id: 'ma_0' }, version: { id: 'mav_0' } })
      .mockResolvedValueOnce({ asset: { id: 'ma_1' }, version: { id: 'mav_1' } })

    const results = await service.ingestAll(
      [
        makeAttachment({ filename: 'a.png', attachmentOrder: 0 }),
        makeAttachment({ filename: 'b.pdf', attachmentOrder: 1, inline: false, contentId: null }),
      ],
      baseContext
    )

    expect(results).toHaveLength(2)
    expect(results[0]!.attachmentId).toBe(deriveAttachmentId('ses-msg-456', 0, 'a.png'))
    expect(results[1]!.attachmentId).toBe(deriveAttachmentId('ses-msg-456', 1, 'b.pdf'))
  })
})
