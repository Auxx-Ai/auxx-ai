// packages/lib/src/providers/google/__tests__/test-utils.ts
import type { gmail_v1 } from 'googleapis'
import type { UniversalThrottler } from '../../../utils/rate-limiter'

/**
 * Create mock Gmail client for testing
 */
export function createMockGmailClient(): jest.Mocked<gmail_v1.Gmail> {
  return {
    users: {
      messages: {
        send: jest.fn(),
        list: jest.fn(),
        modify: jest.fn(),
        trash: jest.fn(),
        untrash: jest.fn(),
        get: jest.fn(),
      },
      threads: {
        get: jest.fn(),
        modify: jest.fn(),
        trash: jest.fn(),
        untrash: jest.fn(),
      },
      labels: {
        list: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        patch: jest.fn(),
        delete: jest.fn(),
      },
      drafts: {
        create: jest.fn(),
        update: jest.fn(),
        send: jest.fn(),
      },
      history: {
        list: jest.fn(),
      },
      settings: {
        sendAs: {
          list: jest.fn(),
        },
      },
      watch: jest.fn(),
      stop: jest.fn(),
    },
  } as any
}

/**
 * Create mock throttler for testing
 */
export function createMockThrottler(): jest.Mocked<UniversalThrottler> {
  return {
    execute: jest.fn((context, fn, options) => fn()),
  } as any
}

/**
 * Create test Gmail message
 */
export function createTestGmailMessage(
  overrides?: Partial<gmail_v1.Schema$Message>
): gmail_v1.Schema$Message {
  return {
    id: 'msg-123',
    threadId: 'thread-456',
    labelIds: ['INBOX', 'UNREAD'],
    snippet: 'Test message snippet',
    historyId: '789',
    internalDate: Date.now().toString(),
    payload: {
      headers: [
        { name: 'From', value: 'sender@example.com' },
        { name: 'To', value: 'recipient@example.com' },
        { name: 'Subject', value: 'Test Subject' },
        { name: 'Date', value: new Date().toUTCString() },
        { name: 'Message-ID', value: '<test@example.com>' },
      ],
      body: {
        data: Buffer.from('Test message body').toString('base64'),
      },
    },
    ...overrides,
  }
}
