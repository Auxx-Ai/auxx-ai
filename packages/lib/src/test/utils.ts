// packages/lib/src/test/utils.ts

/**
 * Test utilities for @auxx/lib package
 */

import { vi } from 'vitest'

/**
 * Creates a mock database instance with common methods
 */
export function createMockDb() {
  return {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    organization: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    ticket: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    workflow: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    // Add more models as needed
  }
}

/**
 * Creates a mock Redis instance
 */
export function createMockRedis() {
  return {
    get: vi.fn(),
    set: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    exists: vi.fn(),
    expire: vi.fn(),
    ttl: vi.fn(),
    keys: vi.fn(),
    hget: vi.fn(),
    hset: vi.fn(),
    hdel: vi.fn(),
    hgetall: vi.fn(),
    pipeline: vi.fn(() => ({
      set: vi.fn(),
      expire: vi.fn(),
      exec: vi.fn(),
    })),
    disconnect: vi.fn(),
  }
}

/**
 * Creates a mock OpenAI client
 */
export function createMockOpenAI() {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: 'Mock AI response',
                role: 'assistant',
              },
            },
          ],
        }),
      },
    },
    embeddings: {
      create: vi.fn().mockResolvedValue({
        data: [
          {
            embedding: new Array(1536).fill(0.1),
          },
        ],
      }),
    },
  }
}

/**
 * Creates a mock email processing context
 */
export function createMockEmailContext() {
  return {
    email: {
      id: 'test-email-id',
      subject: 'Test Email Subject',
      from: 'test@example.com',
      to: ['recipient@example.com'],
      body: 'Test email body content',
      headers: {},
      attachments: [],
    },
    organization: {
      id: 'test-org-id',
      name: 'Test Organization',
      settings: {},
    },
    user: {
      id: 'test-user-id',
      email: 'user@example.com',
      name: 'Test User',
    },
  }
}

/**
 * Creates a mock workflow execution context
 */
export function createMockWorkflowContext() {
  const variables = new Map()

  return {
    getVariable: vi.fn((key: string) => variables.get(key)),
    setVariable: vi.fn((key: string, value: any) => variables.set(key, value)),
    hasVariable: vi.fn((key: string) => variables.has(key)),
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    variables,
  }
}

/**
 * Waits for a specified amount of time (useful for testing async operations)
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Creates a mock fetch response
 */
export function createMockFetchResponse(data: any, status = 200, statusText = 'OK') {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
    headers: new Headers(),
  }
}

/**
 * Mocks the global fetch function
 */
export function mockFetch(response: any, status = 200) {
  global.fetch = vi.fn().mockResolvedValue(createMockFetchResponse(response, status))
  return global.fetch
}
