// apps/api/src/routes/__tests__/installations.test.ts

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const AUTHENTICATED_USER_ID = 'user_dev'
const TARGET_ORG_ID = 'org_target'

const mockVerifyOrgMembership = vi.fn()
const mockGetDevInstallation = vi.fn()

// Auth/scope middleware are replaced with pass-throughs: this test covers the
// route's own organization check, not token validation.
vi.mock('../../middleware/auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('userId', AUTHENTICATED_USER_ID)
    c.set('user', { id: AUTHENTICATED_USER_ID, email: 'dev@example.com' })
    c.set('scopes', ['developer', 'apps:read'])
    await next()
  },
}))

vi.mock('../../middleware/scope', () => ({
  requireScope: () => async (_c: any, next: any) => {
    await next()
  },
}))

vi.mock('@auxx/services/developer-accounts', () => ({
  verifyAppAccess: async () => ok({ appId: 'app_1' }),
}))

vi.mock('@auxx/services/organization-members', () => ({
  verifyOrgMembership: (...args: unknown[]) => mockVerifyOrgMembership(...args),
}))

vi.mock('@auxx/services/app-installations', () => ({
  getDevInstallation: (...args: unknown[]) => mockGetDevInstallation(...args),
}))

async function getDevInstallationRequest(organizationId = TARGET_ORG_ID) {
  const installations = (await import('../installations')).default
  return installations.request(`/app_1/organization/${organizationId}/dev-installation`, {
    method: 'GET',
    headers: { Authorization: 'Bearer test' },
  })
}

describe('GET /:appId/organization/:organizationId/dev-installation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetDevInstallation.mockResolvedValue(ok({ appId: 'app_1', organizationId: TARGET_ORG_ID }))
  })

  it('rejects a caller who is not a member of the organization with 403', async () => {
    mockVerifyOrgMembership.mockResolvedValue(
      err({
        code: 'NOT_MEMBER',
        message: 'not a member',
        userId: AUTHENTICATED_USER_ID,
        organizationId: TARGET_ORG_ID,
      })
    )

    const res = await getDevInstallationRequest()

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: { code: 'ORG_ACCESS_DENIED' } })
    // The existence oracle must not run at all for a non-member.
    expect(mockGetDevInstallation).not.toHaveBeenCalled()
  })

  it('allows a caller who is a member of the organization', async () => {
    mockVerifyOrgMembership.mockResolvedValue(
      ok({ id: 'member_1', userId: AUTHENTICATED_USER_ID, organizationId: TARGET_ORG_ID })
    )

    const res = await getDevInstallationRequest()

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ appId: 'app_1', organizationId: TARGET_ORG_ID })
    expect(mockGetDevInstallation).toHaveBeenCalledWith({
      appId: 'app_1',
      organizationId: TARGET_ORG_ID,
    })
  })

  it('surfaces a database failure as 500 rather than proceeding', async () => {
    mockVerifyOrgMembership.mockResolvedValue(
      err({ code: 'DATABASE_ERROR', message: 'connection lost' })
    )

    const res = await getDevInstallationRequest()

    expect(res.status).toBe(500)
    expect(mockGetDevInstallation).not.toHaveBeenCalled()
  })
})
