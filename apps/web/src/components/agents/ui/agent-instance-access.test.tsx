// apps/web/src/components/agents/ui/agent-instance-access.test.tsx

import { SidebarProvider } from '@auxx/ui/components/sidebar'
import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 25 §4.2.DECIDED — **the three per-agent rungs, on the surfaces that
 * render them.**
 *
 * The vocabulary these pin (user decision 2026-07-27/28):
 *  - `view` is *usable*, not "read the builder and nothing else": the page
 *    opens, the docked chat works, the persona is readable. What disappears is
 *    every authoring affordance.
 *  - `edit` is authoring: prompt, toolsets, bindings, knowledge, procedures.
 *  - `admin` is administration: Share, Publish, Archive, Delete, rename
 *    (name + slug — the slug is the agent's `@handle` and its URL), and the
 *    permission-profile / run-as pair.
 *
 * Sharing follows #1355 exactly: the Share affordance AND the dialog mount only
 * for an instance-admin, so a non-admin can neither open it nor be handed one
 * by a stray `open` state.
 *
 * The gating is degrade-only — `~/server/lib/agent-instance-access` is the
 * authority — so these tests are about not *offering* a click that 403s.
 */

type Tier = 'view' | 'edit' | 'admin'

const AGENT_ID = 'agent_1'

const h = vi.hoisted(() => ({
  tier: 'admin' as 'view' | 'edit' | 'admin',
  /** Org rank, independent of the per-agent rung. */
  isAdminOrOwner: true,
}))

const rank = (): number => ({ view: 1, edit: 2, admin: 3 })[h.tier]

vi.mock('~/providers/feature-flag-provider', () => ({
  useFeatureFlags: () => ({ hasAccess: () => true }),
}))
vi.mock('~/hooks/use-user', () => ({ useUser: () => ({ isAdminOrOwner: h.isAdminOrOwner }) }))
vi.mock('~/providers/capabilities-provider', () => ({
  useAccess: () => ({
    // Area keys track the tier, so the id-less fallback branch of
    // `useAgentAccess` agrees with the per-instance one (agents are
    // `baselineAtCreate: false` — that agreement is the whole point).
    can: (key: string) =>
      key === 'agents.view' ||
      (key === 'agents.edit' && rank() >= 2) ||
      (key === 'agents.manage' && rank() >= 3),
    canViewInstance: (recordId: string) => recordId === `agent:${AGENT_ID}`,
    canEditInstance: (recordId: string) => recordId === `agent:${AGENT_ID}` && rank() >= 2,
    canAdminInstance: (recordId: string) => recordId === `agent:${AGENT_ID}` && rank() >= 3,
    isRestrictedInstance: () => false,
    capabilities: [],
    isLoading: false,
  }),
  useCanAdminInstance: () => rank() >= 3,
}))

// The share dialog is stubbed, not removed — #1355's rule is that BOTH the
// trigger and the dialog are admin-gated, so the stub has to be observable.
vi.mock('~/components/permissions/ui/instance-share-dialog', () => ({
  InstanceShareDialog: ({ recordId, open }: { recordId: string; open: boolean }) => (
    <div data-testid='share-dialog' data-open={String(open)}>
      {recordId}
    </div>
  ),
}))

// Chrome that has nothing to do with the tiers.
vi.mock('~/hooks/use-docked-panels', () => ({
  // Render the docked content inline — the point is that a `view` holder still
  // gets the chat panel, so it has to actually mount.
  useDockedPanels: (panels: Array<{ key: string; content: React.ReactNode }>) => ({
    dockedPanels: [],
    leftPanels: [],
    overlays: panels.map((panel) => <div key={panel.key}>{panel.content}</div>),
    isDocked: true,
  }),
}))
vi.mock('~/stores/dock-store', () => ({
  useDockStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ dockedWidth: 320, setDockedWidth: vi.fn(), minWidth: 240, maxWidth: 640 }),
}))
vi.mock('~/components/agents/ui/detail/agent-detail-tabs', () => ({
  AgentDetailTabs: () => <div data-testid='agent-tabs' />,
}))
vi.mock('~/components/agents/ui/detail/agent-docked-chat', () => ({
  AgentDockedChat: () => <div data-testid='agent-chat' />,
}))
vi.mock('~/components/agents/ui/detail/agent-breadcrumb-switcher', () => ({
  AgentBreadcrumbSwitcher: () => <span>Support bot</span>,
}))
vi.mock('~/components/agents/ui/detail/setup/agent-setup-mode', () => ({
  AgentSetupMode: () => <div data-testid='agent-setup' />,
}))
vi.mock('~/components/agents/ui/detail/agent-setup-discard-button', () => ({
  AgentSetupDiscardButton: () => <div data-testid='agent-setup-discard' />,
}))
vi.mock('~/components/agents/ui/detail/agent-versions-dialog', () => ({
  AgentVersionsDialog: () => null,
}))
vi.mock('~/components/agents/ui/detail/permissions/publish-clamp-dialog', () => ({
  PublishClampDialog: () => null,
}))
vi.mock('~/components/agents/ui/detail/agent-model-badge', () => ({
  AgentModelBadge: () => null,
}))
vi.mock('~/components/file-upload/ui/avatar-upload', () => ({
  AvatarUpload: ({ disabled }: { disabled?: boolean }) => (
    <div data-testid='avatar-upload' data-disabled={String(!!disabled)} />
  ),
}))
vi.mock('~/components/agents/ui/shared/agent-avatar', () => ({
  AgentAvatar: () => <div data-testid='agent-avatar' />,
}))
vi.mock('~/components/list-selection', () => ({
  useBulkMode: () => false,
  useIsPending: () => false,
  useIsSelected: () => false,
  useListSelection: () => vi.fn(),
  usePendingLabel: () => '',
}))
vi.mock('~/hooks/use-confirm', () => ({
  useConfirm: () => [vi.fn().mockResolvedValue(true), () => null],
}))
vi.mock('~/components/agents/hooks/use-agent-mutations', () => ({
  useAgentMutations: () => ({
    updateAgent: vi.fn(),
    publishAgent: vi.fn(),
    discardChanges: vi.fn(),
    archiveAgent: vi.fn(),
    unarchiveAgent: vi.fn(),
    deleteAgent: vi.fn(),
    deleteSetupDraft: vi.fn(),
    isPublishing: false,
    isDiscarding: false,
    isUpdating: false,
  }),
}))
vi.mock('~/components/agents/hooks/use-agent-permission-profiles', () => ({
  useAgentPermissionProfiles: () => ({
    profiles: [],
    byId: new Map(),
    isLoading: false,
    fallbackFor: () => null,
  }),
  useAgentProfileBinding: () => ({ setProfile: vi.fn(), isSaving: false }),
  useAgentProfilePolicy: () => ({ policy: null }),
}))
vi.mock('~/components/agents/ui/detail/permissions/agent-profile-picker', () => ({
  AgentProfilePicker: ({ disabled }: { disabled?: boolean }) => (
    <div data-testid='profile-picker' data-disabled={String(!!disabled)} />
  ),
}))
vi.mock('~/components/agents/ui/detail/permissions/agent-policy-view', () => ({
  AgentPolicySummary: () => null,
  AgentResolvedPolicyDialog: () => null,
}))
vi.mock('~/components/agents/ui/detail/permissions/author-clamp-notice', () => ({
  AuthorClampNotice: () => null,
}))
vi.mock('~/components/agents/ui/detail/agent-guide-dialog', () => ({
  AgentGuideDialog: () => null,
}))
vi.mock('~/components/banner/upgrade-banner', () => ({ UpgradeBanner: () => null }))
vi.mock('~/trpc/react', () => ({
  api: {
    member: { all: { useQuery: () => ({ data: { members: [] } }) } },
    useUtils: () => ({
      agent: {
        list: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn() },
        checkSlug: { fetch: vi.fn() },
      },
      agentToolset: { listTools: { prefetch: vi.fn() } },
    }),
    agent: {
      getById: {
        useQuery: () => ({
          data: {
            id: AGENT_ID,
            name: 'Support bot',
            activeVersionId: 'ver_1',
            hasUnpublishedChanges: true,
            archivedAt: null,
          },
        }),
      },
    },
  },
}))

