// packages/lib/src/email/inbound/__tests__/attachment-ingest.service.test.ts

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AttachmentIngestContext, AttachmentIngestInput } from '../ingest-types'
import { deriveAttachmentId } from '../object-keys'

const mocks = vi.hoisted(() => {
  return {
    uploadContent: vi.fn(),
    createAssetWithVersion: vi.fn(),
    createAttachment: vi.fn(),
  }
})

vi.mock('../../../files/storage/storage-manager', () => ({
  createStorageManager: () => ({
    uploadContent: mocks.uploadContent,
  }),
}))

// The `files/` functions are stubbed at their own module boundary rather than
// through a `vi.mock('@auxx/database')` — the service now takes its `db` as a
// constructor argument, so the fake below is the only database this file needs.
vi.mock('../../../files/assets', () => ({
  createAssetWithVersion: mocks.createAssetWithVersion,
}))

vi.mock('../../../files/attachments', () => ({
  createAttachment: mocks.createAttachment,
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

  const db: Record<string, unknown> = {
    select: vi.fn().mockImplementation(() => makeSelectChain(selectResults[selectIdx++] ?? [])),
    delete: vi.fn().mockImplementation(() => makeDeleteChain()),
  }
  // The asset+version write now owns its transaction boundary, so the fake db
  // has to be able to open one. Running the callback on the same object keeps
  // every select/delete assertion below counting the same calls.
  db.transaction = vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(db))
  return db as {
    select: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
    transaction: ReturnType<typeof vi.fn>
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
    mocks.createAssetWithVersion.mockReset()
    mocks.createAttachment.mockReset()

    mocks.uploadContent.mockResolvedValue({ id: 'sl_att_1' })
    mocks.createAssetWithVersion.mockResolvedValue(
      ok({ asset: { id: 'ma_1' }, version: { id: 'mav_1' } })
    )
    mocks.createAttachment.mockResolvedValue(ok({ id: 'att_1' }))
  })

  /** The `input` argument of `createAssetWithVersion(tx, ctx, deps, input)`. */
  const assetInput = () => mocks.createAssetWithVersion.mock.calls[0]?.[3]

  /** The `ctx` argument of `createAssetWithVersion(tx, ctx, deps, input)`. */
  const assetCtx = () => mocks.createAssetWithVersion.mock.calls[0]?.[1]

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

    expect(mocks.createAttachment).toHaveBeenCalledWith(
      { db: mockDb, organizationId: 'org_abc' },
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

    expect(mocks.createAttachment).toHaveBeenCalledWith(
      { db: mockDb, organizationId: 'org_abc' },
      expect.objectContaining({ role: 'INLINE' })
    )
  })

  it('creates Attachment with correct role for non-inline attachments', async () => {
    const mockDb = buildMockDb([[], []])
    const service = new InboundAttachmentIngestService(mockDb as never)

    await service.ingestAll([makeAttachment({ inline: false, contentId: null })], baseContext)

    expect(mocks.createAttachment).toHaveBeenCalledWith(
      { db: mockDb, organizationId: 'org_abc' },
      expect.objectContaining({ role: 'ATTACHMENT' })
    )
  })

  it('stores contentId on Attachment for inline parts', async () => {
    const mockDb = buildMockDb([[], []])
    const service = new InboundAttachmentIngestService(mockDb as never)

    await service.ingestAll([makeAttachment({ contentId: 'img001@mail.example.com' })], baseContext)

    expect(mocks.createAttachment).toHaveBeenCalledWith(
      { db: mockDb, organizationId: 'org_abc' },
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

  it('creates MediaAsset + MediaAssetVersion via createAssetWithVersion', async () => {
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

    expect(assetInput()).toEqual(
      expect.objectContaining({
        kind: 'EMAIL_ATTACHMENT',
        purpose: 'email-attachment',
        name: 'doc.pdf',
        mimeType: 'application/pdf',
        // MediaAsset.size is bigint({ mode: 'number' }), so Drizzle wants a JS
        // number here — the old BigInt() assertion encoded the wrong contract.
        size: content.length,
        isPrivate: true,
        // `organizationId` is no longer part of the payload: scope travels in
        // `ctx`, so a caller can no longer name a foreign organization.
        storageLocationId: 'sl_att_1',
      })
    )
    expect(assetCtx()).toEqual({ db: mockDb, organizationId: 'org_abc' })
  })

  it('sets purpose to inline-email-image for inline attachments', async () => {
    const mockDb = buildMockDb([[], []])
    const service = new InboundAttachmentIngestService(mockDb as never)

    await service.ingestAll([makeAttachment({ inline: true })], baseContext)

    expect(assetInput()).toEqual(
      expect.objectContaining({ purpose: 'inline-email-image', storageLocationId: 'sl_att_1' })
    )
  })

  it('pins assetId and assetVersionId on the Attachment record', async () => {
    mocks.createAssetWithVersion.mockResolvedValue(
      ok({ asset: { id: 'ma_pinned' }, version: { id: 'mav_pinned' } })
    )

    const mockDb = buildMockDb([[], []])
    const service = new InboundAttachmentIngestService(mockDb as never)

    await service.ingestAll([makeAttachment()], baseContext)

    expect(mocks.createAttachment).toHaveBeenCalledWith(
      { db: mockDb, organizationId: 'org_abc' },
      expect.objectContaining({
        assetId: 'ma_pinned',
        assetVersionId: 'mav_pinned',
      })
    )
  })

  it('returns correct StoredAttachmentMeta for each ingested attachment', async () => {
    mocks.createAssetWithVersion.mockResolvedValue(
      ok({ asset: { id: 'ma_result' }, version: { id: 'mav_result' } })
    )

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
    expect(mocks.createAssetWithVersion).not.toHaveBeenCalled()
    expect(mocks.createAttachment).not.toHaveBeenCalled()
    expect(results).toHaveLength(1)
    expect(results[0]!.attachmentId).toBe(existingId)
  })

  it('processes multiple attachments in order', async () => {
    // 2 duplicate checks (empty) + reconciliation
    const mockDb = buildMockDb([[], [], []])
    const service = new InboundAttachmentIngestService(mockDb as never)

    mocks.createAssetWithVersion
      .mockResolvedValueOnce(ok({ asset: { id: 'ma_0' }, version: { id: 'mav_0' } }))
      .mockResolvedValueOnce(ok({ asset: { id: 'ma_1' }, version: { id: 'mav_1' } }))

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

  it('skips reconciliation when skipReconciliation: true is passed', async () => {
    // Only 1 duplicate check (empty), NO reconciliation select expected
    const mockDb = buildMockDb([[]])
    const service = new InboundAttachmentIngestService(mockDb as never)

    await service.ingestAll([makeAttachment()], baseContext, { skipReconciliation: true })

    // Upload + createAssetWithVersion + createAttachment should still be called
    expect(mocks.uploadContent).toHaveBeenCalledOnce()
    expect(mocks.createAssetWithVersion).toHaveBeenCalledOnce()
    expect(mocks.createAttachment).toHaveBeenCalledOnce()

    // Only 1 select call (the duplicate check), no reconciliation select
    expect(mockDb.select).toHaveBeenCalledTimes(1)
    expect(mockDb.delete).not.toHaveBeenCalled()
  })

  it('runs reconciliation by default (skipReconciliation not set)', async () => {
    // 1 duplicate check (empty) + 1 reconciliation select
    const mockDb = buildMockDb([[], []])
    const service = new InboundAttachmentIngestService(mockDb as never)

    await service.ingestAll([makeAttachment()], baseContext)

    // 2 select calls: duplicate check + reconciliation
    expect(mockDb.select).toHaveBeenCalledTimes(2)
  })
})
