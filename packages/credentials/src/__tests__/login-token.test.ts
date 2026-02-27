// packages/credentials/src/__tests__/login-token.test.ts

import { generateKeyPairSync } from 'node:crypto'
import { importPKCS8, SignJWT } from 'jose'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { issueLoginToken } from '../login-token/issue-login-token'
import { verifyLoginToken } from '../login-token/verify-login-token'

// Generate a real Ed25519 keypair for tests
const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const PRIVATE_KEY_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trim()
const PUBLIC_KEY_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString().trim()

// Generate a second keypair (wrong key — for tamper tests)
const { publicKey: wrongPublicKey } = generateKeyPairSync('ed25519')
const WRONG_PUBLIC_KEY_PEM = wrongPublicKey
  .export({ type: 'spki', format: 'pem' })
  .toString()
  .trim()

const TEST_OPTIONS = {
  userId: 'user_123',
  email: 'test@example.com',
  targetOrigin: 'https://build.auxx.ai',
  issuerOrigin: 'https://app.auxx.ai',
  returnTo: '/dashboard',
} as const

describe('login-token', () => {
  let originalPrivateKey: string | undefined
  let originalPublicKey: string | undefined

  beforeAll(() => {
    originalPrivateKey = process.env.LOGIN_TOKEN_PRIVATE_KEY
    originalPublicKey = process.env.LOGIN_TOKEN_PUBLIC_KEY
  })

  afterEach(() => {
    // Reset env vars between tests
    delete process.env.LOGIN_TOKEN_PRIVATE_KEY
    delete process.env.LOGIN_TOKEN_PUBLIC_KEY
  })

  afterAll(() => {
    // Restore original env vars
    if (originalPrivateKey !== undefined) {
      process.env.LOGIN_TOKEN_PRIVATE_KEY = originalPrivateKey
    }
    if (originalPublicKey !== undefined) {
      process.env.LOGIN_TOKEN_PUBLIC_KEY = originalPublicKey
    }
  })

  describe('issueLoginToken', () => {
    it('generates a valid JWT with all claims', async () => {
      process.env.LOGIN_TOKEN_PRIVATE_KEY = PRIVATE_KEY_PEM
      process.env.LOGIN_TOKEN_PUBLIC_KEY = PUBLIC_KEY_PEM

      const result = await issueLoginToken(TEST_OPTIONS)

      expect(result.isOk()).toBe(true)
      const { token, jti, expiresIn } = result._unsafeUnwrap()

      expect(typeof token).toBe('string')
      expect(token.split('.')).toHaveLength(3) // JWT has 3 parts
      expect(typeof jti).toBe('string')
      expect(jti).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/) // UUID format
      expect(expiresIn).toBe('10m')
    })

    it('fails without private key', async () => {
      // No LOGIN_TOKEN_PRIVATE_KEY set
      const result = await issueLoginToken(TEST_OPTIONS)

      expect(result.isErr()).toBe(true)
      const error = result._unsafeUnwrapErr()
      expect(error.code).toBe('MISSING_PRIVATE_KEY')
      expect(error.message).toContain('LOGIN_TOKEN_PRIVATE_KEY not configured')
    })

    it('respects custom expiresIn', async () => {
      process.env.LOGIN_TOKEN_PRIVATE_KEY = PRIVATE_KEY_PEM

      const result = await issueLoginToken({
        ...TEST_OPTIONS,
        expiresIn: '5m',
      })

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap().expiresIn).toBe('5m')
    })

    it('generates unique jti for each token', async () => {
      process.env.LOGIN_TOKEN_PRIVATE_KEY = PRIVATE_KEY_PEM

      const result1 = await issueLoginToken(TEST_OPTIONS)
      const result2 = await issueLoginToken(TEST_OPTIONS)

      expect(result1.isOk()).toBe(true)
      expect(result2.isOk()).toBe(true)
      expect(result1._unsafeUnwrap().jti).not.toBe(result2._unsafeUnwrap().jti)
    })

    it('handles escaped newlines in PEM key', async () => {
      // Simulate env var with escaped newlines (as stored in .env files)
      process.env.LOGIN_TOKEN_PRIVATE_KEY = PRIVATE_KEY_PEM.replace(/\n/g, '\\n')

      const result = await issueLoginToken(TEST_OPTIONS)
      expect(result.isOk()).toBe(true)
    })
  })

  describe('verifyLoginToken', () => {
    it('validates a legitimate token', async () => {
      process.env.LOGIN_TOKEN_PRIVATE_KEY = PRIVATE_KEY_PEM
      process.env.LOGIN_TOKEN_PUBLIC_KEY = PUBLIC_KEY_PEM

      const issueResult = await issueLoginToken(TEST_OPTIONS)
      expect(issueResult.isOk()).toBe(true)
      const { token } = issueResult._unsafeUnwrap()

      const verifyResult = await verifyLoginToken(token, TEST_OPTIONS.targetOrigin)

      expect(verifyResult.isOk()).toBe(true)
      const verified = verifyResult._unsafeUnwrap()
      expect(verified.userId).toBe(TEST_OPTIONS.userId)
      expect(verified.email).toBe(TEST_OPTIONS.email)
      expect(verified.targetOrigin).toBe(TEST_OPTIONS.targetOrigin)
      expect(verified.issuerOrigin).toBe(TEST_OPTIONS.issuerOrigin)
      expect(verified.returnTo).toBe(TEST_OPTIONS.returnTo)
      expect(typeof verified.jti).toBe('string')
    })

    it('rejects expired token', async () => {
      process.env.LOGIN_TOKEN_PUBLIC_KEY = PUBLIC_KEY_PEM

      // Manually craft a token that expired 5 minutes ago (well beyond 30s clock tolerance)
      const key = await importPKCS8(PRIVATE_KEY_PEM, 'EdDSA')
      const now = Math.floor(Date.now() / 1000)
      const expiredToken = await new SignJWT({
        email: 'test@example.com',
        returnTo: '/',
        type: 'login_token',
      } as Record<string, unknown>)
        .setProtectedHeader({ alg: 'EdDSA' })
        .setSubject('user_123')
        .setAudience(TEST_OPTIONS.targetOrigin)
        .setIssuer(TEST_OPTIONS.issuerOrigin)
        .setIssuedAt(now - 600)
        .setExpirationTime(now - 300) // Expired 5 minutes ago
        .sign(key)

      const verifyResult = await verifyLoginToken(expiredToken, TEST_OPTIONS.targetOrigin)

      expect(verifyResult.isErr()).toBe(true)
      const error = verifyResult._unsafeUnwrapErr()
      expect(error.code).toBe('TOKEN_EXPIRED')
    })

    it('rejects wrong audience', async () => {
      process.env.LOGIN_TOKEN_PUBLIC_KEY = PUBLIC_KEY_PEM

      // Manually craft a fresh token with explicit timestamps to avoid expiry issues
      const key = await importPKCS8(PRIVATE_KEY_PEM, 'EdDSA')
      const wrongAudienceToken = await new SignJWT({
        email: 'test@example.com',
        returnTo: '/',
        type: 'login_token',
      } as Record<string, unknown>)
        .setProtectedHeader({ alg: 'EdDSA' })
        .setSubject('user_123')
        .setAudience(TEST_OPTIONS.targetOrigin) // Issued for build.auxx.ai
        .setIssuer(TEST_OPTIONS.issuerOrigin)
        .setIssuedAt()
        .setExpirationTime('10m')
        .sign(key)

      // Verify with a different audience — should fail
      const verifyResult = await verifyLoginToken(wrongAudienceToken, 'https://wrong-app.auxx.ai')

      expect(verifyResult.isErr()).toBe(true)
      const error = verifyResult._unsafeUnwrapErr()
      expect(error.code).toBe('AUDIENCE_MISMATCH')
    })

    it('rejects tampered token (signed with different key)', async () => {
      process.env.LOGIN_TOKEN_PRIVATE_KEY = PRIVATE_KEY_PEM

      const issueResult = await issueLoginToken(TEST_OPTIONS)
      expect(issueResult.isOk()).toBe(true)
      const { token } = issueResult._unsafeUnwrap()

      // Use a different public key to verify — should fail signature check
      process.env.LOGIN_TOKEN_PUBLIC_KEY = WRONG_PUBLIC_KEY_PEM

      const verifyResult = await verifyLoginToken(token, TEST_OPTIONS.targetOrigin)

      expect(verifyResult.isErr()).toBe(true)
      expect(verifyResult._unsafeUnwrapErr().code).toBe('INVALID_TOKEN')
    })

    it('rejects token with corrupted payload', async () => {
      process.env.LOGIN_TOKEN_PUBLIC_KEY = PUBLIC_KEY_PEM

      // A completely invalid token string
      const verifyResult = await verifyLoginToken('not.a.valid.jwt', TEST_OPTIONS.targetOrigin)

      expect(verifyResult.isErr()).toBe(true)
      expect(verifyResult._unsafeUnwrapErr().code).toBe('INVALID_TOKEN')
    })

    it('fails without public key', async () => {
      // No LOGIN_TOKEN_PUBLIC_KEY set
      const verifyResult = await verifyLoginToken('some.token.here', TEST_OPTIONS.targetOrigin)

      expect(verifyResult.isErr()).toBe(true)
      const error = verifyResult._unsafeUnwrapErr()
      expect(error.code).toBe('MISSING_PUBLIC_KEY')
      expect(error.message).toContain('LOGIN_TOKEN_PUBLIC_KEY not configured')
    })

    it('handles escaped newlines in PEM key', async () => {
      process.env.LOGIN_TOKEN_PRIVATE_KEY = PRIVATE_KEY_PEM
      process.env.LOGIN_TOKEN_PUBLIC_KEY = PUBLIC_KEY_PEM

      const issueResult = await issueLoginToken(TEST_OPTIONS)
      const { token } = issueResult._unsafeUnwrap()

      // Verify with escaped newlines (as stored in .env files)
      process.env.LOGIN_TOKEN_PUBLIC_KEY = PUBLIC_KEY_PEM.replace(/\n/g, '\\n')

      const verifyResult = await verifyLoginToken(token, TEST_OPTIONS.targetOrigin)
      expect(verifyResult.isOk()).toBe(true)
    })

    it('rejects token with wrong type claim', async () => {
      process.env.LOGIN_TOKEN_PRIVATE_KEY = PRIVATE_KEY_PEM
      process.env.LOGIN_TOKEN_PUBLIC_KEY = PUBLIC_KEY_PEM

      // Manually craft a token with a wrong type
      const key = await importPKCS8(PRIVATE_KEY_PEM, 'EdDSA')
      const badToken = await new SignJWT({
        email: 'test@example.com',
        returnTo: '/',
        type: 'password_reset', // wrong type
      } as Record<string, unknown>)
        .setProtectedHeader({ alg: 'EdDSA' })
        .setSubject('user_123')
        .setAudience(TEST_OPTIONS.targetOrigin)
        .setIssuer(TEST_OPTIONS.issuerOrigin)
        .setIssuedAt()
        .setExpirationTime('10m')
        .sign(key)

      const verifyResult = await verifyLoginToken(badToken, TEST_OPTIONS.targetOrigin)

      expect(verifyResult.isErr()).toBe(true)
      expect(verifyResult._unsafeUnwrapErr().code).toBe('INVALID_TOKEN')
      expect(verifyResult._unsafeUnwrapErr().message).toBe('Invalid token type')
    })
  })

  describe('roundtrip', () => {
    it('issue → verify returns original claims', async () => {
      process.env.LOGIN_TOKEN_PRIVATE_KEY = PRIVATE_KEY_PEM
      process.env.LOGIN_TOKEN_PUBLIC_KEY = PUBLIC_KEY_PEM

      const issueResult = await issueLoginToken(TEST_OPTIONS)
      expect(issueResult.isOk()).toBe(true)
      const { token, jti } = issueResult._unsafeUnwrap()

      const verifyResult = await verifyLoginToken(token, TEST_OPTIONS.targetOrigin)
      expect(verifyResult.isOk()).toBe(true)

      const verified = verifyResult._unsafeUnwrap()
      expect(verified).toEqual({
        userId: TEST_OPTIONS.userId,
        email: TEST_OPTIONS.email,
        targetOrigin: TEST_OPTIONS.targetOrigin,
        issuerOrigin: TEST_OPTIONS.issuerOrigin,
        returnTo: TEST_OPTIONS.returnTo,
        jti,
      })
    })

    it('works with various returnTo paths', async () => {
      process.env.LOGIN_TOKEN_PRIVATE_KEY = PRIVATE_KEY_PEM
      process.env.LOGIN_TOKEN_PUBLIC_KEY = PUBLIC_KEY_PEM

      const paths = ['/', '/dashboard', '/settings/profile', '/apps/123/edit']

      for (const returnTo of paths) {
        const issueResult = await issueLoginToken({ ...TEST_OPTIONS, returnTo })
        expect(issueResult.isOk()).toBe(true)

        const verifyResult = await verifyLoginToken(
          issueResult._unsafeUnwrap().token,
          TEST_OPTIONS.targetOrigin
        )
        expect(verifyResult.isOk()).toBe(true)
        expect(verifyResult._unsafeUnwrap().returnTo).toBe(returnTo)
      }
    })
  })
})
