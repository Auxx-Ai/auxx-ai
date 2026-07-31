// packages/lib/src/ai/kopilot/capabilities/apps/__tests__/bridge.test.ts

import { describe, expect, it, vi } from 'vitest'
import { runTool } from '../../../../agent-framework/__test-helpers'
import { buildAppToolDigest } from '../digest'

vi.mock('../../../../../cache', () => ({
  getOrgCache: () => ({
    get: vi.fn(async (_orgId: string, key: string) => {
      if (key === 'orgProfile') {
        return { id: 'org-1', name: 'Acme', handle: 'acme', domains: [] }
      }
      if (key === 'installedApps') return MOCK_INSTALLED_APPS
      if (key === 'orgSettings') return MOCK_ORG_SETTINGS
      return null
    }),
  }),
  // Per plans/kopilot/apps/agent-credentials.md the bridge now also reads
  // the agent's appAccounts via getCachedAgentById. Tests don't exercise
  // the agent path (no agentId passed), but the import must resolve.
  getCachedAgentById: vi.fn(async () => null),
}))

vi.mock('../../../../../apps/connections/resolve-app-connection-for-runtime', () => ({
  resolveAppConnectionForRuntime: vi.fn(),
}))

vi.mock('../../../../../apps/connections/mark-app-connection-expired', () => ({
  markAppConnectionExpired: vi.fn(),
}))

vi.mock('../../../../../apps/execution-log', () => ({
  logAppExecution: vi.fn(),
}))

vi.mock('../../../../../apps/lambda', () => ({
  invokeLambdaExecutor: vi.fn(),
  invokeLambdaExecutorStreaming: vi.fn(),
  prepareLambdaContext: vi.fn((params) => ({ ...params })),
}))

// Set up varying scenarios per test.
let MOCK_INSTALLED_APPS: any[] = []
let MOCK_ORG_SETTINGS: Record<string, unknown> = {}

import { resolveAppConnectionForRuntime } from '../../../../../apps/connections/resolve-app-connection-for-runtime'
import { invokeLambdaExecutor } from '../../../../../apps/lambda'
import { createAppCapabilities } from '../index'

const SAMPLE_TOOL = {
  id: 'check_calendar_availability',
  name: 'Check calendar availability',
  description: 'Find free slots.',
  agentName: 'check_calendar_availability',
  agentDescription: 'Find free slots.',
  inputsJsonSchema: { type: 'object', properties: {} },
  outputsJsonSchema: { type: 'object', properties: {} },
  requiresConnection: true,
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
    agentTools: [SAMPLE_TOOL],
    agentToolsets: [],
    orgConnectionPresent: false,
    orgConnectionExpiresAt: null,
    ...overrides,
  }
}

describe('createAppCapabilities — registration filter (master Kopilot)', () => {
  it('hides app tools when `kopilot.appAccounts` has no binding for the app', async () => {
    MOCK_INSTALLED_APPS = [buildInstallation()]
    MOCK_ORG_SETTINGS = { 'kopilot.appAccounts': {} }

    const capability = await createAppCapabilities({
      organizationId: 'org-1',
      userId: 'user-1',
    })

    expect(capability.tools).toHaveLength(0)
  })

  it('registers the tool when `kopilot.appAccounts[appId].credId` is pinned', async () => {
    MOCK_INSTALLED_APPS = [buildInstallation()]
    MOCK_ORG_SETTINGS = { 'kopilot.appAccounts': { 'app-1': { credId: 'cred-1' } } }

    const capability = await createAppCapabilities({
      organizationId: 'org-1',
      userId: 'user-1',
    })

    expect(capability.tools).toHaveLength(1)
    expect(capability.tools[0]?.name).toBe('gog_calendar_check_calendar_availability')
    expect(capability.tools[0]?.toolsetSlug).toBe('app:gog-calendar:availability')
  })

  it('hides app tools on autonomous master runs without a binding', async () => {
    MOCK_INSTALLED_APPS = [buildInstallation()]
    MOCK_ORG_SETTINGS = { 'kopilot.appAccounts': {} }

    const capability = await createAppCapabilities({
      organizationId: 'org-1',
      userId: null,
    })

    expect(capability.tools).toHaveLength(0)
  })
})

describe('createAppCapabilities — execute() posts tool event to lambda', () => {
  it('forwards args + serverBundleSha + caller=kopilot to invokeLambdaExecutor', async () => {
    MOCK_INSTALLED_APPS = [buildInstallation()]
    MOCK_ORG_SETTINGS = { 'kopilot.appAccounts': { 'app-1': { credId: 'cred-1' } } }
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

    const args = { timeMin: '2026-05-14T00:00:00Z', timeMax: '2026-05-14T23:59:00Z' }
    const result = await runTool(capability.tools[0]!, args)

    expect(result.success).toBe(true)
    expect(invokeLambdaExecutor).toHaveBeenCalledWith(
      expect.objectContaining({
        caller: 'kopilot',
        payload: expect.objectContaining({
          type: 'tool',
          toolId: 'check_calendar_availability',
          serverBundleSha: 'ssha',
          inputs: args,
          invocationContext: expect.objectContaining({
            kind: 'agent',
            sessionId: 'sess-1',
            agentId: null,
            triggerId: null,
          }),
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
