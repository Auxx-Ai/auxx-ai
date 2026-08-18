// apps/web/src/components/workflow/debug/perf-switch.tsx
'use client'

import { ButtonSwitch } from '@auxx/ui/components/button-switch'
import { useEffect, useState } from 'react'
import { isPerfArmed, PERF_STORAGE_KEY } from './perf-flag'

/**
 * Dev-only toggle for the workflow perf probes (`plans/workflow/debug/canvas-performance-and-debug-switch.md` §3).
 *
 * **Reloads the page on every flip, by design.** `WORKFLOW_PERF_ENABLED` is read
 * once at module evaluation precisely so nothing on a render path pays for the
 * switch when it is off; making it reactive would hand that cost back. A reload
 * is the honest way to re-read it.
 *
 * Flipping also strips `?perf=1` from the URL, so this control is the single
 * authority once used — otherwise toggling "off" while the query param armed the
 * probes would appear to do nothing.
 *
 * Callers must gate the render on `process.env.NODE_ENV`, not on this component,
 * so the bundler can eliminate it from production builds entirely.
 */
export function WorkflowPerfSwitch() {
  // Resolved after mount: `localStorage` does not exist during SSR, and seeding
  // state from it directly would render a different `checked` on the server than
  // on the client.
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    setArmed(isPerfArmed())
  }, [])

  const handleChange = (next: boolean) => {
    try {
      if (next) window.localStorage.setItem(PERF_STORAGE_KEY, '1')
      else window.localStorage.removeItem(PERF_STORAGE_KEY)
    } catch {
      // Private-mode or blocked storage — nothing to persist, so nothing to reload for.
      return
    }

    const url = new URL(window.location.href)
    url.searchParams.delete('perf')
    window.location.replace(url.toString())
  }

  return <ButtonSwitch label='Perf probe' checked={armed} onCheckedChange={handleChange} />
}
