// apps/web/src/components/agents/utils/dock-layout.ts
//
// Pure layout resolution for the docked agent panel (evals v2 Phase 3). The
// `?panel=` + `?split=` query params can express states the UI must degrade —
// split only makes sense for Simulations+Build on a configured agent, never on
// Chat (two KopilotChat instances would fight the global store) and never on a
// fresh agent (suggestion chips / template auto-submit own that surface).

export type DockPanel = 'build' | 'chat' | 'simulations'
export type DockMode = 'tabs' | 'split'

export interface DockLayoutInput {
  panel: DockPanel
  split: boolean
  isFreshAgent: boolean
}

export interface DockLayout {
  /** Whether to render the vertical Simulations+Build split or the tab stack. */
  mode: DockMode
  /** The panel the tab stack shows (also the "came from" pane when in split). */
  panel: DockPanel
}

/**
 * Resolve the effective dock layout from the raw query params. Split survives
 * only for `build`/`simulations` on a non-fresh agent; every other combination
 * degrades to tabs with the requested panel preserved.
 */
export function resolveDockLayout({ panel, split, isFreshAgent }: DockLayoutInput): DockLayout {
  const splittable = split && !isFreshAgent && panel !== 'chat'
  return { mode: splittable ? 'split' : 'tabs', panel }
}