import type { AgentDetail, AgentListItem } from '~/components/agents/store/agent-store'
import { AgentDetailView } from '~/components/agents/ui/detail/agent-detail-view'
import { AgentHero } from '~/components/agents/ui/detail/agent-hero'
import { AgentPermissionsSection } from '~/components/agents/ui/detail/agent-permissions-section'
import { AgentCard } from '~/components/agents/ui/list/agent-card'

const AGENT = {
  id: AGENT_ID,
  name: 'Support bot',
  slug: 'support-bot',
  description: 'Answers refunds',
  kind: 'internal',
  avatarUrl: null,
  userId: 'user_bot',
  modelId: 'gpt-5',
  archivedAt: null,
  setupCompletedAt: new Date('2026-01-01'),
  activeVersionId: 'ver_1',
  activeVersionNumber: 1,
  hasUnpublishedChanges: true,
  prompt: null,
  runAsUserId: null,
  permissionProfileId: null,
  updatedAt: new Date('2026-01-01'),
} as unknown as AgentDetail

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
  // `next/link`'s `useIntersection` constructs one; the global setup stubs it
  // as a plain arrow function, which is not constructible.
  class NoopIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  }
  vi.stubGlobal('IntersectionObserver', NoopIntersectionObserver)
  // Same story for Radix/floating-ui's `autoUpdate`, which constructs one.
  class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', NoopResizeObserver)
  // Radix's dropdown needs these; jsdom ships neither.
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
    Element.prototype.setPointerCapture = () => {}
    Element.prototype.releasePointerCapture = () => {}
  }
})

