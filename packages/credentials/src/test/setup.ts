// packages/credentials/src/test/setup.ts

import { afterEach, vi } from 'vitest'

process.env.NODE_ENV = 'test'

// Mock @auxx/database to prevent DB connection during tests
vi.mock('@auxx/database', () => ({
  database: {},
  schema: { KeyValuePair: {} },
}))

// Mock @auxx/logger
vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

afterEach(() => {
  vi.clearAllMocks()
})
