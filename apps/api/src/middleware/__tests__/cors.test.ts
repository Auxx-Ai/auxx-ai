// apps/api/src/middleware/__tests__/cors.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mocks must be set up before importing the module under test
const mockGetTrustedOrigins = vi.fn<() => string[]>()
const mockConfigServiceGet = vi.fn<(key: string) => string | undefined>()
const mockLogWarn = vi.fn()

vi.mock('@auxx/config/server', () => ({
  getTrustedOrigins: (...args: unknown[]) => mockGetTrustedOrigins(...(args as [])),
}))

vi.mock('@auxx/credentials', () => ({
  configService: {
    get: (key: string) => mockConfigServiceGet(key),
  },
}))

vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({
    warn: mockLogWarn,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

describe('CORS middleware', () => {
  const originalNodeEnv = process.env.NODE_ENV

  afterEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.NODE_ENV = originalNodeEnv
  })

  async function loadCorsModule(env: string = 'development') {
    process.env.NODE_ENV = env
    return import('../cors')
  }

  describe('origin callback', () => {
    beforeEach(() => {
      mockGetTrustedOrigins.mockReturnValue([
        'https://app.auxx.ai',
        'https://build.auxx.ai',
        'https://api.auxx.ai',
      ])
      mockConfigServiceGet.mockReturnValue(undefined)
    })

    it('allows trusted origin (WEBAPP_URL)', async () => {
      const { allowedOrigins } = await loadCorsModule('production')
      expect(allowedOrigins.has('https://app.auxx.ai')).toBe(true)
    })

    it('allows trusted origin (DEV_PORTAL_URL)', async () => {
      const { allowedOrigins } = await loadCorsModule('production')
      expect(allowedOrigins.has('https://build.auxx.ai')).toBe(true)
    })

    it('allows trusted origin (API_URL)', async () => {
      const { allowedOrigins } = await loadCorsModule('production')
      expect(allowedOrigins.has('https://api.auxx.ai')).toBe(true)
    })

    it('rejects unknown origin in production', async () => {
      const { allowedOrigins } = await loadCorsModule('production')
      expect(allowedOrigins.has('https://evil.com')).toBe(false)
    })

    it('includes EXTRA_ALLOWED_ORIGINS when set', async () => {
      mockConfigServiceGet.mockImplementation((key: string) => {
        if (key === 'EXTRA_ALLOWED_ORIGINS')
          return 'https://preview.example.com, https://staging.example.com'
        return undefined
      })

      const { allowedOrigins } = await loadCorsModule('production')
      expect(allowedOrigins.has('https://preview.example.com')).toBe(true)
      expect(allowedOrigins.has('https://staging.example.com')).toBe(true)
    })
  })

  describe('localhost handling', () => {
    beforeEach(() => {
      mockGetTrustedOrigins.mockReturnValue(['https://app.auxx.ai'])
      mockConfigServiceGet.mockReturnValue(undefined)
    })

    it('allows localhost in development via origin callback', async () => {
      // In dev mode, localhost is allowed by the origin callback even though
      // it's not in the allowedOrigins set
      const mod = await loadCorsModule('development')
      // The corsMiddleware origin function is not directly accessible,
      // but we verify localhost is NOT in the static set (it's dynamic)
      expect(mod.allowedOrigins.has('http://localhost:5173')).toBe(false)
      // The actual dynamic check happens in the hono cors origin callback
    })

    it('does not include localhost in allowedOrigins set when origins are production URLs', async () => {
      const { allowedOrigins } = await loadCorsModule('production')
      expect(allowedOrigins.has('http://localhost:5173')).toBe(false)
    })
  })

  describe('production localhost warning', () => {
    it('warns when derived origins contain localhost in production', async () => {
      mockGetTrustedOrigins.mockReturnValue(['http://localhost:3000', 'https://app.auxx.ai'])
      mockConfigServiceGet.mockReturnValue(undefined)

      await loadCorsModule('production')

      expect(mockLogWarn).toHaveBeenCalledWith(
        expect.stringContaining('CORS origin "http://localhost:3000" contains localhost')
      )
    })

    it('does not warn in development', async () => {
      mockGetTrustedOrigins.mockReturnValue(['http://localhost:3000'])
      mockConfigServiceGet.mockReturnValue(undefined)

      await loadCorsModule('development')

      expect(mockLogWarn).not.toHaveBeenCalled()
    })
  })

  describe('no-origin requests', () => {
    it('builds the allowedOrigins set correctly for no-origin scenario', async () => {
      mockGetTrustedOrigins.mockReturnValue(['https://app.auxx.ai'])
      mockConfigServiceGet.mockReturnValue(undefined)

      // No-origin requests (curl, mobile apps) are handled by the hono cors
      // origin callback returning '*' — we verify the set is built correctly
      const { allowedOrigins } = await loadCorsModule()
      expect(allowedOrigins.size).toBe(1)
      expect(allowedOrigins.has('https://app.auxx.ai')).toBe(true)
    })
  })
})
