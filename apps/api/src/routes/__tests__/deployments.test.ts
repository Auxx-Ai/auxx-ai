// apps/api/src/routes/__tests__/deployments.test.ts

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const AUTHENTICATED_USER_ID = 'user_dev'
const TARGET_ORG_ID = 'org_target'

const mockVerifyOrgMembership = vi.fn()
const mockOnCacheEvent = vi.fn()
const mockInstallationInsert = vi.fn()

// Auth/scope middleware are replaced with pass-throughs: this test covers the
// route's own organization check, not token validation.
vi.mock('../../middleware/auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('userId', AUTHENTICATED_USER_ID)
    c.set('user', { id: AUTHENTICATED_USER_ID, email: 'dev@example.com' })
    c.set('scopes', ['developer', 'apps:write'])
    await next()
  },
}))

vi.mock('../../middleware/scope', () => ({
  requireScope: () => async (_c: any, next: any) => {
    await next()
  },
}))

// drizzle-orm predicate builders are stubbed because the database mock below
// ignores where-clauses entirely; the real builders would reject the fake
// column objects.
vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ _and: args }),
  eq: (a: unknown, b: unknown) => ({ _eq: [a, b] }),
}))

vi.mock('@auxx/database', () => {
  const column = new Proxy({}, { get: (_t, prop) => String(prop) })
  const schema = new Proxy({}, { get: () => column })

  const bundle = { id: 'bundle_1', uploadedAt: new Date() }
  const deployment = { id: 'deployment_1', version: null, status: 'active' }

  const tx = {
    delete: () => ({ where: async () => undefined }),
    insert: () =>
      ({
        values: (values: unknown) => {
          mockInstallationInsert(values)
          return Object.assign(Promise.resolve(undefined), {
            returning: async () => [deployment],
          })
        },
      }) as any,
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    query: {
      AppInstallation: { findFirst: async () => undefined },
    },
  }

  const database = {
    query: {
      AppBundle: { findFirst: async () => bundle },
      AppDeployment: { findFirst: async () => undefined },
      App: { findFirst: async () => undefined },
    },
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(tx),
    insert: tx.insert,
  }

  return { database, schema }
})

vi.mock('@auxx/services/developer-accounts', () => ({
  verifyAppAccess: async () => ok({ appId: 'app_1' }),
}))

vi.mock('@auxx/services/organization-members', () => ({
  verifyOrgMembership: (...args: unknown[]) => mockVerifyOrgMembership(...args),
}))

vi.mock('@auxx/services/app-versions', () => ({
  calculateNextVersion: async () => '1.0.0',
}))

vi.mock('@auxx/lib/apps', () => ({
  updateDeploymentStatus: vi.fn(),
}))

vi.mock('@auxx/lib/cache', () => ({
  invalidateAppCatalog: vi.fn(),
  invalidateOrgsByDeploymentId: vi.fn(),
  onCacheEvent: (...args: unknown[]) => mockOnCacheEvent(...args),
}))

vi.mock('@auxx/lib/data-connectors', () => ({
  restampWebhookBindingsForDeployment: vi.fn(),
}))

vi.mock('@auxx/utils/json', () => ({
  stableStringify: (value: unknown) => JSON.stringify(value ?? null),
}))

async function postDevDeployment(body: Record<string, unknown>) {
  const deployments = (await import('../deployments')).default
  return deployments.request('/app_1/deployments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
    body: JSON.stringify(body),
  })
}

const DEV_BODY = {
  clientBundleSha: 'client-sha',
  serverBundleSha: 'server-sha',
  deploymentType: 'development',
  targetOrganizationId: TARGET_ORG_ID,
}

describe('POST /:appId/deployments — development target organization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects a caller who is not a member of the target organization with 403', async () => {
    mockVerifyOrgMembership.mockResolvedValue(
      err({
        code: 'NOT_MEMBER' as const,
        message: 'not a member',
        userId: AUTHENTICATED_USER_ID,
        organizationId: TARGET_ORG_ID,
      })
    )

    const res = await postDevDeployment(DEV_BODY)

    expect(res.status).toBe(403)
    const json = (await res.json()) as any
    expect(json.error.code).toBe('ORG_ACCESS_DENIED')
    // Fail closed: nothing may be installed into the foreign org.
    expect(mockInstallationInsert).not.toHaveBeenCalled()
    expect(mockOnCacheEvent).not.toHaveBeenCalled()
  })

  it('allows a caller who is a member of the target organization', async () => {
    mockVerifyOrgMembership.mockResolvedValue(
      ok({ id: 'member_1', userId: AUTHENTICATED_USER_ID, organizationId: TARGET_ORG_ID })
    )

    const res = await postDevDeployment(DEV_BODY)

    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.deploymentId).toBe('deployment_1')
    expect(mockVerifyOrgMembership).toHaveBeenCalledWith({
      userId: AUTHENTICATED_USER_ID,
      organizationId: TARGET_ORG_ID,
    })
    expect(mockOnCacheEvent).toHaveBeenCalledWith('app.installed', { orgId: TARGET_ORG_ID })
  })

  it('rejects a development deployment with no targetOrganizationId with 400', async () => {
    const res = await postDevDeployment({ ...DEV_BODY, targetOrganizationId: undefined })

    expect(res.status).toBe(400)
    const json = (await res.json()) as any
    expect(json.error.code).toBe('BAD_REQUEST')
    expect(mockVerifyOrgMembership).not.toHaveBeenCalled()
  })

  it('surfaces a database failure as 500 rather than proceeding', async () => {
    mockVerifyOrgMembership.mockResolvedValue(
      err({ code: 'DATABASE_ERROR' as const, message: 'boom', cause: new Error('boom') })
    )

    const res = await postDevDeployment(DEV_BODY)

    expect(res.status).toBe(500)
    expect(mockInstallationInsert).not.toHaveBeenCalled()
  })
})
