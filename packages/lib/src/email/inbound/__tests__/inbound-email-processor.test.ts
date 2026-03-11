// packages/lib/src/email/inbound/__tests__/inbound-email-processor.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * mocks stores the hoisted spies shared by the inbound processor module mocks.
 */
const mocks = vi.hoisted(() => {
  return {
    parse: vi.fn(),
    resolve: vi.fn(),
    storeMessage: vi.fn(),
  }
})

vi.mock('../raw-email-parser', () => {
  /**
   * RawEmailParser is the mocked MIME parser used by these tests.
   */
  class RawEmailParser {
    /**
     * parse delegates to the hoisted parser spy.
     */
    async parse(rawEmail: string | Buffer) {
      return mocks.parse(rawEmail)
    }
  }

  return { RawEmailParser }
})

vi.mock('../integration-resolver', () => {
  /**
   * InboundIntegrationResolver is the mocked integration resolver used by these tests.
   */
  class InboundIntegrationResolver {
    /**
     * resolve delegates to the hoisted resolver spy.
     */
    async resolve(recipients: string[]) {
      return mocks.resolve(recipients)
    }
  }

  return { InboundIntegrationResolver }
})

vi.mock('../../email-storage', () => {
  /**
   * MessageStorageService is the mocked message storage service used by these tests.
   */
  class MessageStorageService {
    /**
     * constructor preserves the public class shape expected by the processor.
     */
    constructor(_organizationId: string) {}

    /**
     * storeMessage delegates to the hoisted storage spy.
     */
    async storeMessage(messageData: unknown) {
      return mocks.storeMessage(messageData)
    }
  }

  return { MessageStorageService }
})

import { InboundEmailProcessor } from '../inbound-email-processor'

/**
 * parsedEmailFixture is a stable parsed-email payload used across processor tests.
 */
const parsedEmailFixture = {
  subject: 'Fixture subject',
  textPlain: 'Fixture body',
  textHtml: '<p>Fixture body</p>',
  snippet: 'Fixture body',
  from: {
    address: 'alice@example.com',
    name: 'Alice Sender',
  },
  to: [
    {
      address: 'target@mail.auxx.ai',
      name: 'Target',
    },
  ],
  cc: [],
  bcc: [],
  replyTo: [],
  internetMessageId: '<fixture-message@example.com>',
  inReplyTo: null,
  references: null,
  sentAt: new Date('2026-03-10T22:15:00.000Z'),
  headers: {
    from: 'Alice Sender <alice@example.com>',
  },
  attachments: [],
}

/**
 * resolvedIntegrationFixture is a stable forwarding integration resolution used across tests.
 */
const resolvedIntegrationFixture = {
  organizationId: 'org_123',
  integrationId: 'integration_123',
  inboxId: 'inbox_123',
  matchedRecipient: 'target@mail.auxx.ai',
  integrationEmail: 'target@mail.auxx.ai',
  metadata: {},
  allowedSenders: [],
}

/**
 * queueMessageFixture is a stable SES queue payload used across tests.
 */
const queueMessageFixture = {
  version: 1 as const,
  provider: 'ses' as const,
  sesMessageId: 'ses-message-123',
  s3Bucket: 'test-bucket',
  s3Key: 'test-key',
  recipients: ['target@mail.auxx.ai'],
  receivedAt: '2026-03-11T00:00:00.000Z',
}

describe('InboundEmailProcessor', () => {
  beforeEach(() => {
    mocks.parse.mockReset()
    mocks.resolve.mockReset()
    mocks.storeMessage.mockReset()

    mocks.parse.mockResolvedValue(parsedEmailFixture)
    mocks.resolve.mockResolvedValue(resolvedIntegrationFixture)
    mocks.storeMessage.mockResolvedValue('message_123')
  })

  it('uses the injected raw email store when processing a queue message', async () => {
    const rawEmailStore = {
      getRawEmailString: vi.fn().mockResolvedValue('raw mime fixture'),
    }

    const processor = new InboundEmailProcessor({ rawEmailStore })

    await processor.processFromQueueMessage(queueMessageFixture)

    expect(rawEmailStore.getRawEmailString).toHaveBeenCalledWith('test-bucket', 'test-key')
    expect(mocks.parse).toHaveBeenCalledWith('raw mime fixture')
    expect(mocks.resolve).toHaveBeenCalledWith(['target@mail.auxx.ai'])
    expect(mocks.storeMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: 'ses-message-123',
        metadata: expect.objectContaining({
          inbound: expect.objectContaining({
            provider: 'ses',
            s3Bucket: 'test-bucket',
            s3Key: 'test-key',
          }),
        }),
      })
    )
  })

  it('marks dev-harness ingests in inbound metadata when configured', async () => {
    const rawEmailStore = {
      getRawEmailString: vi.fn().mockResolvedValue('raw mime fixture'),
    }

    const processor = new InboundEmailProcessor({
      rawEmailStore,
      inboundSource: 'dev-harness',
    })

    await processor.processFromQueueMessage(queueMessageFixture)

    expect(mocks.storeMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          inbound: expect.objectContaining({
            provider: 'ses',
            source: 'dev-harness',
          }),
        }),
      })
    )
  })
})
