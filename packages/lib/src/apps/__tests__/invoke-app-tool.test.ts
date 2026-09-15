// packages/lib/src/apps/__tests__/invoke-app-tool.test.ts
//
// The slug-parameterised app-tool resolver (brief 27 §5): no installation is
// `connected: false`, and a resolved handle drives the Lambda executor with the
// `integration-sync` caller, the 30s timeout and the app's label in every
// error, carrying `code`/`statusCode`/`details` through the throw.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  installedApps: [] as unknown[],
  findFirst: vi.fn(async (_args: unknown): Promise<unknown> => ({ handle: 'acme' })),
  getInstallationDeployment: vi.fn(
    async (_input: unknown): Promise<unknown> => ({
      isErr: () => false,
      value: { serverBundleSha: 'sha_1', installation: { id: 'inst_1' } },
    })
  ),
  resolveAppConnectionForRuntime: vi.fn(
    async (_input: unknown): Promise<unknown> => ({
      isErr: () => false,
      value: {
        organizationConnection: { id: 'cred_org', metadata: { realmId: 'realm_1' } },
        userConnection: undefined,
      },
    })
  ),
  prepareLambdaContext: vi.fn((_input: unknown) => ({ prepared: true })),
  invokeLambdaExecutor: vi.fn(
    async (_params: unknown): Promise<unknown> => ({
      isErr: () => false,
      value: { execution_result: { data: { payouts: [] } } },
    })
  ),
}))

vi.mock('@auxx/database', () => ({
  database: { query: { Organization: { findFirst: h.findFirst } } },
}))
vi.mock('../../cache', () => ({
  getCachedInstalledApps: async () => h.installedApps,
  getOrgCache: () => ({ get: async () => 'user_system' }),
}))
vi.mock('../installations/get-installation-deployment', () => ({
  getInstallationDeployment: h.getInstallationDeployment,
}))
vi.mock('../connections/resolve-app-connection-for-runtime', () => ({
  resolveAppConnectionForRuntime: h.resolveAppConnectionForRuntime,
}))
vi.mock('../lambda', () => ({
  prepareLambdaContext: h.prepareLambdaContext,
  invokeLambdaExecutor: h.invokeLambdaExecutor,
}))

import { resolveAppToolContext } from '../invoke-app-tool'

const ORG = 'org_1'
const SHOPIFY_INSTALL = {
  installationId: 'inst_1',
  app: { id: 'app_shopify', slug: 'shopify', title: 'Shopify' },
}

beforeEach(() => {
  vi.clearAllMocks()
  h.installedApps = [SHOPIFY_INSTALL]
})

describe('resolveAppToolContext', () => {
  it('answers connected: false for a slug with no installation, before touching the database', async () => {
    h.installedApps = [{ installationId: 'inst_qb', app: { id: 'app_qb', slug: 'quickbooks' } }]

    const result = await resolveAppToolContext({ organizationId: ORG, appSlug: 'shopify' })

    expect(result).toEqual({ connected: false })
    expect(h.findFirst).not.toHaveBeenCalled()
    expect(h.getInstallationDeployment).not.toHaveBeenCalled()
  })

  it('answers connected: false when the app has neither an org nor a user connection', async () => {
    h.resolveAppConnectionForRuntime.mockResolvedValueOnce({
      isErr: () => false,
      value: { organizationConnection: undefined, userConnection: undefined },
    })

    const result = await resolveAppToolContext({ organizationId: ORG, appSlug: 'shopify' })

    expect(result).toEqual({ connected: false })
  })

  it('resolves the chain once and hands back the installation, connection, user and metadata', async () => {
    const result = await resolveAppToolContext({ organizationId: ORG, appSlug: 'shopify' })

    expect(result.connected).toBe(true)
    if (!result.connected) return
    expect(result.context).toMatchObject({
      organizationId: ORG,
      appSlug: 'shopify',
      installationId: 'inst_1',
      connectionId: 'cred_org',
      userId: 'user_system',
      connectionMetadata: { realmId: 'realm_1' },
    })
    expect(h.getInstallationDeployment).toHaveBeenCalledWith({
      installationId: 'inst_1',
      organizationHandle: 'acme',
      appId: 'app_shopify',
    })
    // The entities scope is opt-in: a read-only tool set never gets it by accident.
    expect(h.prepareLambdaContext).toHaveBeenCalledWith(
      expect.objectContaining({ includeEntitiesScope: false, userId: 'user_system' })
    )
  })

  it('drives the executor as integration-sync with the 30s timeout and unwraps the data', async () => {
    const result = await resolveAppToolContext({ organizationId: ORG, appSlug: 'shopify' })
    if (!result.connected) throw new Error('expected a connection')

    const data = await result.context.callTool('list_shopify_payouts', { since: '2026-09-01' })

    expect(data).toEqual({ payouts: [] })
    expect(h.invokeLambdaExecutor).toHaveBeenCalledWith({
      caller: 'integration-sync',
      payload: {
        type: 'tool',
        serverBundleSha: 'sha_1',
        toolId: 'list_shopify_payouts',
        inputs: { since: '2026-09-01' },
        context: { prepared: true },
        timeout: 30_000,
      },
    })
  })

  it('names the app in a failed call and carries code, statusCode and details on the throw', async () => {
    h.invokeLambdaExecutor.mockResolvedValueOnce({
      isErr: () => true,
      error: {
        code: 'INSUFFICIENT_PERMISSIONS',
        statusCode: 403,
        message: 'lacks the permission',
        details: { requiredScopes: ['read_shopify_payments_payouts'] },
      },
    })
    const result = await resolveAppToolContext({
      organizationId: ORG,
      appSlug: 'shopify',
      appLabel: 'Shopify',
    })
    if (!result.connected) throw new Error('expected a connection')

    const attempt = result.context.callTool('list_shopify_payouts', {})

    await expect(attempt).rejects.toThrow(
      'Shopify tool list_shopify_payouts failed: lacks the permission'
    )
    await expect(attempt).rejects.toMatchObject({
      code: 'INSUFFICIENT_PERMISSIONS',
      statusCode: 403,
      details: { requiredScopes: ['read_shopify_payments_payouts'] },
    })
  })
})
