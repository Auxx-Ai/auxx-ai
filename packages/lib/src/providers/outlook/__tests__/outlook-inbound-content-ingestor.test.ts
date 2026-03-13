// packages/lib/src/providers/outlook/__tests__/outlook-inbound-content-ingestor.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  return {
    ingestBody: vi.fn(),
    ingestAll: vi.fn(),
    fetchOutlookAttachments: vi.fn(),
    storeMessage: vi.fn(),
  }
})

vi.mock('../../../email/inbound/body-ingest.service', () => ({
  InboundBodyIngestService: class {
    ingestBody = mocks.ingestBody
  },
}))

vi.mock('../../../email/inbound/attachment-ingest.service', () => ({
  InboundAttachmentIngestService: class {
    ingestAll = mocks.ingestAll
  },
}))

vi.mock('../outlook-attachment-fetcher', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../outlook-attachment-fetcher')>()
  return {
    ...orig,
    fetchOutlookAttachments: mocks.fetchOutlookAttachments,
  }
})

import type { MessageData, MessageStorageService } from '../../../email/email-storage'
import type { OutlookFetchContext } from '../outlook-attachment-fetcher'
import { OutlookInboundContentIngestor } from '../outlook-inbound-content-ingestor'

function makeStorageService(): MessageStorageService {
  return {
    storeMessage: mocks.storeMessage,
  } as any
}

const fetchContext: OutlookFetchContext = {
  client: {} as any,
  integrationId: 'int_1',
}

function makeMessageData(overrides: Partial<MessageData> = {}): MessageData {
  return {
    externalId: 'outlook_msg_abc',
    externalThreadId: 'conv_1',
    integrationId: 'int_1',
    organizationId: 'org_1',
    isInbound: true,
    hasAttachments: false,
    from: { identifier: 'sender@example.com' },
    to: [{ identifier: 'user@example.com' }],
    createdTime: new Date('2025-01-01'),
    sentAt: new Date('2025-01-01'),
    receivedAt: new Date('2025-01-01'),
    textHtml: '<p>Hello</p>',
    textPlain: 'Hello',
    snippet: 'Hello',
    ...overrides,
  } as MessageData
}

