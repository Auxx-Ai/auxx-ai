// packages/lib/src/providers/google/messages/__tests__/gmail-inbound-content-ingestor.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  return {
    ingestBody: vi.fn(),
    ingestAll: vi.fn(),
    fetchAllGmailAttachmentBytes: vi.fn(),
    storeMessage: vi.fn(),
  }
})

vi.mock('../../../../email/inbound/body-ingest.service', () => ({
  InboundBodyIngestService: class {
    ingestBody = mocks.ingestBody
  },
}))

vi.mock('../../../../email/inbound/attachment-ingest.service', () => ({
  InboundAttachmentIngestService: class {
    ingestAll = mocks.ingestAll
  },
}))

vi.mock('../gmail-attachment-fetcher', () => ({
  fetchAllGmailAttachmentBytes: mocks.fetchAllGmailAttachmentBytes,
}))

import type { MessageData, MessageStorageService } from '../../../../email/email-storage'
import { GmailInboundContentIngestor } from '../gmail-inbound-content-ingestor'

function makeStorageService(): MessageStorageService {
  return {
    storeMessage: mocks.storeMessage,
  } as any
}

const fetchContext = {
  accessToken: 'ya29.test',
  integrationId: 'int_1',
  throttler: {} as any,
}

function makeMessageData(overrides: Partial<MessageData> = {}): MessageData {
  return {
    externalId: 'gmail_msg_abc',
    externalThreadId: 'thread_1',
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

describe('GmailInboundContentIngestor', () => {
  beforeEach(() => {
    mocks.ingestBody.mockReset()
    mocks.ingestAll.mockReset()
    mocks.fetchAllGmailAttachmentBytes.mockReset()
    mocks.storeMessage.mockReset()

    mocks.ingestBody.mockResolvedValue({ htmlBodyStorageLocationId: 'sl_body_1' })
    mocks.storeMessage.mockResolvedValue('msg_stored_1')
    mocks.ingestAll.mockResolvedValue([])
    mocks.fetchAllGmailAttachmentBytes.mockResolvedValue({
      resolved: new Map(),
      failedCount: 0,
    })
  })

  it('skips body and attachment ingest for outbound messages', async () => {
    const ingestor = new GmailInboundContentIngestor('org_1', makeStorageService())

    const msg = makeMessageData({ isInbound: false })
    const result = await ingestor.storeBatchWithIngest([msg], fetchContext)

    expect(result.storedCount).toBe(1)
    expect(result.failedCount).toBe(0)
    expect(mocks.storeMessage).toHaveBeenCalledOnce()
    expect(mocks.ingestBody).not.toHaveBeenCalled()
    expect(mocks.fetchAllGmailAttachmentBytes).not.toHaveBeenCalled()
    expect(mocks.ingestAll).not.toHaveBeenCalled()
  })

  it('calls body ingest with externalId as contentScopeId for inbound messages', async () => {
    const ingestor = new GmailInboundContentIngestor('org_1', makeStorageService())

    await ingestor.storeBatchWithIngest(
      [makeMessageData({ externalId: 'gmail_123' })],
      fetchContext
    )

    expect(mocks.ingestBody).toHaveBeenCalledWith(
      { textHtml: '<p>Hello</p>' },
      { organizationId: 'org_1', contentScopeId: 'gmail_123' }
    )
  })

  it('sets htmlBodyStorageLocationId on MessageData before storeMessage', async () => {
    mocks.ingestBody.mockResolvedValue({ htmlBodyStorageLocationId: 'sl_body_99' })

    const ingestor = new GmailInboundContentIngestor('org_1', makeStorageService())
    await ingestor.storeBatchWithIngest([makeMessageData()], fetchContext)

    const storedMsg = mocks.storeMessage.mock.calls[0]![0] as MessageData
    expect(storedMsg.htmlBodyStorageLocationId).toBe('sl_body_99')
  })

  it('skips body ingest when textHtml is empty', async () => {
    const ingestor = new GmailInboundContentIngestor('org_1', makeStorageService())

    await ingestor.storeBatchWithIngest([makeMessageData({ textHtml: '' })], fetchContext)

    expect(mocks.ingestBody).not.toHaveBeenCalled()
  })

  it('fetches attachment bytes for inbound message with providerAttachments', async () => {
    const providerAttachments = [
      {
        filename: 'doc.pdf',
        mimeType: 'application/pdf',
        size: 5000,
        inline: false,
        contentId: null,
        providerAttachmentId: 'att_gmail_1',
        embeddedData: null,
      },
    ]

    const bytesMap = new Map([[0, Buffer.from('pdf-bytes')]])
    mocks.fetchAllGmailAttachmentBytes.mockResolvedValue({
      resolved: bytesMap,
      failedCount: 0,
    })

    const ingestor = new GmailInboundContentIngestor('org_1', makeStorageService())
    await ingestor.storeBatchWithIngest(
      [makeMessageData({ providerAttachments, hasAttachments: true })],
      fetchContext
    )

    expect(mocks.fetchAllGmailAttachmentBytes).toHaveBeenCalledWith(
      'gmail_msg_abc',
      providerAttachments,
      fetchContext
    )
  })

  it('passes fetched bytes to ingestAll with correct inputs', async () => {
    const providerAttachments = [
      {
        filename: 'image.png',
        mimeType: 'image/png',
        size: 1000,
        inline: true,
        contentId: 'cid@mail',
        providerAttachmentId: null,
        embeddedData: 'aW1hZ2VkYXRh',
      },
    ]

    const decodedBytes = Buffer.from('imagedata')
    mocks.fetchAllGmailAttachmentBytes.mockResolvedValue({
      resolved: new Map([[0, decodedBytes]]),
      failedCount: 0,
    })

    const ingestor = new GmailInboundContentIngestor('org_1', makeStorageService())
    await ingestor.storeBatchWithIngest(
      [makeMessageData({ providerAttachments, hasAttachments: true })],
      fetchContext
    )

    expect(mocks.ingestAll).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          content: decodedBytes,
          filename: 'image.png',
          mimeType: 'image/png',
          inline: true,
          contentId: 'cid@mail',
          attachmentOrder: 0,
        }),
      ],
      expect.objectContaining({
        organizationId: 'org_1',
        messageId: 'msg_stored_1',
        contentScopeId: 'gmail_msg_abc',
      }),
      { skipReconciliation: false }
    )
  })

  it('skips attachment with failed fetch (no 0-byte asset)', async () => {
    const providerAttachments = [
      {
        filename: 'ok.png',
        mimeType: 'image/png',
        size: 100,
        inline: false,
        contentId: null,
        providerAttachmentId: 'att_ok',
        embeddedData: null,
      },
      {
        filename: 'fail.pdf',
        mimeType: 'application/pdf',
        size: 200,
        inline: false,
        contentId: null,
        providerAttachmentId: 'att_fail',
        embeddedData: null,
      },
    ]

    // Only index 0 resolved; index 1 failed
    mocks.fetchAllGmailAttachmentBytes.mockResolvedValue({
      resolved: new Map([[0, Buffer.from('ok-bytes')]]),
      failedCount: 1,
    })

    const ingestor = new GmailInboundContentIngestor('org_1', makeStorageService())
    await ingestor.storeBatchWithIngest(
      [makeMessageData({ providerAttachments, hasAttachments: true })],
      fetchContext
    )

    // Only 1 attachment passed to ingestAll (the successful one)
    const ingestInputs = mocks.ingestAll.mock.calls[0]![0]
    expect(ingestInputs).toHaveLength(1)
    expect(ingestInputs[0].filename).toBe('ok.png')
  })

  it('passes skipReconciliation: true when any fetch failed', async () => {
    const providerAttachments = [
      {
        filename: 'ok.png',
        mimeType: 'image/png',
        size: 100,
        inline: false,
        contentId: null,
        providerAttachmentId: 'att_ok',
        embeddedData: null,
      },
    ]

    mocks.fetchAllGmailAttachmentBytes.mockResolvedValue({
      resolved: new Map([[0, Buffer.from('bytes')]]),
      failedCount: 1,
    })

    const ingestor = new GmailInboundContentIngestor('org_1', makeStorageService())
    await ingestor.storeBatchWithIngest(
      [makeMessageData({ providerAttachments, hasAttachments: true })],
      fetchContext
    )

    const options = mocks.ingestAll.mock.calls[0]![2]
    expect(options).toEqual({ skipReconciliation: true })
  })

  it('passes skipReconciliation: false when all fetches succeed', async () => {
    const providerAttachments = [
      {
        filename: 'doc.pdf',
        mimeType: 'application/pdf',
        size: 100,
        inline: false,
        contentId: null,
        providerAttachmentId: 'att_1',
        embeddedData: null,
      },
    ]

    mocks.fetchAllGmailAttachmentBytes.mockResolvedValue({
      resolved: new Map([[0, Buffer.from('data')]]),
      failedCount: 0,
    })

    const ingestor = new GmailInboundContentIngestor('org_1', makeStorageService())
    await ingestor.storeBatchWithIngest(
      [makeMessageData({ providerAttachments, hasAttachments: true })],
      fetchContext
    )

    const options = mocks.ingestAll.mock.calls[0]![2]
    expect(options).toEqual({ skipReconciliation: false })
  })

  it('preserves chronological sort in batch', async () => {
    const storedOrder: string[] = []
    mocks.storeMessage.mockImplementation(async (msg: MessageData) => {
      storedOrder.push(msg.externalId)
      return `stored_${msg.externalId}`
    })

    const ingestor = new GmailInboundContentIngestor('org_1', makeStorageService())

    const messages = [
      makeMessageData({ externalId: 'msg_c', sentAt: new Date('2025-01-03'), isInbound: false }),
      makeMessageData({ externalId: 'msg_a', sentAt: new Date('2025-01-01'), isInbound: false }),
      makeMessageData({ externalId: 'msg_b', sentAt: new Date('2025-01-02'), isInbound: false }),
    ]

    await ingestor.storeBatchWithIngest(messages, fetchContext)

    expect(storedOrder).toEqual(['msg_a', 'msg_b', 'msg_c'])
  })

  it('returns empty result for empty batch', async () => {
    const ingestor = new GmailInboundContentIngestor('org_1', makeStorageService())

    const result = await ingestor.storeBatchWithIngest([], fetchContext)

    expect(result.storedCount).toBe(0)
    expect(result.failedCount).toBe(0)
    expect(result.failedExternalIds).toEqual([])
    expect(mocks.storeMessage).not.toHaveBeenCalled()
  })

  it('continues processing remaining messages when one fails and reports failures', async () => {
    mocks.storeMessage.mockRejectedValueOnce(new Error('DB error')).mockResolvedValueOnce('msg_2')

    const ingestor = new GmailInboundContentIngestor('org_1', makeStorageService())

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

  it('does not call ingestAll when no providerAttachments', async () => {
    const ingestor = new GmailInboundContentIngestor('org_1', makeStorageService())

    await ingestor.storeBatchWithIngest([makeMessageData()], fetchContext)

    expect(mocks.fetchAllGmailAttachmentBytes).not.toHaveBeenCalled()
    expect(mocks.ingestAll).not.toHaveBeenCalled()
  })

  it('stores message even when body ingest throws (degraded ingest, fail-open)', async () => {
    mocks.ingestBody.mockRejectedValue(new Error('S3 lookup failed'))

    const ingestor = new GmailInboundContentIngestor('org_1', makeStorageService())

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

  it('classifies constraint violations as non-retriable failures', async () => {
    mocks.storeMessage.mockRejectedValueOnce(new Error('unique constraint violation'))

    const ingestor = new GmailInboundContentIngestor('org_1', makeStorageService())

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

    const ingestor = new GmailInboundContentIngestor('org_1', makeStorageService())

    const result = await ingestor.storeBatchWithIngest(
      [makeMessageData({ externalId: 'msg_conn', isInbound: false })],
      fetchContext
    )

    expect(result.failedCount).toBe(1)
    expect(result.retriableFailures).toHaveLength(1)
    expect(result.nonRetriableFailures).toHaveLength(0)
  })
})
