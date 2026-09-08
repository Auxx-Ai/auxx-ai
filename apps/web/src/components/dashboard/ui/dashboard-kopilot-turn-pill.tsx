// apps/web/src/components/dashboard/ui/dashboard-kopilot-turn-pill.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useOrgChannel } from '~/realtime/hooks'
import { useDashboardTurnLock } from '../hooks/use-dashboard-kopilot-turn'

/**
 * Header badge shown while a Kopilot turn holds the dashboard's draft. It sits
 * where the Edit / Done cluster is, because for the span of a turn that cluster
 * is exactly what the user has lost, and a canvas that has silently stopped
 * responding with no explanation is the failure this replaces.
 *
 * The LABEL deliberately decouples from the lock. The lock is claimed on the
 * FIRST TOOL CALL OF ANY KIND, reads included (plan v3/03 §1 — locking only on
 * the first write leaves the send-to-first-write window open), so "what does
 * this dashboard show?" locks the canvas exactly like "add a revenue chart"
 * does. Claiming "editing" on a turn that only reads would be a lie, so the
 * pill opens at "working" and flips once a draft write actually lands.
 *
 * That flip lives HERE, with its own subscription, rather than on the turn
 * lock: the lock drives the canvas read-only clamp, so every affordance
 * re-renders when it changes. Putting a per-mutation signal there would turn
 * two re-renders per turn into one per mutation across the whole page.
 */
export function DashboardKopilotTurnPill({ dashboardId }: { dashboardId: string }) {
  const active = useDashboardTurnLock(dashboardId)
  const [hasWritten, setHasWritten] = useState(false)

  // A turn ending resets the label for the next one.
  useEffect(() => {
    if (!active) setHasWritten(false)
  }, [active])

  const onEvent = useCallback(
    (event: string, payload: unknown) => {
      if (event !== 'dashboard:draft-updated') return
      const data = (payload ?? {}) as { dashboardId?: string; reason?: string }
      if (data.dashboardId !== dashboardId) return
      // `system` covers turn reverts and other platform writes, not the agent
      // editing, so it must not flip the label.
      if (data.reason !== 'kopilot') return
      setHasWritten(true)
    },
    [dashboardId]
  )

  useOrgChannel({ onEvent })

  if (!active) return null

  return (
    <Badge variant='zinc'>
      <Loader2 className='mr-1.5 size-3 animate-spin' />
      {hasWritten ? 'Kopilot is editing…' : 'Kopilot is working…'}
    </Badge>
  )
}