beforeEach(() => {
  h.tier = 'admin'
  h.isAdminOrOwner = true
})

function renderDetail(tier: Tier) {
  h.tier = tier
  return render(
    <SidebarProvider>
      <TooltipProvider>
        <AgentDetailView agent={AGENT} />
      </TooltipProvider>
    </SidebarProvider>
  )
}

describe('AgentDetailView — the Share affordance is instance-admin only', () => {
  it('offers Share to an admin, mounted on this agent’s recordId', () => {
    renderDetail('admin')

    expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy()
    expect(screen.getByTestId('share-dialog').textContent).toBe(`agent:${AGENT_ID}`)
  })

  it('withholds Share — trigger AND dialog — from an EDIT holder', () => {
    renderDetail('edit')

    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull()
    expect(screen.queryByTestId('share-dialog')).toBeNull()
  })

  it('withholds Share — trigger AND dialog — from a VIEW holder', () => {
    renderDetail('view')

    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull()
    expect(screen.queryByTestId('share-dialog')).toBeNull()
  })
})

describe('AgentDetailView — publish chrome by tier', () => {
  it('gives an admin Publish, Archive and Delete', async () => {
    const user = userEvent.setup()
    renderDetail('admin')

    expect(screen.getByRole('button', { name: /Publish$/ })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Publish menu' }))
    expect(screen.getByRole('menuitem', { name: /Archive/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /Delete/ })).toBeTruthy()
  })

  it('gives an EDIT holder the draft controls but no Publish, Archive or Delete', async () => {
    const user = userEvent.setup()
    renderDetail('edit')

    // Discard (the draft control) survives; Publish does not.
    expect(screen.getByRole('button', { name: 'Discard changes' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Publish$/ })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Publish menu' }))
    expect(screen.getByRole('menuitem', { name: /Version history/ })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /Archive/ })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /Delete/ })).toBeNull()
  })

  it('gives a VIEW holder no publish cluster at all, and says why', () => {
    renderDetail('view')

    expect(screen.queryByRole('button', { name: 'Publish menu' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Publish$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Discard changes' })).toBeNull()
    expect(screen.getByText('View only')).toBeTruthy()
  })

  it('still opens the page and its docked chat for a VIEW holder', () => {
    renderDetail('view')

    // The #1346 shape, one level in: `view` is USABLE. The builder body and the
    // chat panel must both still mount.
    expect(screen.getByTestId('agent-tabs')).toBeTruthy()
    expect(screen.getByTestId('agent-chat')).toBeTruthy()
  })
})

describe('AgentHero — rename is admin, description is edit', () => {
  function renderHero(tier: Tier) {
    h.tier = tier
    return render(
      <TooltipProvider>
        <AgentHero agent={AGENT} />
      </TooltipProvider>
    )
  }

  it('lets an admin click into name, slug and description', () => {
    renderHero('admin')

    expect(screen.getByRole('button', { name: 'Support bot' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '@support-bot' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Answers refunds' })).toBeTruthy()
    expect(screen.getByTestId('avatar-upload').dataset.disabled).toBe('false')
  })

  it('lets an EDIT holder rename, because the server does (user decision 2026-07-28)', () => {
    renderHero('edit')

    // Rename is an AUTHORING field, not administration: `agent.update`'s
    // `ADMIN_ONLY_UPDATE_FIELDS` is `runAsUserId` / `permissionProfileId` /
    // `archivedAt` only, so name and slug go through on the Edit rung. This
    // test is the tripwire for the UI drifting stricter than the server — the
    // direction that never 403s and therefore never gets reported as a bug,
    // it just silently removes an affordance. It also keeps `agent.checkSlug`'s
    // instance-`edit` branch (the live slug hint) reachable.
    expect(screen.getByRole('button', { name: 'Support bot' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '@support-bot' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Answers refunds' })).toBeTruthy()
    expect(screen.getByTestId('avatar-upload').dataset.disabled).toBe('false')
  })

  it('freezes every field, and the avatar, for a VIEW holder', () => {
    renderHero('view')

    expect(screen.queryByRole('button', { name: 'Support bot' })).toBeNull()
    expect(screen.queryByRole('button', { name: '@support-bot' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Answers refunds' })).toBeNull()
    expect(screen.getByText('Answers refunds')).toBeTruthy()
    expect(screen.getByTestId('avatar-upload').dataset.disabled).toBe('true')
  })
})

describe('AgentCard — the list menu follows the same tiers', () => {
  const LIST_AGENT = {
    id: AGENT_ID,
    name: 'Support bot',
    slug: 'support-bot',
    description: 'Answers refunds',
    kind: 'internal',
    modelId: 'gpt-5',
    archivedAt: null,
    setupCompletedAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  } as unknown as AgentListItem

  function renderCard(tier: Tier) {
    h.tier = tier
    return render(
      <TooltipProvider>
        <AgentCard agent={LIST_AGENT} />
      </TooltipProvider>
    )
  }

  async function openMenu() {
    const user = userEvent.setup()
    // `ListCard`'s menu button carries no accessible name — Radix's
    // `aria-haspopup` is the stable handle on it.
    const trigger = document.querySelector('[aria-haspopup="menu"]')
    if (!trigger) throw new Error('card menu trigger not found')
    await user.click(trigger)
  }

  it('offers Share…, Archive and Delete to an admin', async () => {
    renderCard('admin')
    await openMenu()

    expect(screen.getByRole('menuitem', { name: /Share/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /Archive/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /Delete/ })).toBeTruthy()
    expect(screen.getByTestId('share-dialog')).toBeTruthy()
  })

  it('gives an EDIT holder Edit but neither Share…, Archive nor Delete', async () => {
    renderCard('edit')
    await openMenu()

    expect(screen.getByRole('menuitem', { name: /Edit/ })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /Share/ })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /Archive/ })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /Delete/ })).toBeNull()
    expect(screen.queryByTestId('share-dialog')).toBeNull()
  })

  it('offers a VIEW holder only Open', async () => {
    renderCard('view')
    await openMenu()

    expect(screen.getByRole('menuitem', { name: /Open/ })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /^Edit/ })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /Share/ })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /Delete/ })).toBeNull()
  })
})

