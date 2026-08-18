// apps/web/src/components/workflow/debug/render-trace.ts

import { WORKFLOW_PERF_ENABLED } from './perf-flag'

const renderCounts = new Map<string, number>()

/**
 * Count a component's renders under `name`. No state, no context, no
 * subscription — a single `Map` bump during render, and an immediate no-op when
 * the perf switch is off.
 *
 * The read: during a drag, any component whose count approaches the frame count
 * is re-rendering on every pointer frame, which is the regression this exists to
 * name. See `docs/core-workflow-architecture-guide.md` §8.
 */
export function useRenderTrace(name: string): void {
  if (!WORKFLOW_PERF_ENABLED) return
  renderCounts.set(name, (renderCounts.get(name) ?? 0) + 1)
}

/** Zero every counter — called when a drag window opens. */
export function resetRenderCounts(): void {
  renderCounts.clear()
}

/** Current counters, highest render count first. */
export function getRenderCounts(): Array<{ component: string; renders: number }> {
  return [...renderCounts]
    .map(([component, renders]) => ({ component, renders }))
    .sort((a, b) => b.renders - a.renders)
}
