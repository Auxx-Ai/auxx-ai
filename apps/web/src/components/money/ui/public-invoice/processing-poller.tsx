// apps/web/src/components/money/ui/public-invoice/processing-poller.tsx
'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'

const POLL_INTERVAL_MS = 3_000
const MAX_POLLS = 40 // ~2 minutes

/**
 * Re-fetches the public pay page's server data on an interval while a payment is
 * processing (money MP1 build spec §I) — the webhook is the source of truth, this just
 * closes the gap between "Stripe redirected back" and "the ledger row landed" without ever
 * fabricating a `succeeded` state client-side. Stops once the page re-renders with
 * `active: false` (the row flipped to `succeeded`/`refunded` or the org-visible balance hit
 * zero) or after `MAX_POLLS`.
 */
export function ProcessingPoller({ active }: { active: boolean }) {
  const router = useRouter()
  const countRef = useRef(0)

  useEffect(() => {
    if (!active) {
      countRef.current = 0
      return
    }
    const interval = setInterval(() => {
      countRef.current += 1
      if (countRef.current > MAX_POLLS) {
        clearInterval(interval)
        return
      }
      router.refresh()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [active, router])

  return null
}
