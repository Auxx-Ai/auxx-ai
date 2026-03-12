// packages/lib/src/email/inbound/__tests__/body-ingest.service.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  return {
    uploadContent: vi.fn(),
  }
})

vi.mock('../../../files/storage/storage-manager', () => ({
  createStorageManager: () => ({
    uploadContent: mocks.uploadContent,
  }),
}))

import { InboundBodyIngestService } from '../body-ingest.service'

const baseContext = {
  organizationId: 'org_abc',
  contentScopeId: 'ses-msg-123',
}

describe('InboundBodyIngestService', () => {
  let service: InboundBodyIngestService

  beforeEach(() => {
    mocks.uploadContent.mockReset()
    service = new InboundBodyIngestService()
  })

  it('returns null storageLocationId when no HTML is present', async () => {
    const result = await service.ingestBody({ textHtml: null }, baseContext)

    expect(result).toEqual({ htmlBodyStorageLocationId: null })
    expect(mocks.uploadContent).not.toHaveBeenCalled()
  })

  it('returns null storageLocationId for empty string HTML', async () => {
    const result = await service.ingestBody({ textHtml: '' }, baseContext)

    expect(result).toEqual({ htmlBodyStorageLocationId: null })
    expect(mocks.uploadContent).not.toHaveBeenCalled()
  })

  it('returns null storageLocationId when textHtml is undefined', async () => {
    const result = await service.ingestBody({}, baseContext)

    expect(result).toEqual({ htmlBodyStorageLocationId: null })
    expect(mocks.uploadContent).not.toHaveBeenCalled()
  })

  it('uploads HTML body to object storage and returns storageLocationId', async () => {
    mocks.uploadContent.mockResolvedValue({ id: 'sl_body_456' })

    const result = await service.ingestBody({ textHtml: '<p>Hello world</p>' }, baseContext)

    expect(result).toEqual({ htmlBodyStorageLocationId: 'sl_body_456' })
    expect(mocks.uploadContent).toHaveBeenCalledOnce()
    expect(mocks.uploadContent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'S3',
        key: 'email/inbound/org_abc/ses-msg-123/body.html',
        mimeType: 'text/html; charset=utf-8',
        visibility: 'PRIVATE',
        organizationId: 'org_abc',
      })
    )
  })

  it('uploads content as UTF-8 buffer with correct size', async () => {
    const html = '<p>Héllo wörld</p>'
    const expectedBuffer = Buffer.from(html, 'utf-8')

    mocks.uploadContent.mockResolvedValue({ id: 'sl_body_789' })

    await service.ingestBody({ textHtml: html }, baseContext)

    const call = mocks.uploadContent.mock.calls[0]![0]
    expect(Buffer.isBuffer(call.content)).toBe(true)
    expect(call.content.toString('utf-8')).toBe(html)
    expect(call.size).toBe(expectedBuffer.length)
  })

  it('uses the correct object key from contentScopeId', async () => {
    mocks.uploadContent.mockResolvedValue({ id: 'sl_xxx' })

    await service.ingestBody(
      { textHtml: '<p>test</p>' },
      { organizationId: 'org_xyz', contentScopeId: 'gmail-msg-999' }
    )

    const call = mocks.uploadContent.mock.calls[0]![0]
    expect(call.key).toBe('email/inbound/org_xyz/gmail-msg-999/body.html')
  })
})
