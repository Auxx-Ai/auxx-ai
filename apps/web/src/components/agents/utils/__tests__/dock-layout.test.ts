// apps/web/src/components/agents/utils/__tests__/dock-layout.test.ts

import { resolveDockLayout } from '../dock-layout'

describe('resolveDockLayout', () => {
  it('defaults to tabs when split is off', () => {
    expect(resolveDockLayout({ panel: 'simulations', split: false, isFreshAgent: false })).toEqual({
      mode: 'tabs',
      panel: 'simulations',
    })
  })

  it('renders the split for build/simulations on a configured agent', () => {
    expect(resolveDockLayout({ panel: 'build', split: true, isFreshAgent: false }).mode).toBe(
      'split'
    )
    expect(resolveDockLayout({ panel: 'simulations', split: true, isFreshAgent: false }).mode).toBe(
      'split'
    )
  })

  it('degrades chat+split to tabs (two KopilotChat instances would clash)', () => {
    expect(resolveDockLayout({ panel: 'chat', split: true, isFreshAgent: false })).toEqual({
      mode: 'tabs',
      panel: 'chat',
    })
  })

  it('never splits a fresh agent', () => {
    expect(resolveDockLayout({ panel: 'build', split: true, isFreshAgent: true }).mode).toBe('tabs')
    expect(resolveDockLayout({ panel: 'simulations', split: true, isFreshAgent: true }).mode).toBe(
      'tabs'
    )
  })

  it('always preserves the requested panel so exiting the split restores it', () => {
    expect(
      resolveDockLayout({ panel: 'simulations', split: true, isFreshAgent: false }).panel
    ).toBe('simulations')
    expect(resolveDockLayout({ panel: 'build', split: true, isFreshAgent: false }).panel).toBe(
      'build'
    )
  })
})