describe('OutlookInboundContentIngestor', () => {
  beforeEach(() => {
    mocks.ingestBody.mockReset()
    mocks.ingestAll.mockReset()
    mocks.fetchOutlookAttachments.mockReset()
    mocks.storeMessage.mockReset()

    mocks.ingestBody.mockResolvedValue({ htmlBodyStorageLocationId: 'sl_body_1' })
    mocks.storeMessage.mockResolvedValue({ messageId: 'msg_stored_1', isNew: true })
    mocks.ingestAll.mockResolvedValue([])
    mocks.fetchOutlookAttachments.mockResolvedValue({
      attachments: [],
      failedCount: 0,
    })
  })

  it('skips body and attachment ingest for outbound messages', async () => {
    const ingestor = new OutlookInboundContentIngestor('org_1', makeStorageService())

    const msg = makeMessageData({ isInbound: false })
    const result = await ingestor.storeBatchWithIngest([msg], fetchContext)

    expect(result.storedCount).toBe(1)
    expect(result.failedCount).toBe(0)
    expect(mocks.storeMessage).toHaveBeenCalledOnce()
    expect(mocks.ingestBody).not.toHaveBeenCalled()
    expect(mocks.fetchOutlookAttachments).not.toHaveBeenCalled()
    expect(mocks.ingestAll).not.toHaveBeenCalled()
  })

  it('calls body ingest with externalId as contentScopeId for inbound messages', async () => {
    const ingestor = new OutlookInboundContentIngestor('org_1', makeStorageService())

    await ingestor.storeBatchWithIngest(
      [makeMessageData({ externalId: 'outlook_123' })],
      fetchContext
    )

    expect(mocks.ingestBody).toHaveBeenCalledWith(
      { textHtml: '<p>Hello</p>' },
      { organizationId: 'org_1', contentScopeId: 'outlook_123' }
    )
  })

  it('sets htmlBodyStorageLocationId on MessageData before storeMessage', async () => {
    mocks.ingestBody.mockResolvedValue({ htmlBodyStorageLocationId: 'sl_body_99' })

    const ingestor = new OutlookInboundContentIngestor('org_1', makeStorageService())
    await ingestor.storeBatchWithIngest([makeMessageData()], fetchContext)

    const storedMsg = mocks.storeMessage.mock.calls[0]![0] as MessageData
    expect(storedMsg.htmlBodyStorageLocationId).toBe('sl_body_99')
  })

  it('skips body ingest when textHtml is empty', async () => {
    const ingestor = new OutlookInboundContentIngestor('org_1', makeStorageService())

    await ingestor.storeBatchWithIngest([makeMessageData({ textHtml: '' })], fetchContext)

    expect(mocks.ingestBody).not.toHaveBeenCalled()
  })

  it('skips body ingest when textHtml is undefined (text-only email)', async () => {
    const ingestor = new OutlookInboundContentIngestor('org_1', makeStorageService())

    await ingestor.storeBatchWithIngest(
      [makeMessageData({ textHtml: undefined, textPlain: 'Plain text email' })],
      fetchContext
    )

    expect(mocks.ingestBody).not.toHaveBeenCalled()
  })

  it('fetches attachments from Graph API for inbound message with hasAttachments', async () => {
    mocks.fetchOutlookAttachments.mockResolvedValue({
      attachments: [
        {
          providerIndex: 0,
          meta: {
            filename: 'doc.pdf',
            mimeType: 'application/pdf',
            size: 5000,
            inline: false,
            contentId: null,
            providerAttachmentId: 'att_1',
          },
          content: Buffer.from('pdf-bytes'),
        },
      ],
      failedCount: 0,
    })

    const ingestor = new OutlookInboundContentIngestor('org_1', makeStorageService())
    await ingestor.storeBatchWithIngest([makeMessageData({ hasAttachments: true })], fetchContext)

    expect(mocks.fetchOutlookAttachments).toHaveBeenCalledWith('outlook_msg_abc', fetchContext)
  })

  it('does not fetch attachments when hasAttachments is false', async () => {
    const ingestor = new OutlookInboundContentIngestor('org_1', makeStorageService())

    await ingestor.storeBatchWithIngest([makeMessageData({ hasAttachments: false })], fetchContext)

    expect(mocks.fetchOutlookAttachments).not.toHaveBeenCalled()
    expect(mocks.ingestAll).not.toHaveBeenCalled()
  })

  it('passes fetched attachments to ingestAll with correct inputs', async () => {
    mocks.fetchOutlookAttachments.mockResolvedValue({
      attachments: [
        {
          providerIndex: 0,
          meta: {
            filename: 'image.png',
            mimeType: 'image/png',
            size: 1000,
            inline: true,
            contentId: 'cid123',
            providerAttachmentId: 'att_1',
          },
          content: Buffer.from('image-data'),
        },
      ],
      failedCount: 0,
    })

    const ingestor = new OutlookInboundContentIngestor('org_1', makeStorageService())
    await ingestor.storeBatchWithIngest([makeMessageData({ hasAttachments: true })], fetchContext)

    expect(mocks.ingestAll).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          content: Buffer.from('image-data'),
          filename: 'image.png',
          mimeType: 'image/png',
          inline: true,
          contentId: 'cid123',
          attachmentOrder: 0,
        }),
      ],
      expect.objectContaining({
        organizationId: 'org_1',
        messageId: 'msg_stored_1',
        contentScopeId: 'outlook_msg_abc',
      }),
      { skipReconciliation: false }
    )
  })

  it('skips attachment ingest for already-existing message (isNew: false)', async () => {
    mocks.storeMessage.mockResolvedValue({ messageId: 'msg_existing', isNew: false })

    const ingestor = new OutlookInboundContentIngestor('org_1', makeStorageService())
    await ingestor.storeBatchWithIngest([makeMessageData({ hasAttachments: true })], fetchContext)

    expect(mocks.fetchOutlookAttachments).not.toHaveBeenCalled()
    expect(mocks.ingestAll).not.toHaveBeenCalled()
  })

  it('passes skipReconciliation: true when some attachment fetches failed', async () => {
    mocks.fetchOutlookAttachments.mockResolvedValue({
      attachments: [
        {
          providerIndex: 0,
          meta: {
            filename: 'ok.pdf',
            mimeType: 'application/pdf',
            size: 100,
            inline: false,
            contentId: null,
            providerAttachmentId: 'att_ok',
          },
          content: Buffer.from('ok-bytes'),
        },
      ],
      failedCount: 1,
    })

    const ingestor = new OutlookInboundContentIngestor('org_1', makeStorageService())
    await ingestor.storeBatchWithIngest([makeMessageData({ hasAttachments: true })], fetchContext)

    const options = mocks.ingestAll.mock.calls[0]![2]
    expect(options).toEqual({ skipReconciliation: true })
  })

  it('passes skipReconciliation: false when all fetches succeed', async () => {
    mocks.fetchOutlookAttachments.mockResolvedValue({
      attachments: [
        {
          providerIndex: 0,
          meta: {
            filename: 'doc.pdf',
            mimeType: 'application/pdf',
            size: 100,
            inline: false,
            contentId: null,
            providerAttachmentId: 'att_1',
          },
          content: Buffer.from('data'),
        },
      ],
      failedCount: 0,
    })

    const ingestor = new OutlookInboundContentIngestor('org_1', makeStorageService())
    await ingestor.storeBatchWithIngest([makeMessageData({ hasAttachments: true })], fetchContext)

    const options = mocks.ingestAll.mock.calls[0]![2]
    expect(options).toEqual({ skipReconciliation: false })
  })

  it('throws retriable error when ALL attachment fetches failed', async () => {
    mocks.fetchOutlookAttachments.mockResolvedValue({
      attachments: [],
      failedCount: 3,
    })

    const ingestor = new OutlookInboundContentIngestor('org_1', makeStorageService())
    const result = await ingestor.storeBatchWithIngest(
      [makeMessageData({ hasAttachments: true })],
      fetchContext
    )

    // The batch catches per-message errors and tracks them
    expect(result.failedCount).toBe(1)
    expect(result.retriableFailures).toHaveLength(1)
    expect(result.retriableFailures[0]!.error).toContain('All 3 attachment fetches failed')
  })

  it('stores message even when body ingest throws (degraded ingest, fail-open)', async () => {
    mocks.ingestBody.mockRejectedValue(new Error('S3 lookup failed'))

    const ingestor = new OutlookInboundContentIngestor('org_1', makeStorageService())

    const result = await ingestor.storeBatchWithIngest(
      [makeMessageData({ externalId: 'msg_degraded' })],
      fetchContext
    )

    expect(result.storedCount).toBe(1)
    expect(result.failedCount).toBe(0)
    expect(mocks.storeMessage).toHaveBeenCalledOnce()
    // htmlBodyStorageLocationId should not be set since ingest failed
    const storedMsg = mocks.storeMessage.mock.calls[0]![0] as MessageData
    expect(storedMsg.htmlBodyStorageLocationId).toBeUndefined()
  })

  it('preserves chronological sort in batch', async () => {
    const storedOrder: string[] = []
    mocks.storeMessage.mockImplementation(async (msg: MessageData) => {
      storedOrder.push(msg.externalId)
      return { messageId: `stored_${msg.externalId}`, isNew: true }
    })

    const ingestor = new OutlookInboundContentIngestor('org_1', makeStorageService())

    const messages = [
      makeMessageData({ externalId: 'msg_c', sentAt: new Date('2025-01-03'), isInbound: false }),
      makeMessageData({ externalId: 'msg_a', sentAt: new Date('2025-01-01'), isInbound: false }),
      makeMessageData({ externalId: 'msg_b', sentAt: new Date('2025-01-02'), isInbound: false }),
    ]

    await ingestor.storeBatchWithIngest(messages, fetchContext)

    expect(storedOrder).toEqual(['msg_a', 'msg_b', 'msg_c'])
  })

  it('returns empty result for empty batch', async () => {
    const ingestor = new OutlookInboundContentIngestor('org_1', makeStorageService())

    const result = await ingestor.storeBatchWithIngest([], fetchContext)

    expect(result.storedCount).toBe(0)
    expect(result.failedCount).toBe(0)
    expect(result.failedExternalIds).toEqual([])
    expect(mocks.storeMessage).not.toHaveBeenCalled()
  })

  it('continues processing remaining messages when one fails and reports failures', async () => {
    mocks.storeMessage
      .mockRejectedValueOnce(new Error('DB error'))
      .mockResolvedValueOnce({ messageId: 'msg_2', isNew: true })

    const ingestor = new OutlookInboundContentIngestor('org_1', makeStorageService())

    const messages = [
      makeMessageData({ externalId: 'msg_fail', isInbound: false }),
      makeMessageData({ externalId: 'msg_ok', isInbound: false }),
    ]

    const result = await ingestor.storeBatchWithIngest(messages, fetchContext)

    expect(result.storedCount).toBe(1)
    expect(result.failedCount).toBe(1)
    expect(result.failedExternalIds).toContain('msg_fail')
    expect(result.retriableFailures).toHaveLength(1)
    expect(mocks.storeMessage).toHaveBeenCalledTimes(2)
  })

  it('classifies constraint violations as non-retriable failures', async () => {
    mocks.storeMessage.mockRejectedValueOnce(new Error('unique constraint violation'))

    const ingestor = new OutlookInboundContentIngestor('org_1', makeStorageService())

    const result = await ingestor.storeBatchWithIngest(
      [makeMessageData({ externalId: 'msg_dup', isInbound: false })],
      fetchContext
    )

    expect(result.failedCount).toBe(1)
    expect(result.nonRetriableFailures).toHaveLength(1)
    expect(result.retriableFailures).toHaveLength(0)
  })

  it('classifies connection errors as retriable failures', async () => {
    mocks.storeMessage.mockRejectedValueOnce(new Error('connection refused'))

    const ingestor = new OutlookInboundContentIngestor('org_1', makeStorageService())

    const result = await ingestor.storeBatchWithIngest(
      [makeMessageData({ externalId: 'msg_conn', isInbound: false })],
      fetchContext
    )

    expect(result.failedCount).toBe(1)
    expect(result.retriableFailures).toHaveLength(1)
    expect(result.nonRetriableFailures).toHaveLength(0)
  })

  it('uses providerIndex for attachmentOrder (not sequential)', async () => {
    // Simulating: index 0 and 2 are file attachments, index 1 was item (skipped by fetcher)
    mocks.fetchOutlookAttachments.mockResolvedValue({
      attachments: [
        {
          providerIndex: 0,
          meta: {
            filename: 'first.pdf',
            mimeType: 'application/pdf',
            size: 100,
            inline: false,
            contentId: null,
            providerAttachmentId: 'att_0',
          },
          content: Buffer.from('first'),
        },
        {
          providerIndex: 2,
          meta: {
            filename: 'third.png',
            mimeType: 'image/png',
            size: 200,
            inline: false,
            contentId: null,
            providerAttachmentId: 'att_2',
          },
          content: Buffer.from('third'),
        },
      ],
      failedCount: 0,
    })

    const ingestor = new OutlookInboundContentIngestor('org_1', makeStorageService())
    await ingestor.storeBatchWithIngest([makeMessageData({ hasAttachments: true })], fetchContext)

    const inputs = mocks.ingestAll.mock.calls[0]![0]
    expect(inputs[0].attachmentOrder).toBe(0)
    expect(inputs[1].attachmentOrder).toBe(2)
  })
})
