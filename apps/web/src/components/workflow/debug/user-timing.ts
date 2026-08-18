// apps/web/src/components/workflow/debug/user-timing.ts

import { WORKFLOW_PERF_ENABLED } from './perf-flag'

/**
 * Run `fn` inside a User Timing measure so a Chrome performance recording
 * attributes its cost in the Timings track without anyone reading a console.
 * Returns `fn()` untouched, and calls it directly when the switch is off.
 *
 * @param name measure name, e.g. `workflow:updateGraph`
 */
export function measureSync<T>(name: string, fn: () => T): T {
  if (!WORKFLOW_PERF_ENABLED) return fn()

  const startMark = `${name}:start`
  const endMark = `${name}:end`
  performance.mark(startMark)
  try {
    return fn()
  } finally {
    performance.mark(endMark)
    performance.measure(name, startMark, endMark)
    performance.clearMarks(startMark)
    performance.clearMarks(endMark)
  }
}
