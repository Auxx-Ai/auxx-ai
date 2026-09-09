// apps/web/src/components/kbar/__tests__/palette-mail-gating.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RootPage } from '../pages/root'

/*
 * The command palette must not offer mail to a member who has none.
 *
 * "Search threads" is the sharpest case: `score.ts` lists it in
 * `ALWAYS_VISIBLE_IDS`, so it is pinned to the top of an empty palette and is
 * the first thing a member sees on Cmd+K. Its results are visibility-filtered
 * server-side and would come back empty, which makes an ungated row worse than
 * no row — it advertises a capability and then silently returns nothing.
 *
 * The gate is `inboxes.view`, the same key the sidebar renders `<MailSidebar />`
 * on and the same key the mail layout's `CapabilityPageGuard` enforces.
 */

class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}
vi.stubGlobal('IntersectionObserver', NoopIntersectionObserver)
// cmdk scrolls its selected row into view on mount; jsdom has no such method.
Element.prototype.scrollIntoView = vi.fn()

vi.mock('../contextual/select-contextual', () => ({ useContextualSections: () => [] }))
vi.mock('../store', () => ({
  useCommandPaletteStore: Object.assign(
    (selector: (s: { goTo: () => void }) => unknown) => selector({ goTo: () => {} }),
    { getState: () => ({ goTo: () => {}, close: () => {} }) }
  ),
}))

const canMock = vi.hoisted(() => ({ value: (_key: string) => true }))
vi.mock('~/providers/capabilities-provider', () => ({
  useAccess: () => ({ can: (key: string) => canMock.value(key) }),
}))

function renderRoot() {
  return render(<RootPage sections={[]} recentActions={[]} />)
}

describe('command palette mail gating', () => {
  it('offers "Search threads" to a member who holds inboxes.view', () => {
    canMock.value = () => true
    renderRoot()
    expect(screen.getByText('Search threads')).toBeInTheDocument()
  })

  it('hides "Search threads" from a member without inboxes.view', () => {
    canMock.value = (key) => key !== 'inboxes.view'
    renderRoot()
    expect(screen.queryByText('Search threads')).not.toBeInTheDocument()
  })

  it('keeps "Search records" either way — only the mail row is gated', () => {
    canMock.value = (key) => key !== 'inboxes.view'
    renderRoot()
    expect(screen.getByText('Search records')).toBeInTheDocument()
  })
})
