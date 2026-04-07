// packages/lib/src/test/setup.ts

import path from 'node:path'
import { loadEnv } from 'vite'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'

// Load test environment variables (monorepo root first, then local overrides)
const monorepoRoot = path.resolve(__dirname, '../../../..')
const env = { ...loadEnv('test', monorepoRoot, ''), ...loadEnv('test', process.cwd(), '') }
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
// The chainable mock handles patterns like db.select().from().where().limit().prepare()
const createChainableMock = () => {
  const mock: any = vi.fn(() => mock)
  mock.from = vi.fn(() => mock)
  mock.where = vi.fn(() => mock)
  mock.limit = vi.fn(() => mock)
  mock.offset = vi.fn(() => mock)
  mock.orderBy = vi.fn(() => mock)
  mock.groupBy = vi.fn(() => mock)
  mock.having = vi.fn(() => mock)
  mock.leftJoin = vi.fn(() => mock)
  mock.innerJoin = vi.fn(() => mock)
  mock.rightJoin = vi.fn(() => mock)
  mock.fullJoin = vi.fn(() => mock)
  mock.prepare = vi.fn(() => mock)
  mock.execute = vi.fn().mockResolvedValue([])
  mock.set = vi.fn(() => mock)
  mock.values = vi.fn(() => mock)
  mock.returning = vi.fn(() => mock)
  mock.onConflictDoNothing = vi.fn(() => mock)
  mock.onConflictDoUpdate = vi.fn(() => mock)
  mock.then = undefined // Prevent Promise-like behavior
  return mock
}

vi.mock('@auxx/database', () => ({
  database: {
    select: vi.fn(() => createChainableMock()),
    insert: vi.fn(() => createChainableMock()),
    update: vi.fn(() => createChainableMock()),
    delete: vi.fn(() => createChainableMock()),
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
    },
  },
  schema: new Proxy({}, { get: () => ({}) }),
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
