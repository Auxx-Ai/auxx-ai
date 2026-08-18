// apps/web/src/components/kbar/__tests__/palette-ranking.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { RootPage } from '../pages/root'
import { createPaletteFilter, scorePaletteAction } from '../score'
import type { PaletteAction, PaletteSection } from '../types'

// base-ui's ScrollArea (inside CommandList) does `new IntersectionObserver(...)`,
// and the global setup stubs it as a plain `vi.fn()` returning an object literal —
// not a constructor. Same workaround the other palette/picker tests carry.
class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}
vi.stubGlobal('IntersectionObserver', NoopIntersectionObserver)

vi.mock('../contextual/select-contextual', () => ({ useContextualSections: () => [] }))
vi.mock('../store', () => ({
  useCommandPaletteStore: Object.assign(
    (selector: (s: { goTo: () => void }) => unknown) => selector({ goTo: () => {} }),
    { getState: () => ({ goTo: () => {}, close: () => {} }) }
  ),
}))

const action = (partial: Partial<PaletteAction> & Pick<PaletteAction, 'id' | 'label'>) => ({
  perform: () => {},
  ...partial,
})

const THEME_DARK = action({
  id: 'theme.dark',
  label: 'Set Dark Theme',
  keywords: 'dark theme',
})
const THEME_TOGGLE = action({
  id: 'theme.toggle',
  label: 'Toggle Theme',
  keywords: 'dark light theme toggle',
})
const TICKET_DASHBOARD = action({
  id: 'nav.tickets.dashboard',
  label: 'Ticket dashboard',
  keywords: 'tickets dashboard',
})
const INBOX = action({
  id: 'nav.inbox',
  label: 'Inbox',
  subtitle: 'View your inbox',
  keywords: 'inbox',
})
const SEARCH_RECORDS = action({
  id: 'search-records',
  label: 'Search records',
  subtitle: 'Find contacts, companies, tickets, parts…',
  keywords: 'search records find lookup',
})

describe('scorePaletteAction', () => {
  it('ranks the labelled match above the fuzzy one and drops noise', () => {
    const dark = scorePaletteAction(THEME_DARK, 'dark')
    const toggle = scorePaletteAction(THEME_TOGGLE, 'dark')

    // Label word-start beats keyword-only — under cmdk's default filter these
    // tied at exactly 0.8910 and the winner was decided by DOM order.
    expect(dark).toBeGreaterThan(toggle)
    expect(toggle).toBeGreaterThan(0)

    // The id is no longer part of the scored text, so `nav.tickets.dashboard`
    // stops contributing a phantom `dashboard` token.
    expect(scorePaletteAction(TICKET_DASHBOARD, 'dark')).toBe(0)
  })

  it('scores an exact label match highest', () => {
    expect(scorePaletteAction(INBOX, 'inbox')).toBe(1)
    expect(scorePaletteAction(INBOX, 'inb')).toBe(0.95)
  })

  it('keeps the search escape hatches visible below every real match', () => {
    const hatch = scorePaletteAction(SEARCH_RECORDS, 'acme corp')
    expect(hatch).toBeGreaterThan(0)
    expect(hatch).toBeLessThan(scorePaletteAction(THEME_DARK, 'dark'))
  })
})

describe('createPaletteFilter', () => {
  it('scores known ids, resolves the recent: prefix, and falls back otherwise', () => {
    const filter = createPaletteFilter([
      { action: THEME_DARK },
      { action: TICKET_DASHBOARD, boost: 1.05 },
    ])

    expect(filter('theme.dark', 'dark')).toBe(scorePaletteAction(THEME_DARK, 'dark'))
    expect(filter('recent:theme.dark', 'dark')).toBe(scorePaletteAction(THEME_DARK, 'dark'))
    expect(filter('nav.tickets.dashboard', 'ticket')).toBeCloseTo(
      scorePaletteAction(TICKET_DASHBOARD, 'ticket') * 1.05
    )
    // Unknown value (cmdk also scores group headings) → default filter, never 0.
    expect(filter('Navigation', 'nav', [])).toBeGreaterThan(0)
  })
})

describe('RootPage ranking', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = () => {}
  })

  const sections: PaletteSection[] = [
    { label: 'Navigation', actions: [INBOX, TICKET_DASHBOARD] },
    { label: 'Theme', actions: [THEME_TOGGLE, THEME_DARK] },
  ]

  const visibleValues = () =>
    Array.from(document.querySelectorAll('[cmdk-item]')).map((el) => el.getAttribute('data-value'))

  it('puts the best match first even though Theme is the last section', async () => {
    render(<RootPage sections={sections} recentActions={[]} />)

    await userEvent.type(screen.getByPlaceholderText('Type a command or search…'), 'dark')

    const values = visibleValues()
    expect(values[0]).toBe('theme.dark')
    expect(values[1]).toBe('theme.toggle')
    // Noise is gone entirely, escape hatches remain at the bottom.
    expect(values).not.toContain('nav.tickets.dashboard')
    expect(values).toContain('search-records')
  })

  it('keeps sections and Recent on an empty query', () => {
    render(<RootPage sections={sections} recentActions={[INBOX]} />)

    const headings = Array.from(document.querySelectorAll('[cmdk-group-heading]')).map(
      (el) => el.textContent
    )
    expect(headings).toEqual(['Search', 'Recent', 'Navigation', 'Theme'])
    expect(visibleValues()).toContain('recent:nav.inbox')
  })
})
