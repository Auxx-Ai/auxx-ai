// apps/web/src/components/agents/utils/__tests__/dock-layout.test.ts

import { resolveDockLayout } from '../dock-layout'

describe('resolveDockLayout', () => {
  it('defaults to tabs when split is off', () => {
    expect(
      resolveDockLayout({
        panel: 'simulations',
        split: false,
        isFreshAgent: false,
        kopilotEnabled: true,
      })
    ).toEqual({
      mode: 'tabs',
      panel: 'simulations',
      chatAvailable: true,
    })
  })

  it('renders the split for build/simulations on a configured agent', () => {
    expect(
      resolveDockLayout({ panel: 'build', split: true, isFreshAgent: false, kopilotEnabled: true })
        .mode
    ).toBe('split')
    expect(
      resolveDockLayout({
        panel: 'simulations',
        split: true,
        isFreshAgent: false,
        kopilotEnabled: true,
      }).mode
    ).toBe('split')
  })

  it('degrades chat+split to tabs (two KopilotChat instances would clash)', () => {
    expect(
      resolveDockLayout({ panel: 'chat', split: true, isFreshAgent: false, kopilotEnabled: true })
    ).toEqual({
      mode: 'tabs',
      panel: 'chat',
      chatAvailable: true,
    })
  })

  it('never splits a fresh agent', () => {
    expect(
      resolveDockLayout({ panel: 'build', split: true, isFreshAgent: true, kopilotEnabled: true })
        .mode
    ).toBe('tabs')
    expect(
      resolveDockLayout({
        panel: 'simulations',
        split: true,
        isFreshAgent: true,
        kopilotEnabled: true,
      }).mode
    ).toBe('tabs')
  })

  it('always preserves the requested panel so exiting the split restores it', () => {
    expect(
      resolveDockLayout({
        panel: 'simulations',
        split: true,
        isFreshAgent: false,
        kopilotEnabled: true,
      }).panel
    ).toBe('simulations')
    expect(
      resolveDockLayout({ panel: 'build', split: true, isFreshAgent: false, kopilotEnabled: true })
        .panel
    ).toBe('build')
  })

  // ── Kopilot-off degradation ──────────────────────────────────────────────
  // `agents` and `kopilot` are independent FeatureKeys, so a plan can grant the
  // agent pages without the docked chat. Build and Chat are Kopilot surfaces.

  it('degrades both chat panels to simulations without kopilot', () => {
    for (const panel of ['build', 'chat', 'simulations'] as const) {
      expect(
        resolveDockLayout({ panel, split: false, isFreshAgent: false, kopilotEnabled: false })
      ).toEqual({
        mode: 'tabs',
        panel: 'simulations',
        chatAvailable: false,
      })
    }
  })

  it('never splits without kopilot — the split’s bottom pane is Build', () => {
    expect(
      resolveDockLayout({
        panel: 'simulations',
        split: true,
        isFreshAgent: false,
        kopilotEnabled: false,
      }).mode
    ).toBe('tabs')
  })

  it('reports chatAvailable false for a fresh agent too, so the caller can drop the dock', () => {
    expect(
      resolveDockLayout({ panel: 'build', split: false, isFreshAgent: true, kopilotEnabled: false })
        .chatAvailable
    ).toBe(false)
  })

  it('leaves every layout untouched when kopilot is on', () => {
    expect(
      resolveDockLayout({ panel: 'chat', split: false, isFreshAgent: false, kopilotEnabled: true })
        .panel
    ).toBe('chat')
    expect(
      resolveDockLayout({ panel: 'build', split: false, isFreshAgent: true, kopilotEnabled: true })
        .panel
    ).toBe('build')
  })
})
