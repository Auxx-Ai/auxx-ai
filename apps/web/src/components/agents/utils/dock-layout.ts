// apps/web/src/components/agents/utils/dock-layout.ts
//
// Pure layout resolution for the docked agent panel (evals v2 Phase 3). The
// `?panel=` + `?split=` query params can express states the UI must degrade —
// split only makes sense for Simulations+Build on a configured agent, never on
// Chat (two KopilotChat instances would fight the global store) and never on a
// fresh agent (suggestion chips / template auto-submit own that surface).
//
// The org's plan is a third source of impossible states: Build and Chat are
// Kopilot surfaces, and `agents` is a separate FeatureKey from `kopilot`, so a
// plan can grant the agent pages without the chat that docks beside them.

export type DockPanel = 'build' | 'chat' | 'simulations'
export type DockMode = 'tabs' | 'split'

export interface DockLayoutInput {
  panel: DockPanel
  split: boolean
  isFreshAgent: boolean
  /**
   * Whether the org's plan carries `FeatureKey.kopilot`. Required rather than
   * defaulted so every call site has to answer it — a silent `true` would put
   * the 403 back.
   */
  kopilotEnabled: boolean
}

export interface DockLayout {
  /** Whether to render the vertical Simulations+Build split or the tab stack. */
  mode: DockMode
  /** The panel the tab stack shows (also the "came from" pane when in split). */
  panel: DockPanel
  /**
   * Whether the Kopilot-backed panels (Build, Chat) may render at all. False
   * collapses the dock to Simulations: callers must drop those two tab triggers
   * and never mount a `KopilotChat`, whose composer posts to
   * `/api/kopilot/stream` and would take a 403 on send.
   */
  chatAvailable: boolean
}

/**
 * Resolve the effective dock layout from the raw query params. Split survives
 * only for `build`/`simulations` on a non-fresh agent; every other combination
 * degrades to tabs with the requested panel preserved.
 *
 * Without Kopilot the two chat panels don't exist, so a requested `build`/`chat`
 * degrades to `simulations` and the split loses its bottom pane. Note this
 * leaves a FRESH agent with nothing at all to show — that dock should not be
 * mounted in the first place; see `agent-detail-view.tsx`.
 */
export function resolveDockLayout({
  panel,
  split,
  isFreshAgent,
  kopilotEnabled,
}: DockLayoutInput): DockLayout {
  if (!kopilotEnabled) {
    return { mode: 'tabs', panel: 'simulations', chatAvailable: false }
  }
  const splittable = split && !isFreshAgent && panel !== 'chat'
  return { mode: splittable ? 'split' : 'tabs', panel, chatAvailable: true }
}
