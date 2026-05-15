// packages/lib/src/ai/kopilot/capabilities/apps/__tests__/bridge.test.ts

import { describe, expect, it, vi } from 'vitest'
import { buildAppToolDigest } from '../digest'

vi.mock('../../../../cache', () => ({
  getOrgCache: () => ({
    get: vi.fn(async (_orgId: string, key: string) => {
      if (key === 'orgProfile') {
        return { id: 'org-1', name: 'Acme', handle: 'acme', domains: [] }
      }
      if (key === 'installedApps') return MOCK_INSTALLED_APPS
      return null
    }),
  }),
}))

vi.mock('@auxx/services/app-connections', () => ({
  resolveAppConnectionForRuntime: vi.fn(),
}))

vi.mock('@auxx/services/lambda-execution', () => ({
  invokeLambdaExecutor: vi.fn(),
  prepareLambdaContext: vi.fn((params) => ({ ...params })),
}))

vi.mock('../connection-resolver', () => ({
  getAppConnectionPresence: vi.fn(),
}))

// Set up varying scenarios per test.
let MOCK_INSTALLED_APPS: any[] = []

import { resolveAppConnectionForRuntime } from '@auxx/services/app-connections'
import { invokeLambdaExecutor } from '@auxx/services/lambda-execution'
import { getAppConnectionPresence } from '../connection-resolver'
import { createAppCapabilities } from '../index'

const SAMPLE_TOOL = {
  id: 'check_calendar_availability',
  name: 'Check calendar availability',
  description: 'Find free slots.',
  inputsJsonSchema: { type: 'object', properties: {} },
  outputsJsonSchema: { type: 'object', properties: {} },
  requiresConnection: true,
  connectionScope: 'user' as const,
  requiresApproval: false,
  timeoutMs: 15000,
  streaming: false,
  toolsetSlug: 'app:gog-calendar:availability',
  refs: [],
}

function buildInstallation(overrides: Partial<any> = {}) {
  return {
    installationId: 'inst-1',
    installationType: 'production',
    installedAt: new Date().toISOString(),
    app: {
      id: 'app-1',
      slug: 'gog-calendar',
      title: 'GCal',
      description: null,
      avatarUrl: null,
      category: null,
    },
    currentDeployment: {
      id: 'dep-1',
      version: '1.0.0',
      deploymentType: 'production',
      status: 'active',
      clientBundleSha: 'csha',
      serverBundleSha: 'ssha',
      createdAt: new Date().toISOString(),
    },
    aiTools: [SAMPLE_TOOL],
    aiToolsets: [],
    orgConnectionPresent: false,
    orgConnectionExpiresAt: null,
    ...overrides,
  }
}

describe('createAppCapabilities — registration filter', () => {
  it('hides user-scope tools when the user has no connection (decision A4)', async () => {
    MOCK_INSTALLED_APPS = [buildInstallation()]
    vi.mocked(getAppConnectionPresence).mockResolvedValue({ present: false, expiresAt: null })

    const capability = await createAppCapabilities({
      organizationId: 'org-1',
      userId: 'user-1',
    })

    expect(capability.tools).toHaveLength(0)
  })

  it('registers the tool when user-scope connection is present, with namespaced name', async () => {
    MOCK_INSTALLED_APPS = [buildInstallation()]
    vi.mocked(getAppConnectionPresence).mockResolvedValue({ present: true, expiresAt: null })

    const capability = await createAppCapabilities({
      organizationId: 'org-1',
      userId: 'user-1',
    })

    expect(capability.tools).toHaveLength(1)
    expect(capability.tools[0]?.name).toBe('gog_calendar_check_calendar_availability')
    expect(capability.tools[0]?.toolsetSlug).toBe('app:gog-calendar:availability')
  })

  it('hides user-scope tools on autonomous runs (userId=null) without DB hit', async () => {
    MOCK_INSTALLED_APPS = [buildInstallation()]

    const capability = await createAppCapabilities({
      organizationId: 'org-1',
      userId: null,
    })

    expect(capability.tools).toHaveLength(0)
    // No presence query should have fired — autonomous policy short-circuits.
    expect(vi.mocked(getAppConnectionPresence)).not.toHaveBeenCalled()
  })
})

describe('createAppCapabilities — execute() posts ai-tool to lambda', () => {
  it('forwards args + serverBundleSha + caller=kopilot to invokeLambdaExecutor', async () => {
    MOCK_INSTALLED_APPS = [buildInstallation()]
    vi.mocked(getAppConnectionPresence).mockResolvedValue({ present: true, expiresAt: null })
    vi.mocked(resolveAppConnectionForRuntime).mockResolvedValue({
      isErr: () => false,
      value: { userConnection: { id: 'cred-1', type: 'oauth2-code', value: 't' } },
    } as any)
    vi.mocked(invokeLambdaExecutor).mockResolvedValue({
      isErr: () => false,
      value: { execution_result: { busy: [], suggestions: [] } },
    } as any)

    const capability = await createAppCapabilities({
      organizationId: 'org-1',
      userId: 'user-1',
      sessionId: 'sess-1',
    })

    const result = await capability.tools[0]!.execute(
      { timeMin: '2026-05-14T00:00:00Z', timeMax: '2026-05-14T23:59:00Z' },
      {} as never
    )

    expect(result.success).toBe(true)
    expect(invokeLambdaExecutor).toHaveBeenCalledWith(
      expect.objectContaining({
        caller: 'kopilot',
        payload: expect.objectContaining({
          type: 'ai-tool',
          toolId: 'check_calendar_availability',
          serverBundleSha: 'ssha',
        }),
      })
    )
  })
})

describe('buildAppToolDigest', () => {
  it('walks ref descriptors and emits ResolvedRefs for entity-card mining', () => {
    const digest = buildAppToolDigest(
      { customer: { id: 'def_1:inst_2' }, items: [{ id: 'def_3:inst_4' }, { id: 'def_3:inst_5' }] },
      { appSlug: 'shopify', toolId: 'get_customer' },
      [
        { path: ['customer', 'id'], kind: 'contact' },
        { path: ['items', '[]', 'id'], kind: 'task' },
      ]
    )

    expect(digest.kind).toBe('app-tool')
    expect(digest.refs).toEqual([
      { kind: 'contact', value: 'def_1:inst_2' },
      { kind: 'task', value: 'def_3:inst_4' },
      { kind: 'task', value: 'def_3:inst_5' },
    ])
  })
})
