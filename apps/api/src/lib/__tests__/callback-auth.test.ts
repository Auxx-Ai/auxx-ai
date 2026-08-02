// apps/api/src/lib/__tests__/callback-auth.test.ts

/**
 * `verifyCallbackAuth` guards every `/api/v1/sdk/*` route. It previously fell
 * through to "installation ID only" whenever `LAMBDA_INVOKE_SECRET` was unset —
 * keyed on the env var rather than on `NODE_ENV`, so one missing variable
 * silently disabled SDK auth platform-wide, and `installationId` is a
 * caller-supplied header. These tests pin that it now fails closed outside
 * development.
 *
 * See plans/lambda/security/01-sandbox-hardening-plan.md §8 item 2 (A5).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockVerifyCallbackToken = vi.fn()

vi.mock('@auxx/credentials/lambda-auth', () => ({
  verifyCallbackToken: (...args: unknown[]) => mockVerifyCallbackToken(...args),
}))

import { verifyCallbackAuth } from '../callback-auth'

const INSTALLATION_ID = 'inst_1'
const ORG_ID = 'org_1'

/** Minimal Hono-ish context: header lookup + a `json` that records the status. */
function fakeContext(headers: Record<string, string>) {
  return {
    res: undefined as unknown,
    req: { header: (name: string) => headers[name] },
    json: (body: unknown, status: number) => ({ body, status }),
  } as never
}

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('verifyCallbackAuth — missing LAMBDA_INVOKE_SECRET', () => {
  it('fails closed with 500 in production', () => {
    process.env.NODE_ENV = 'production'
    process.env.LAMBDA_INVOKE_SECRET = undefined
    delete process.env.LAMBDA_INVOKE_SECRET

    const c = fakeContext({ 'X-App-Installation-Id': INSTALLATION_ID })
    const result = verifyCallbackAuth(c, 'storage')

    expect(result).toBeNull()
    expect((c as unknown as { res: { status: number } }).res.status).toBe(500)
  })

  it('fails closed when NODE_ENV is unset — absence is not development', () => {
    delete process.env.NODE_ENV
    delete process.env.LAMBDA_INVOKE_SECRET

    const c = fakeContext({ 'X-App-Installation-Id': INSTALLATION_ID })

    expect(verifyCallbackAuth(c, 'storage')).toBeNull()
    expect((c as unknown as { res: { status: number } }).res.status).toBe(500)
  })

  it('keeps the unverified fallback in development only', () => {
    process.env.NODE_ENV = 'development'
    delete process.env.LAMBDA_INVOKE_SECRET

    const c = fakeContext({ 'X-App-Installation-Id': INSTALLATION_ID })

    expect(verifyCallbackAuth(c, 'storage')).toEqual({
      installationId: INSTALLATION_ID,
      organizationId: '',
    })
  })
})

describe('verifyCallbackAuth — secret configured', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'production'
    process.env.LAMBDA_INVOKE_SECRET = 'signing-key'
  })

  it('rejects a request with no bearer token', () => {
    const c = fakeContext({ 'X-App-Installation-Id': INSTALLATION_ID })

    expect(verifyCallbackAuth(c, 'storage')).toBeNull()
    expect((c as unknown as { res: { status: number } }).res.status).toBe(401)
    expect(mockVerifyCallbackToken).not.toHaveBeenCalled()
  })

  it('rejects an invalid token', () => {
    mockVerifyCallbackToken.mockReturnValue({ valid: false, error: 'bad signature' })
    const c = fakeContext({
      'X-App-Installation-Id': INSTALLATION_ID,
      Authorization: 'Bearer nope',
    })

    expect(verifyCallbackAuth(c, 'storage')).toBeNull()
    expect((c as unknown as { res: { status: number } }).res.status).toBe(401)
  })

  it('returns the org from a verified token', () => {
    mockVerifyCallbackToken.mockReturnValue({ valid: true, organizationId: ORG_ID })
    const c = fakeContext({
      'X-App-Installation-Id': INSTALLATION_ID,
      Authorization: 'Bearer good',
    })

    expect(verifyCallbackAuth(c, 'storage')).toEqual({
      installationId: INSTALLATION_ID,
      organizationId: ORG_ID,
      connectionId: undefined,
    })
  })

  it('rejects a request with no installation id header', () => {
    const c = fakeContext({ Authorization: 'Bearer good' })

    expect(verifyCallbackAuth(c, 'storage')).toBeNull()
    expect((c as unknown as { res: { status: number } }).res.status).toBe(401)
  })
})