describe('AgentPermissionsSection — the authority pair is instance-admin AND org rank', () => {
  function renderSection(tier: Tier, isAdminOrOwner: boolean) {
    h.tier = tier
    h.isAdminOrOwner = isAdminOrOwner
    return render(
      <TooltipProvider>
        <AgentPermissionsSection agent={AGENT} />
      </TooltipProvider>
    )
  }

  it('enables the profile picker and run-as for an org admin who administers the agent', () => {
    renderSection('admin', true)

    expect(screen.getByTestId('profile-picker').dataset.disabled).toBe('false')
    expect(screen.getByRole('combobox')).not.toHaveAttribute('data-disabled')
  })

  it('freezes them for an ORG ADMIN restricted to `edit` on this agent', () => {
    // `permissionProfileId` / `runAsUserId` are `ADMIN_ONLY_UPDATE_FIELDS`, so
    // org rank alone would render an enabled control that 403s.
    renderSection('edit', true)

    expect(screen.getByTestId('profile-picker').dataset.disabled).toBe('true')
    expect(screen.getByRole('combobox')).toHaveAttribute('data-disabled')
    expect(screen.getByText(/do not administer this agent/i)).toBeTruthy()
  })

  it('freezes them for a non-admin member who DOES administer the agent', () => {
    renderSection('admin', false)

    expect(screen.getByTestId('profile-picker').dataset.disabled).toBe('true')
    expect(screen.getByRole('combobox')).toHaveAttribute('data-disabled')
    expect(screen.getByText(/Only an owner or admin can change these/i)).toBeTruthy()
  })
})
