// packages/lib/src/test/setup.ts

import { loadEnv } from 'vite'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'

// Load test environment variables
const env = loadEnv('test', process.cwd(), '')
Object.assign(process.env, env)

// Set test environment
process.env.NODE_ENV = 'test'

// Mock external services that are commonly used
vi.mock('ioredis', () => ({
  default: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    exists: vi.fn(),
    expire: vi.fn(),
    pipeline: vi.fn(() => ({
      set: vi.fn(),
      expire: vi.fn(),
      exec: vi.fn(),
    })),
    disconnect: vi.fn(),
  })),
}))

// Mock Drizzle database and enums used by providers
vi.mock('@auxx/database', () => ({
  database: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
    query: {
      user: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      organization: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      // Add other models as needed
    },
  },
  // Minimal enum surface used in providers
  IntegrationProviderTypeValues: ['google', 'outlook'],
}))

// Mock external APIs
vi.mock('openai', () => ({
  default: vi.fn(() => ({
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  })),
}))

// Global test setup
beforeAll(() => {
  // Add any global setup here
})

afterEach(() => {
  // Clear all mocks after each test
  vi.clearAllMocks()
})

afterAll(() => {
  // Add any global cleanup here
})
