// apps/web/src/components/agents/agent-page-gates.test.tsx

import { SidebarProvider } from '@auxx/ui/components/sidebar'
import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { render, screen } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 25 §4.2.DECIDED — **the coarse gates read `agents.view`, not
 * `agents.manage`.**
 *
 * This is the #1346 regression, pinned. #1346 split `Area.workflows` into
 * three rungs but left the landing pages, the sidebar and cmd+K gated on the
 * authoring key, so every member holding only `view`/`edit` — or holding one
 * single shared workflow — was shown a lock screen for a resource they were
 * explicitly granted. `Area.agents` has just been split the same way, so the
 * same four sites are the same trap.
 *
 * The assertions are deliberately about the *landing* surfaces only. Which
 * particular agent a member may open is NOT decided here: `agent.getById`
 * asserts instance access on the resolved id server-side, and a restricted
 * agent surfaces as "not found", never as this lock screen.
 */

const h = vi.hoisted(() => ({
  /** The member's composed AREA keys. */
  keys: new Set<string>(),
  hasFeature: true,
}))

vi.mock('~/providers/feature-flag-provider', () => ({
  useFeatureFlags: () => ({ hasAccess: () => h.hasFeature }),
}))
vi.mock('~/providers/capabilities-provider', () => ({
  useAccess: () => ({
    can: (key: string) => h.keys.has(key),
    canViewInstance: () => true,
    canEditInstance: () => true,
    canAdminInstance: () => true,
    isRestrictedInstance: () => false,
    capabilities: [...h.keys],
    isLoading: false,
  }),
}))

// The page bodies are irrelevant to the gate — stub them to a marker so the
// test asserts "did we get in", not "did the list render".
vi.mock('~/components/agents', () => ({
  AgentsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('~/components/agents/ui/list/agents-page-content', () => ({
  AgentsPageContent: () => <div data-testid='agents-list' />,
}))
vi.mock('~/components/agents/hooks/use-agent', () => ({
  useAgent: () => ({ detail: { id: 'agent_1', name: 'Support bot' }, isLoading: false }),
}))
vi.mock('~/components/agents/hooks/use-agent-realtime', () => ({
  useAgentRealtime: () => {},
}))
vi.mock('~/components/agents/ui/detail/agent-detail-view', () => ({
  AgentDetailView: () => <div data-testid='agent-detail' />,
}))
vi.mock('~/components/resources/hooks/use-viewable-resources', () => ({
  useViewableResources: () => ({ resources: [], isLoading: false }),
}))

import { renderHook } from '@testing-library/react'
import AgentDetailPage from '~/app/(protected)/app/agents/[slug]/page'
import AgentsPage from '~/app/(protected)/app/agents/page'
import { useNavigationActions } from '~/components/kbar/actions/navigation'
import { SIDEBAR_MENU } from '~/constants/menu'

// The lock screens render a `next/link` back-link, whose `useIntersection`
// calls `new IntersectionObserver(...)`. The global setup stubs it as a plain
// arrow function, which is not constructible.
beforeAll(() => {
  class NoopIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  }
  vi.stubGlobal('IntersectionObserver', NoopIntersectionObserver)
})

beforeEach(() => {
  h.keys = new Set()
  h.hasFeature = true
})

/** `MainPageHeader` mounts a `SidebarTrigger`, which needs the sidebar context. */
function renderPage(ui: React.ReactElement) {
  return render(
    <SidebarProvider>
      <TooltipProvider>{ui}</TooltipProvider>
    </SidebarProvider>
  )
}

describe('agents landing pages — the coarse gate is `agents.view`', () => {
  it('lets a VIEW-only member into the agents list', () => {
    h.keys = new Set(['agents.view'])

    renderPage(<AgentsPage />)

    expect(screen.getByTestId('agents-list')).toBeTruthy()
    expect(screen.queryByText('Agents Not Available')).toBeNull()
  })

  it('lets a VIEW-only member into an agent detail page', () => {
    h.keys = new Set(['agents.view'])

    renderPage(<AgentDetailPage />)

    expect(screen.getByTestId('agent-detail')).toBeTruthy()
    expect(screen.queryByText('Agents Not Available')).toBeNull()
  })

  it('still locks out a member holding NO agents rung', () => {
    h.keys = new Set()

    renderPage(<AgentsPage />)

    expect(screen.getByText('Agents Not Available')).toBeTruthy()
    expect(screen.queryByTestId('agents-list')).toBeNull()
  })

  it('still locks out the detail page for a member holding NO agents rung', () => {
    h.keys = new Set()

    renderPage(<AgentDetailPage />)

    expect(screen.getByText('Agents Not Available')).toBeTruthy()
    expect(screen.queryByTestId('agent-detail')).toBeNull()
  })

  it('locks the list when the plan lacks the agents feature, even at Full', () => {
    h.keys = new Set(['agents.view', 'agents.edit', 'agents.manage'])
    h.hasFeature = false

    renderPage(<AgentsPage />)

    expect(screen.getByText('Agents Not Available')).toBeTruthy()
  })
})

describe('navigation surfaces — sidebar and cmd+K', () => {
  it('gates the sidebar Agents entry on `agents.view`', () => {
    const entry = SIDEBAR_MENU.find((item) => item.id === 'agents')

    expect(entry).toBeTruthy()
    // The exact string matters: `agents.manage` here is the #1346 bug.
    expect(entry?.permissionKey).toBe('agents.view')
  })

  it('offers the cmd+K Agents action to a VIEW-only member', () => {
    h.keys = new Set(['agents.view'])

    const { result } = renderHook(() => useNavigationActions())

    expect(result.current.some((action) => action.id === 'nav.agents')).toBe(true)
  })

  it('withholds the cmd+K Agents action from a member holding no agents rung', () => {
    h.keys = new Set()

    const { result } = renderHook(() => useNavigationActions())

    expect(result.current.some((action) => action.id === 'nav.agents')).toBe(false)
  })
})
