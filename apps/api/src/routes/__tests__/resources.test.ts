// apps/api/src/routes/__tests__/resources.test.ts

import { Hono } from 'hono'
import { err, ok } from 'neverthrow'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const SESSION_USER_ID = 'user_session'
const TOKEN_USER_ID = 'user_token'
const ORG_ID = 'org_1'
const ORG_HANDLE = 'acme'
const INSTALLATION_ID = 'inst_1'

const mockVerifyOrganizationAccess = vi.fn()
const mockVerifyCallbackAuth = vi.fn()
const mockGetCapabilities = vi.fn()
const mockListResourcesFor = vi.fn()
const mockGetResourceFor = vi.fn()

vi.setConfig({ testTimeout: 20_000 })

// Same harness as records.test.ts: the real early-out in authMiddleware, a
// stub organizationMiddleware, and the sibling route modules stubbed out.
vi.mock('../../middleware/auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    if (c.get('userId')) return next()
    c.set('userId', SESSION_USER_ID)
    c.set('user', { id: SESSION_USER_ID, email: 'dev@example.com' })
    await next()
  },
}))

vi.mock('../../middleware/organization', () => ({
  organizationMiddleware: async (c: any, next: any) => {
    c.set('organizationId', ORG_ID)
    c.set('organization', { id: ORG_ID, handle: ORG_HANDLE })
    await next()
  },
}))

vi.mock('../../lib/callback-auth', () => ({
  verifyCallbackAuth: (...args: unknown[]) => mockVerifyCallbackAuth(...args),
}))

vi.mock('@auxx/services/organizations', () => ({
  verifyOrganizationAccess: (...args: unknown[]) => mockVerifyOrganizationAccess(...args),
}))

vi.mock('@auxx/lib/permissions', () => ({
  getCapabilities: (...args: unknown[]) => mockGetCapabilities(...args),
}))

vi.mock('@auxx/lib/resources', () => ({
  UnifiedCrudHandler: class {},
  listResourcesFor: (...args: unknown[]) => mockListResourcesFor(...args),
  getResourceFor: (...args: unknown[]) => mockGetResourceFor(...args),
}))

vi.mock('@auxx/database', () => {
  const column = new Proxy({}, { get: (_t, prop) => String(prop) })
  const schema = new Proxy({}, { get: () => column })
  return { database: {}, schema }
})

vi.mock('../organizations/apps', () => ({ default: new Hono() }))
vi.mock('../organizations/bundles', () => ({ default: new Hono() }))
vi.mock('../organizations/execute-server-function', () => ({ default: new Hono() }))

let organizationsApp: typeof import('../organizations').default
beforeAll(async () => {
  organizationsApp = (await import('../organizations')).default
}, 60_000)

const CAPS = { hasDefPresence: () => true }
const CONTACT = {
  id: 'contact',
  entityDefinitionId: 'def_contact',
  apiSlug: 'contacts',
  fields: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetCapabilities.mockResolvedValue(CAPS)
})

describe('GET /:handle/resources — session principal', () => {
  it('lists resources under the session user’s capabilities', async () => {
    mockListResourcesFor.mockResolvedValue([CONTACT])

    const res = await organizationsApp.request(`/${ORG_HANDLE}/resources`)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([CONTACT])
    expect(mockGetCapabilities).toHaveBeenCalledWith(SESSION_USER_ID, ORG_ID)
    expect(mockListResourcesFor).toHaveBeenCalledWith(ORG_ID, CAPS)
  })

  it('resolves one resource by slug and 404s when hidden or missing', async () => {
    mockGetResourceFor.mockResolvedValueOnce(CONTACT).mockResolvedValueOnce(null)

    const found = await organizationsApp.request(`/${ORG_HANDLE}/resources/contacts`)
    expect(found.status).toBe(200)
    expect(mockGetResourceFor).toHaveBeenCalledWith(ORG_ID, CAPS, 'contacts')

    const hidden = await organizationsApp.request(`/${ORG_HANDLE}/resources/def_secret`)
    expect(hidden.status).toBe(404)
  })
})

describe('GET /:handle/resources — callback-token principal', () => {
  const tokenHeaders = { 'X-App-Installation-Id': INSTALLATION_ID, Authorization: 'Bearer tok' }

  it('reads as the token’s user when the token carries one', async () => {
    mockVerifyCallbackAuth.mockReturnValue({
      installationId: INSTALLATION_ID,
      organizationId: ORG_ID,
      userId: TOKEN_USER_ID,
    })
    mockVerifyOrganizationAccess.mockResolvedValue(
      ok({ organization: { id: ORG_ID, handle: ORG_HANDLE } })
    )
    mockListResourcesFor.mockResolvedValue([])

    const res = await organizationsApp.request(`/${ORG_HANDLE}/resources`, {
      headers: tokenHeaders,
    })

    expect(res.status).toBe(200)
    expect(mockGetCapabilities).toHaveBeenCalledWith(TOKEN_USER_ID, ORG_ID)
  })

  it('refuses a token with no user', async () => {
    mockVerifyCallbackAuth.mockReturnValue({
      installationId: INSTALLATION_ID,
      organizationId: ORG_ID,
    })

    const res = await organizationsApp.request(`/${ORG_HANDLE}/resources/contacts`, {
      headers: tokenHeaders,
    })

    expect(res.status).toBe(401)
    expect(mockGetResourceFor).not.toHaveBeenCalled()
  })

  it('refuses a token minted for another org', async () => {
    mockVerifyCallbackAuth.mockReturnValue({
      installationId: INSTALLATION_ID,
      organizationId: 'org_other',
      userId: TOKEN_USER_ID,
    })
    mockVerifyOrganizationAccess.mockResolvedValue(
      ok({ organization: { id: ORG_ID, handle: ORG_HANDLE } })
    )

    const res = await organizationsApp.request(`/${ORG_HANDLE}/resources`, {
      headers: tokenHeaders,
    })

    expect(res.status).toBe(401)
  })

  it('refuses a token user who is not a member', async () => {
    mockVerifyCallbackAuth.mockReturnValue({
      installationId: INSTALLATION_ID,
      organizationId: ORG_ID,
      userId: TOKEN_USER_ID,
    })
    mockVerifyOrganizationAccess.mockResolvedValue(err({ code: 'FORBIDDEN' }))

    const res = await organizationsApp.request(`/${ORG_HANDLE}/resources`, {
      headers: tokenHeaders,
    })

    expect(res.status).toBe(401)
  })
})
