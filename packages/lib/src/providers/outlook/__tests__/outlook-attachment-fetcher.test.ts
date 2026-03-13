// packages/lib/src/providers/outlook/__tests__/outlook-attachment-fetcher.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchOutlookAttachments,
  type GraphAttachment,
  type OutlookFetchContext,
} from '../outlook-attachment-fetcher'

function makeGraphClient(overrides: Record<string, any> = {}) {
  const apiMock = vi.fn()
  const client = {
    api: apiMock,
    ...overrides,
  }
  return { client: client as any, apiMock }
}

function makeFileAttachment(overrides: Partial<GraphAttachment> = {}): GraphAttachment {
  return {
    '@odata.type': '#microsoft.graph.fileAttachment',
    id: 'att_1',
    name: 'document.pdf',
    contentType: 'application/pdf',
    size: 5000,
    isInline: false,
    contentId: null,
    contentBytes: Buffer.from('pdf-content').toString('base64'),
    ...overrides,
  }
}

function makeItemAttachment(overrides: Partial<GraphAttachment> = {}): GraphAttachment {
  return {
    '@odata.type': '#microsoft.graph.itemAttachment',
    id: 'att_item_1',
    name: 'Meeting.ics',
    contentType: 'application/octet-stream',
    size: 1000,
    isInline: false,
    ...overrides,
  }
}

function makeReferenceAttachment(overrides: Partial<GraphAttachment> = {}): GraphAttachment {
  return {
    '@odata.type': '#microsoft.graph.referenceAttachment',
    id: 'att_ref_1',
    name: 'shared-doc.docx',
    contentType: 'application/octet-stream',
    size: 0,
    isInline: false,
    ...overrides,
  }
}

