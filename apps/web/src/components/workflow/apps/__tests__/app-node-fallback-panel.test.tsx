// apps/web/src/components/workflow/apps/__tests__/app-node-fallback-panel.test.tsx
//
// The panel an app node falls back to when the registry has no definition for
// its block. Three causes, three different answers — collapsing them is what
// leaves a user staring at a dead node with no idea whether to install
// something, wait, or replace the step.

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  context: undefined as unknown,
  registryEntries: [] as Array<[string, unknown]>,
  details: undefined as unknown,
}))

vi.mock('~/components/apps/providers/apps-context', () => ({
  useAppsContext: () => h.context,
  useOptionalAppsContext: () => h.context,
}))
vi.mock('~/components/workflow/hooks/use-registry', () => ({ useRegistryVersion: () => 0 }))
vi.mock('~/components/workflow/nodes/unified-registry', () => ({
  unifiedNodeRegistry: { getAllEntries: () => h.registryEntries },
}))
vi.mock('~/components/workflow/nodes/shared/base/base-panel', () => ({
  BasePanel: ({ title, children }: { title?: string; children: React.ReactNode }) => (
    <div data-testid='base-panel'>
      <div data-testid='panel-title'>{title}</div>
      {children}
    </div>
  ),
}))
vi.mock('~/components/apps/ui/app-install-card', () => ({
  AppInstallCard: ({ appSlug }: { appSlug: string }) => (
    <div data-testid='install-card'>{appSlug}</div>
  ),
}))
vi.mock('~/components/apps/ui/app-icon', () => ({ AppIcon: () => <div data-testid='app-icon' /> }))
vi.mock('~/components/apps/ui/app-about', () => ({ CapabilityBadge: () => null }))
vi.mock('~/trpc/react', () => ({
  api: { apps: { getBySlug: { useQuery: () => ({ data: h.details, isLoading: false }) } } },
}))

const { AppNodeFallbackPanel } = await import('../app-node-fallback-panel')

const APP_ID = 'app_ups'
const NODE = { type: `${APP_ID}:create-label`, appSlug: 'ups', title: 'Create label' }

function context({ installed = false, isLoading = false } = {}) {
  return {
    appInstallations: installed
      ? [
          {
            app: { id: APP_ID, slug: 'ups', title: 'UPS', avatarUrl: null },
            installationId: 'inst_1',
            installationType: 'production',
          },
        ]
      : [],
    appConnections: [],
    isLoading,
    isLoadingConnections: false,
  }
}

beforeEach(() => {
  h.context = context()
  h.registryEntries = []
  h.details = {
    app: {
      id: APP_ID,
      slug: 'ups',
      title: 'UPS',
      description: 'Ship things',
      avatarUrl: null,
      websiteUrl: null,
      documentationUrl: null,
      supportSiteUrl: null,
      screenshots: [],
      scopes: ['shipments:write'],
      verified: true,
    },
    developerAccount: { title: 'Auxx' },
    availableDeployments: [{ id: 'dep_1', version: '1.2.0', deploymentType: 'production' }],
    capabilities: {
      tools: { count: 0, names: [] },
      quickActions: { count: 0, names: [] },
      workflowBlocks: { count: 2, names: ['Create label'] },
      dataConnectors: { count: 0, names: [] },
      connection: { label: 'UPS account' },
    },
  }
})

describe('AppNodeFallbackPanel', () => {
  it('offers the install card, and the app’s detail, when the app is not installed', () => {
    render(<AppNodeFallbackPanel nodeId='n1' data={NODE} />)

    expect(screen.getByTestId('install-card')).toHaveTextContent('ups')
    expect(screen.getByText('Ship things')).toBeVisible()
    expect(screen.getByText('shipments:write')).toBeVisible()
    expect(screen.getByText('Auxx')).toBeVisible()
  })

  it('waits, rather than accusing an installed app of being missing, while installations load', () => {
    h.context = context({ isLoading: true })
    render(<AppNodeFallbackPanel nodeId='n1' data={NODE} />)

    expect(screen.queryByTestId('install-card')).toBeNull()
    expect(screen.queryByText(/no longer/i)).toBeNull()
  })

  it('waits while an installed app’s blocks are still registering', () => {
    h.context = context({ installed: true })
    h.registryEntries = []

    render(<AppNodeFallbackPanel nodeId='n1' data={NODE} />)

    expect(screen.queryByText(/no longer/i)).toBeNull()
    expect(screen.queryByTestId('install-card')).toBeNull()
  })

  it('reports a removed block once the app’s OTHER blocks have registered', () => {
    h.context = context({ installed: true })
    h.registryEntries = [[`${APP_ID}:void-label`, {}]]

    render(<AppNodeFallbackPanel nodeId='n1' data={NODE} />)

    expect(screen.getByText(/Step no longer available/i)).toBeVisible()
    expect(screen.queryByTestId('install-card')).toBeNull()
  })

  it('degrades to a browse link for a node too old to carry `appSlug`', () => {
    render(<AppNodeFallbackPanel nodeId='n1' data={{ type: `${APP_ID}:create-label` }} />)

    expect(screen.queryByTestId('install-card')).toBeNull()
    expect(screen.getByRole('link', { name: /browse apps/i })).toBeVisible()
  })
})
