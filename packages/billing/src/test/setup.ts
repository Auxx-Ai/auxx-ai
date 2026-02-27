// packages/billing/src/test/setup.ts

import { afterEach, vi } from 'vitest'

// Set test environment
process.env.NODE_ENV = 'test'

// Mock @auxx/credentials — stripe-client uses configService
vi.mock('@auxx/credentials', () => ({
  configService: {
    get: (key: string) => process.env[key],
  },
}))

// Mock @auxx/logger — all billing files use createScopedLogger
vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// Mock Stripe client singleton
vi.mock('@auxx/billing/services/stripe-client', () => ({
  stripeClient: {
    getClient: vi.fn(),
    initialize: vi.fn(),
    resolvePriceId: vi.fn(),
  },
}))

afterEach(() => {
  vi.clearAllMocks()
})