describe('fetchOutlookAttachments', () => {
  let context: OutlookFetchContext

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('decodes FileAttachment with contentBytes (small attachment)', async () => {
    const attachment = makeFileAttachment({
      contentBytes: Buffer.from('hello-pdf').toString('base64'),
    })

    const { client, apiMock } = makeGraphClient()
    apiMock.mockReturnValue({
      version: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({ value: [attachment] }),
      }),
    })
    context = { client, integrationId: 'int_1' }

    const result = await fetchOutlookAttachments('msg_1', context)

    expect(result.attachments).toHaveLength(1)
    expect(result.failedCount).toBe(0)
    expect(result.attachments[0]!.content).toEqual(Buffer.from('hello-pdf'))
    expect(result.attachments[0]!.meta.filename).toBe('document.pdf')
    expect(result.attachments[0]!.meta.mimeType).toBe('application/pdf')
    expect(result.attachments[0]!.providerIndex).toBe(0)
  })

  it('fetches individual attachment for large attachment without contentBytes', async () => {
    const attachment = makeFileAttachment({ contentBytes: null, id: 'att_large' })

    const { client, apiMock } = makeGraphClient()

    // First call: list attachments
    // Second call: fetch individual attachment
    const versionMock = vi.fn()
    apiMock.mockReturnValue({ version: versionMock })
    versionMock
      .mockReturnValueOnce({
        get: vi.fn().mockResolvedValue({ value: [attachment] }),
      })
      .mockReturnValueOnce({
        get: vi
          .fn()
          .mockResolvedValue({ contentBytes: Buffer.from('large-content').toString('base64') }),
      })

    context = { client, integrationId: 'int_1' }

    const result = await fetchOutlookAttachments('msg_1', context)

    expect(result.attachments).toHaveLength(1)
    expect(result.failedCount).toBe(0)
    expect(result.attachments[0]!.content).toEqual(Buffer.from('large-content'))
    expect(apiMock).toHaveBeenCalledWith('/me/messages/msg_1/attachments/att_large')
  })

  it('skips ItemAttachment (not a file)', async () => {
    const items = [makeItemAttachment()]

    const { client, apiMock } = makeGraphClient()
    apiMock.mockReturnValue({
      version: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({ value: items }),
      }),
    })
    context = { client, integrationId: 'int_1' }

    const result = await fetchOutlookAttachments('msg_1', context)

    expect(result.attachments).toHaveLength(0)
    expect(result.failedCount).toBe(0)
  })

  it('skips ReferenceAttachment (OneDrive link)', async () => {
    const items = [makeReferenceAttachment()]

    const { client, apiMock } = makeGraphClient()
    apiMock.mockReturnValue({
      version: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({ value: items }),
      }),
    })
    context = { client, integrationId: 'int_1' }

    const result = await fetchOutlookAttachments('msg_1', context)

    expect(result.attachments).toHaveLength(0)
    expect(result.failedCount).toBe(0)
  })

  it('handles mixed types: 2 file + 1 item → only 2 fetched', async () => {
    const items = [
      makeFileAttachment({ id: 'att_f1', name: 'file1.pdf' }),
      makeItemAttachment({ id: 'att_i1' }),
      makeFileAttachment({ id: 'att_f2', name: 'file2.png', contentType: 'image/png' }),
    ]

    const { client, apiMock } = makeGraphClient()
    apiMock.mockReturnValue({
      version: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({ value: items }),
      }),
    })
    context = { client, integrationId: 'int_1' }

    const result = await fetchOutlookAttachments('msg_1', context)

    expect(result.attachments).toHaveLength(2)
    expect(result.failedCount).toBe(0)
    expect(result.attachments[0]!.meta.filename).toBe('file1.pdf')
    expect(result.attachments[0]!.providerIndex).toBe(0) // original index
    expect(result.attachments[1]!.meta.filename).toBe('file2.png')
    expect(result.attachments[1]!.providerIndex).toBe(2) // original index (skipped index 1)
  })

  it('preserves inline meta with contentId', async () => {
    const attachment = makeFileAttachment({
      isInline: true,
      contentId: '<cid123@outlook>',
      name: 'logo.png',
      contentType: 'image/png',
    })

    const { client, apiMock } = makeGraphClient()
    apiMock.mockReturnValue({
      version: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({ value: [attachment] }),
      }),
    })
    context = { client, integrationId: 'int_1' }

    const result = await fetchOutlookAttachments('msg_1', context)

    expect(result.attachments[0]!.meta.inline).toBe(true)
    expect(result.attachments[0]!.meta.contentId).toBe('cid123@outlook')
  })

  it('tracks failure count when individual fetch fails, preserves providerIndex for successful ones', async () => {
    const items = [
      makeFileAttachment({ id: 'att_ok1', name: 'ok1.pdf' }),
      makeFileAttachment({ id: 'att_fail', name: 'fail.pdf', contentBytes: null }),
      makeFileAttachment({ id: 'att_ok2', name: 'ok2.pdf' }),
    ]

    const { client, apiMock } = makeGraphClient()
    const versionMock = vi.fn()
    apiMock.mockReturnValue({ version: versionMock })

    // First call: list attachments (returns all 3)
    versionMock.mockReturnValueOnce({
      get: vi.fn().mockResolvedValue({ value: items }),
    })
    // att_ok1 has contentBytes so no extra call
    // att_fail needs fetch — this will throw
    versionMock.mockReturnValueOnce({
      get: vi.fn().mockRejectedValue(new Error('Graph 429')),
    })
    // att_ok2 has contentBytes so no extra call

    context = { client, integrationId: 'int_1' }

    const result = await fetchOutlookAttachments('msg_1', context)

    expect(result.attachments).toHaveLength(2)
    expect(result.failedCount).toBe(1)
    expect(result.attachments.map((a) => a.providerIndex)).toEqual([0, 2])
    expect(result.attachments.map((a) => a.meta.filename)).toEqual(['ok1.pdf', 'ok2.pdf'])
  })

  it('returns empty array for empty attachment list', async () => {
    const { client, apiMock } = makeGraphClient()
    apiMock.mockReturnValue({
      version: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({ value: [] }),
      }),
    })
    context = { client, integrationId: 'int_1' }

    const result = await fetchOutlookAttachments('msg_1', context)

    expect(result.attachments).toHaveLength(0)
    expect(result.failedCount).toBe(0)
  })

  it('handles missing value in response', async () => {
    const { client, apiMock } = makeGraphClient()
    apiMock.mockReturnValue({
      version: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({}),
      }),
    })
    context = { client, integrationId: 'int_1' }

    const result = await fetchOutlookAttachments('msg_1', context)

    expect(result.attachments).toHaveLength(0)
    expect(result.failedCount).toBe(0)
  })

  it('stores providerAttachmentId from Graph attachment id', async () => {
    const attachment = makeFileAttachment({ id: 'AAMkAGIyNWE5ZjQz' })

    const { client, apiMock } = makeGraphClient()
    apiMock.mockReturnValue({
      version: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({ value: [attachment] }),
      }),
    })
    context = { client, integrationId: 'int_1' }

    const result = await fetchOutlookAttachments('msg_1', context)

    expect(result.attachments[0]!.meta.providerAttachmentId).toBe('AAMkAGIyNWE5ZjQz')
  })
})
