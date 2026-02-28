// packages/credentials/src/lambda-auth/__tests__/callback-token.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCallbackToken, verifyCallbackToken } from '../callback-token'

const TEST_SECRET = 'test-callback-secret-for-hmac-signing'

describe('callback-token', () => {
  describe('round-trip', () => {
    it('create + verify succeeds with matching params', () => {
      const token = createCallbackToken({
        installationId: 'inst_123',
        organizationId: 'org_456',
        scope: 'webhooks',
        secret: TEST_SECRET,
      })

      const result = verifyCallbackToken({
        token,
        expectedInstallationId: 'inst_123',
        expectedScope: 'webhooks',
        secret: TEST_SECRET,
      })

      expect(result.valid).toBe(true)
      expect(result.organizationId).toBe('org_456')
      expect(result.error).toBeUndefined()
    })

    it('works for settings scope', () => {
      const token = createCallbackToken({
        installationId: 'inst_789',
        organizationId: 'org_abc',
        scope: 'settings',
        secret: TEST_SECRET,
      })

      const result = verifyCallbackToken({
        token,
        expectedInstallationId: 'inst_789',
        expectedScope: 'settings',
        secret: TEST_SECRET,
      })

      expect(result.valid).toBe(true)
      expect(result.organizationId).toBe('org_abc')
    })
  })

  describe('rejection cases', () => {
    it('rejects expired token', () => {
      const token = createCallbackToken({
        installationId: 'inst_123',
        organizationId: 'org_456',
        scope: 'webhooks',
        secret: TEST_SECRET,
        ttlMs: -1, // Already expired
      })

      const result = verifyCallbackToken({
        token,
        expectedInstallationId: 'inst_123',
        expectedScope: 'webhooks',
        secret: TEST_SECRET,
      })

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Token expired')
    })

    it('rejects wrong installation ID', () => {
      const token = createCallbackToken({
        installationId: 'inst_123',
        organizationId: 'org_456',
        scope: 'webhooks',
        secret: TEST_SECRET,
      })

      const result = verifyCallbackToken({
        token,
        expectedInstallationId: 'inst_WRONG',
        expectedScope: 'webhooks',
        secret: TEST_SECRET,
      })

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Installation ID mismatch')
    })

    it('rejects wrong scope', () => {
      const token = createCallbackToken({
        installationId: 'inst_123',
        organizationId: 'org_456',
        scope: 'webhooks',
        secret: TEST_SECRET,
      })

      const result = verifyCallbackToken({
        token,
        expectedInstallationId: 'inst_123',
        expectedScope: 'settings',
        secret: TEST_SECRET,
      })

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Scope mismatch')
    })

    it('rejects tampered token', () => {
      const token = createCallbackToken({
        installationId: 'inst_123',
        organizationId: 'org_456',
        scope: 'webhooks',
        secret: TEST_SECRET,
      })

      // Tamper by changing a character
      const tampered = `${token.slice(0, -2)}xx`

      const result = verifyCallbackToken({
        token: tampered,
        expectedInstallationId: 'inst_123',
        expectedScope: 'webhooks',
        secret: TEST_SECRET,
      })

      expect(result.valid).toBe(false)
    })

    it('rejects wrong secret', () => {
      const token = createCallbackToken({
        installationId: 'inst_123',
        organizationId: 'org_456',
        scope: 'webhooks',
        secret: TEST_SECRET,
      })

      const result = verifyCallbackToken({
        token,
        expectedInstallationId: 'inst_123',
        expectedScope: 'webhooks',
        secret: 'wrong-secret',
      })

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid token signature')
    })

    it('rejects malformed token (not base64)', () => {
      const result = verifyCallbackToken({
        token: 'not-a-valid-token!!!',
        expectedInstallationId: 'inst_123',
        expectedScope: 'webhooks',
        secret: TEST_SECRET,
      })

      expect(result.valid).toBe(false)
    })

    it('rejects empty token', () => {
      const result = verifyCallbackToken({
        token: '',
        expectedInstallationId: 'inst_123',
        expectedScope: 'webhooks',
        secret: TEST_SECRET,
      })

      expect(result.valid).toBe(false)
    })
  })
})
