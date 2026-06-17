// apps/web/src/components/kbar/select-on-enter.ts
'use client'

import type { KeyboardEvent } from 'react'

/**
 * Completes cmdk's Enter-to-select when it was suppressed by the shared
 * `DialogContent`. That component installs a capture-phase keydown handler that
 * `preventDefault()`s Enter on focused text inputs (to block implicit form
 * submission); cmdk, in turn, skips its own Enter handling when
 * `event.defaultPrevented` is already set — so inside the palette Enter would do
 * nothing. We detect that exact case (`defaultPrevented` at the Command level)
 * and click the highlighted row ourselves. When the input isn't focused,
 * `defaultPrevented` is false and cmdk handles Enter normally, so we no-op to
 * avoid a double fire.
 */
export function selectOnEnter(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Enter' || !event.defaultPrevented) return
  const selected = event.currentTarget.querySelector<HTMLElement>(
    '[cmdk-item][aria-selected="true"]'
  )
  selected?.click()
}
