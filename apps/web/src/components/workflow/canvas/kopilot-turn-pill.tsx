// apps/web/src/components/workflow/canvas/kopilot-turn-pill.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useOrgChannel } from '~/realtime/hooks'
import { useWorkflowStore } from '../store/workflow-store'

/**
 * Canvas badge shown while a Kopilot turn holds the draft — Attio's "Building
 * workflow…" pill, which replaces the canvas toolbar for the span of a turn.
 *
 * Renders in place of the generic "Read Only" badge, which would otherwise be
 * what the user sees during a turn: technically true, actively misleading about
 * why.
 *
 * The LABEL deliberately decouples from the lock. The canvas locks at turn
 * start, which includes read-only turns ("what does this workflow do?") — see
 * `use-workflow-kopilot-turn.ts` for why locking only on the first mutation
 * leaves the race open. Claiming "editing" on a turn that only reads would be a
 * lie, so the pill opens at "working" and flips once a draft write actually
 * lands.
 *
 * That flip state lives HERE, with its own subscription, rather than on the
 * workflow store: `kopilotEditing` is read through `useReadOnly`, so every
 * canvas affordance re-renders when it changes. Putting a per-mutation signal
 * there would turn two re-renders per turn into one per mutation across the
 * whole canvas.
 */
export function KopilotTurnPill() {
  const kopilotEditing = useWorkflowStore((state) => state.kopilotEditing)
  const workflowAppId = useWorkflowStore((state) => state.workflow?.id)
  const [hasWritten, setHasWritten] = useState(false)

  // A turn ending resets the label for the next one.
  useEffect(() => {
    if (!kopilotEditing) setHasWritten(false)
  }, [kopilotEditing])

  const onEvent = useCallback(
    (event: string, payload: unknown) => {
      if (event !== 'workflow:draft-updated') return
      const data = (payload ?? {}) as { workflowAppId?: string; reason?: string }
      if (!workflowAppId || data.workflowAppId !== workflowAppId) return
      // `system` covers turn reverts and other platform writes — not the agent
      // editing, so it must not flip the label.
      if (data.reason !== 'kopilot') return
      setHasWritten(true)
    },
    [workflowAppId]
  )

  useOrgChannel({ onEvent })

  if (!kopilotEditing) return null

  return (
    <Badge variant='zinc'>
      <Loader2 className='size-3 mr-1.5 animate-spin' />
      {hasWritten ? 'Kopilot is editing…' : 'Kopilot is working…'}
    </Badge>
  )
}
