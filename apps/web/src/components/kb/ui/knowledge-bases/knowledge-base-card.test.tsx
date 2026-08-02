// apps/web/src/components/kb/ui/knowledge-bases/knowledge-base-card.test.tsx
//
// Plan v3/06 P4 — **Delete is withheld from a platform-provisioned KB.**
//
// P4 put `kind: 'learned'` rows into `kb.list` so AI Memory could finally carry
// a Share card (§6.2: while it was filtered out, no `kb` `ResourceAccess` row
// could be authored against it at all). That also handed it the rest of the KB
// tile's menu — including Delete, on a KB `ensureLearnedMemory` re-provisions on
// the next learned write. Deleting it does not remove anything durable; it
// purges every memory the org accumulated and leaves the container to come back
// empty. Settings STAYS, because the Share dialog behind it is the entire reason
// the KB is listed.
//
// The rule is keyed on `kind` — never a name (user-editable) or an id (per-org).

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  canAdmin: true,
}))

// The menu lives inside `DropdownMenuContent`, which Radix does not mount until
// the menu opens. Rendering it inline keeps this file about WHICH items are
// assembled, which is the thing that regressed.
vi.mock('@auxx/ui/components/list-card', () => ({
  ListCard: ({ title, menu }: { title?: string; menu?: React.ReactNode }) => (
    <div>
      <span>{title}</span>
      <div data-testid='menu'>{menu}</div>
    </div>
  ),
  renderBadgeChips: () => null,
}))
vi.mock('@auxx/ui/components/dropdown-menu', () => ({
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => (
    <button type='button'>{children}</button>
  ),
  DropdownMenuSeparator: () => <hr />,
}))
vi.mock('@auxx/ui/components/badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))
vi.mock('@auxx/ui/components/tooltip', () => ({
  SimpleTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('~/components/favorites/ui/favorite-toggle-menu-item', () => ({
  FavoriteToggleMenuItem: () => <button type='button'>Favorite</button>,
}))
vi.mock('~/components/list-selection', () => ({
  useBulkMode: () => false,
  useIsPending: () => false,
  useIsSelected: () => false,
  useListSelection: () => vi.fn(),
  usePendingLabel: () => undefined,
}))
vi.mock('~/components/permissions/ui/instance-share-dialog', () => ({
  InstanceShareDialog: () => null,
}))
vi.mock('~/hooks/use-confirm', () => ({
  useConfirm: () => [vi.fn(async () => false), () => null],
}))
vi.mock('~/providers/capabilities-provider', () => ({
  useAccess: () => ({
    isRestrictedInstance: () => false,
    canAdminInstance: () => h.canAdmin,
  }),
}))
vi.mock('../../hooks/use-knowledge-base-mutations', () => ({
  useKnowledgeBaseMutations: () => ({
    updateKnowledgeBase: vi.fn(),
    updateDraftSettings: vi.fn(),
    deleteKnowledgeBase: vi.fn(),
    isUpdating: false,
    isUpdatingDraft: false,
  }),
}))
vi.mock('../dialogs/kb-knowledge-base-dialog', () => ({ KnowledgeBaseDialog: () => null }))

import type { KnowledgeBase } from '../../store/knowledge-base-store'
import { KnowledgeBaseCard } from './knowledge-base-card'

function kb(kind: string, name = 'A knowledge base'): KnowledgeBase {
  return {
    id: 'kb_cuid0000000000000000000000',
    name,
    slug: 'a-knowledge-base',
    description: null,
    kind,
    publishStatus: 'PUBLISHED',
  } as unknown as KnowledgeBase
}

beforeEach(() => {
  h.canAdmin = true
})

describe('KnowledgeBaseCard — Delete on a platform-provisioned KB (plan v3/06 P4)', () => {
  it('offers Delete on a `standard` KB', async () => {
    render(<KnowledgeBaseCard knowledgeBase={kb('standard')} />)
    expect(await screen.findByText('Delete')).toBeInTheDocument()
  })

  it('withholds Delete on a `learned` KB', () => {
    render(<KnowledgeBaseCard knowledgeBase={kb('learned', 'AI Memory')} />)
    expect(screen.queryByText('Delete')).toBeNull()
  })

  it('KEEPS Settings and Share on a `learned` KB', () => {
    // The narrowing is Delete-only. Removing Settings would take the Share
    // dialog with it and undo the reason §6.2 wanted the KB listed at all.
    render(<KnowledgeBaseCard knowledgeBase={kb('learned', 'AI Memory')} />)
    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.getByText('Share…')).toBeInTheDocument()
    expect(screen.getByText('Open')).toBeInTheDocument()
  })

  it('withholds Delete on a `learned` KB even for a principal with instance admin', () => {
    // 🔴 OWNER is the case that would otherwise sail through: the instance
    // ladder hands it `admin` on every KB, so `canAdmin` alone can never
    // withhold this. The `kind` check is an ADDITIONAL narrowing, not a
    // replacement — this test fails the moment someone "simplifies" it back to
    // one condition.
    h.canAdmin = true
    render(<KnowledgeBaseCard knowledgeBase={kb('learned', 'AI Memory')} />)
    expect(screen.queryByText('Delete')).toBeNull()
  })

  it('still withholds Delete on a `standard` KB without instance admin', () => {
    h.canAdmin = false
    render(<KnowledgeBaseCard knowledgeBase={kb('standard')} />)
    expect(screen.queryByText('Delete')).toBeNull()
    expect(screen.queryByText('Settings')).toBeNull()
  })
})
