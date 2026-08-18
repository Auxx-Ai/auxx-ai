// apps/web/src/components/workflow/debug/perf-flag.ts

/** `localStorage` key that arms the probes across reloads. */
export const PERF_STORAGE_KEY = 'workflow:perf'

/**
 * Is the perf switch armed *right now* — `?perf=1` in the URL or a
 * `workflow:perf` key in `localStorage`, and never in a production build.
 *
 * Live read. Only `WorkflowPerfSwitch` should call this, to render its own
 * checked state; every probe reads {@link WORKFLOW_PERF_ENABLED} instead.
 */
export function isPerfArmed(): boolean {
  if (process.env.NODE_ENV === 'production') return false
  if (typeof window === 'undefined') return false

  try {
    if (new URLSearchParams(window.location.search).get('perf') === '1') return true
    return window.localStorage.getItem(PERF_STORAGE_KEY) !== null
  } catch {
    return false
  }
}

/**
 * Whether the dev-only workflow perf probes are armed for THIS page load.
 *
 * Evaluated exactly once, at module evaluation, so that nothing on a render path
 * — and nothing subscribed to a store — ever pays for the switch itself. A probe
 * that costs something when it is off would be a memorable way to fail. That is
 * also why `WorkflowPerfSwitch` reloads the page instead of mutating this.
 */
export const WORKFLOW_PERF_ENABLED = isPerfArmed()

/** `performance.now()` when the probes are armed, `0` otherwise. */
export function perfNow(): number {
  return WORKFLOW_PERF_ENABLED ? performance.now() : 0
}
