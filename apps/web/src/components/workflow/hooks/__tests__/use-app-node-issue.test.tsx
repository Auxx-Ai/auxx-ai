// apps/web/src/components/workflow/hooks/__tests__/use-app-node-issue.test.tsx
//
// The resolver behind the node's warning badge, the workflow checklist and the
// publish gate. Two traps it exists to avoid:
//
//  - an UNINSTALLED app resolves `not_required` through
//    `deriveAppConnectionState` (which reads `requiresConnection` off the
//    installations list), so keying off the connection state alone reports no
//    issue at all for a node that cannot possibly run;
//  - a COLD LOAD has an empty installations list for a moment, which must not
//    be read as "not installed" or every app node flashes a publish-blocking
//    error on open.

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  context: undefined as unknown,
}))

vi.mock('~/components/apps/providers/apps-context', () => ({
  useAppsContext: () => h.context,
  useOptionalAppsContext: () => h.context,
}))

const { useAppNodeIssueResolver } = await import('../use-app-node-issue')

const APP_ID = 'app_ups'
const NODE = { type: `${APP_ID}:create-label`, appSlug: 'ups', title: 'Create label' }

function context({ installed = false, connections = [] as unknown[], isLoading = false } = {}) {
  return {
    appInstallations: installed
      ? [
          {
            app: { id: APP_ID, slug: 'ups', title: 'UPS' },
            installationId: 'inst_1',
            installationType: 'production',
            connectionDefinitions: { organization: { id: 'cd_1', label: 'UPS account' } },
          },
        ]
      : [],
    appConnections: connections,
    isLoading,
    isLoadingConnections: false,
  }
}

function connection(status: string) {
  return {
    id: 'cred_1',
    appId: APP_ID,
    isDefault: true,
    connectedAt: new Date(),
    connectionStatus: status,
    label: 'UPS prod',
  }
}

function resolve(data: unknown) {
  return renderHook(() => useAppNodeIssueResolver()).result.current(data)
}

beforeEach(() => {
  h.context = context()
})

describe('useAppNodeIssueResolver', () => {
  it('ignores core nodes — only `<appId>:<blockId>` types are app nodes', () => {
    expect(resolve({ type: 'ai' })).toBeNull()
    expect(resolve(null)).toBeNull()
  })

  it('stays silent while installations are still loading', () => {
    h.context = context({ isLoading: true })

    expect(resolve(NODE)).toBeNull()
  })

  it('stays silent outside an AppsProvider — the public viewer knows nothing', () => {
    h.context = undefined

    expect(resolve(NODE)).toBeNull()
  })

  it('reports an ERROR for an uninstalled app, where the connection state says `not_required`', () => {
    expect(resolve(NODE)).toMatchObject({ field: '_installation', type: 'error' })
    expect(resolve(NODE)?.message).toContain('ups')
  })

  it('resolves the app from the type string when `appId` was never persisted', () => {
    expect(resolve({ type: `${APP_ID}:create-label` })).toMatchObject({ type: 'error' })
  })

  it('reports a missing connection as an error once the app IS installed', () => {
    h.context = context({ installed: true })

    expect(resolve(NODE)).toMatchObject({ field: '_connection', type: 'error' })
  })

  it('reports an expired connection as a warning — it heals on the next run', () => {
    h.context = context({ installed: true, connections: [connection('expired')] })

    expect(resolve(NODE)).toMatchObject({ field: '_connection', type: 'warning' })
  })

  it('reports nothing once installed and connected', () => {
    h.context = context({ installed: true, connections: [connection('connected')] })

    expect(resolve(NODE)).toBeNull()
  })
})
