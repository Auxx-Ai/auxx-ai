// packages/credentials/src/lambda-auth/__tests__/callback-token.test.ts

import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createCallbackToken, verifyCallbackToken } from '../callback-token'

const TEST_SECRET = 'test-callback-secret-for-hmac-signing'

/** Forge a token payload directly (bypassing `createCallbackToken`) so tests can assert on malformed shapes. */
function signPayload(data: string, secret: string): string {
  const mac = createHmac('sha256', secret).update(`callback:v1:${data}`).digest('hex')
  return Buffer.from(`${data}.${mac}`).toString('base64url')
}

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

  describe('keyed optional claims', () => {
    it('round-trips connectionId alone', () => {
      const token = createCallbackToken({
        installationId: 'inst_123',
        organizationId: 'org_456',
        scope: 'entities',
        secret: TEST_SECRET,
        connectionId: 'conn_1',
      })

      const result = verifyCallbackToken({
        token,
        expectedInstallationId: 'inst_123',
        expectedScope: 'entities',
        secret: TEST_SECRET,
      })

      expect(result.valid).toBe(true)
      expect(result.connectionId).toBe('conn_1')
      expect(result.userId).toBeUndefined()
    })

    it('round-trips userId alone', () => {
      const token = createCallbackToken({
        installationId: 'inst_123',
        organizationId: 'org_456',
        scope: 'entities',
        secret: TEST_SECRET,
        userId: 'usr_1',
      })

      const result = verifyCallbackToken({
        token,
        expectedInstallationId: 'inst_123',
        expectedScope: 'entities',
        secret: TEST_SECRET,
      })

      expect(result.valid).toBe(true)
      expect(result.userId).toBe('usr_1')
      expect(result.connectionId).toBeUndefined()
    })

    it('round-trips connectionId and userId together, order-independent of minting', () => {
      const token = createCallbackToken({
        installationId: 'inst_123',
        organizationId: 'org_456',
        scope: 'entities',
        secret: TEST_SECRET,
        connectionId: 'conn_1',
        userId: 'usr_1',
      })

      const result = verifyCallbackToken({
        token,
        expectedInstallationId: 'inst_123',
        expectedScope: 'entities',
        secret: TEST_SECRET,
      })

      expect(result.valid).toBe(true)
      expect(result.connectionId).toBe('conn_1')
      expect(result.userId).toBe('usr_1')
    })

    it('carries neither claim when neither is minted (webhooks/settings, unchanged 5-field form)', () => {
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
      expect(result.connectionId).toBeUndefined()
      expect(result.userId).toBeUndefined()
    })

    it('rejects an unknown optional claim key', () => {
      const data = `entities:inst_123:org_456:${Date.now() + 60_000}:nonce:x=evil`
      const forgedToken = signPayload(data, TEST_SECRET)

      const result = verifyCallbackToken({
        token: forgedToken,
        expectedInstallationId: 'inst_123',
        expectedScope: 'entities',
        secret: TEST_SECRET,
      })

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Malformed token payload')
    })

    it('rejects a duplicate claim key', () => {
      const data = `entities:inst_123:org_456:${Date.now() + 60_000}:nonce:c=conn_1:c=conn_2`
      const forgedToken = signPayload(data, TEST_SECRET)

      const result = verifyCallbackToken({
        token: forgedToken,
        expectedInstallationId: 'inst_123',
        expectedScope: 'entities',
        secret: TEST_SECRET,
      })

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Malformed token payload')
    })

    it('rejects a claim with no `=`', () => {
      const data = `entities:inst_123:org_456:${Date.now() + 60_000}:nonce:garbage`
      const forgedToken = signPayload(data, TEST_SECRET)

      const result = verifyCallbackToken({
        token: forgedToken,
        expectedInstallationId: 'inst_123',
        expectedScope: 'entities',
        secret: TEST_SECRET,
      })

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Malformed token payload')
    })
  })
})
