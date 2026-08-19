// apps/web/src/components/workflow/panels/__tests__/property-panel.test.tsx
//
// `NodePanelBody` resolves a node's panel from the registry, and used to close
// the drawer whenever that lookup missed. App blocks are registered
// asynchronously from the INSTALLED apps only, so the miss is routine — an
// uninstalled app's node, or an installed one whose blocks haven't loaded yet —
// and closing the drawer on it is what made clicking such a node do nothing at
// all. `StandardNode` has always carried the mirror-image fallback for the node
// itself; these tests pin the panel half of it.

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  nodes: [] as unknown[],
  panel: undefined as unknown,
  closeDrawer: vi.fn(),
}))

vi.mock('@xyflow/react', () => ({
  useStore: (selector: (state: unknown) => unknown) => selector({ nodes: h.nodes }),
}))
vi.mock('zustand/shallow', () => ({ useShallow: (fn: unknown) => fn }))
vi.mock('../../store/panel-store', () => ({
  usePanelStore: (selector: (state: unknown) => unknown) =>
    selector({ closeDrawer: h.closeDrawer }),
}))
vi.mock('../../nodes/unified-registry', () => ({
  unifiedNodeRegistry: { getPanel: () => h.panel },
}))
vi.mock('../../hooks', () => ({ useRegistryVersion: () => 0 }))
vi.mock('../../debug', () => ({ useRenderTrace: () => {} }))
vi.mock('~/components/workflow/apps/app-node-fallback-panel', () => ({
  AppNodeFallbackPanel: () => <div data-testid='app-fallback-panel' />,
}))

const { NodePanelBody } = await import('../property-panel')

function node(type: string) {
  return { id: 'n1', data: { type, title: 'Create label' } }
}

beforeEach(() => {
  h.nodes = [node('ai')]
  h.panel = () => <div data-testid='registered-panel' />
  h.closeDrawer.mockClear()
})

describe('NodePanelBody', () => {
  it('renders the registered panel when the registry has one', () => {
    render(<NodePanelBody nodeId='n1' />)

    expect(screen.getByTestId('registered-panel')).toBeVisible()
    expect(h.closeDrawer).not.toHaveBeenCalled()
  })

  it('closes the drawer for a core node with no panel — that node really is gone', () => {
    h.panel = undefined
    render(<NodePanelBody nodeId='n1' />)

    expect(h.closeDrawer).toHaveBeenCalled()
  })

  it('renders the fallback panel — never closes — for an app node with no panel', () => {
    h.nodes = [node('app_ups:create-label')]
    h.panel = undefined
    render(<NodePanelBody nodeId='n1' />)

    expect(screen.getByTestId('app-fallback-panel')).toBeVisible()
    expect(h.closeDrawer).not.toHaveBeenCalled()
  })

  it('prefers a registered panel over the fallback once the app block loads', () => {
    h.nodes = [node('app_ups:create-label')]
    render(<NodePanelBody nodeId='n1' />)

    expect(screen.getByTestId('registered-panel')).toBeVisible()
    expect(screen.queryByTestId('app-fallback-panel')).toBeNull()
  })

  it('closes the drawer when the node itself vanished', () => {
    h.nodes = []
    render(<NodePanelBody nodeId='n1' />)

    expect(h.closeDrawer).toHaveBeenCalled()
  })
})
