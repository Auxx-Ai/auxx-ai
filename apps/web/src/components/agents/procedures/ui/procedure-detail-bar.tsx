// apps/web/src/components/agents/procedures/ui/procedure-detail-bar.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { useNavStack } from '@auxx/ui/components/nav-stack'
import { ChevronLeft } from 'lucide-react'
import { AutosaveIndicator, type AutosaveState } from '../../ui/shared/autosave-indicator'
import { useProcedure } from '../hooks/use-procedure'
import { ProcedurePublishCluster } from './procedure-publish-cluster'

interface ProcedureDetailBarProps {
  procedureId: string
  /** Lifted from the editor — shows live Saving…/Saved next to the publish cluster. */
  autosave: AutosaveState
  /** Bumped by the publish cluster after revert/discard to remount the editor canvas. */
  onReload?: () => void
}

/**
 * The procedure-detail nav bar: the shared-bar content for the pushed `procedure`
 * NavStack level. Same height as the agent tab strip (`h-9`) so the shared
 * `<NavStackBar>` frame doesn't jump as the two cross-fade. Carries Back, the
 * procedure name, autosave status, and the publish cluster (status pill +
 * publish/changes/discard + `⌄`: version history / delete).
 *
 * Rendered by `<NavStackBar>` (which sits OUTSIDE `NavStackPanels`' `overflow-hidden`),
 * so the page-level sticky bar pins to the outer `ScrollArea` while the panels slide.
 */
export function ProcedureDetailBar({ procedureId, autosave, onReload }: ProcedureDetailBarProps) {
  const { pop } = useNavStack()
  // Store-backed (optimistic) meta — the title tracks live edits because it reads
  // the same overlay the editor writes to.
  const { meta } = useProcedure(procedureId)

  const name = meta?.name ?? 'Procedure'

  return (
    <div className='flex h-9 items-center gap-2 px-2'>
      <Button variant='ghost' size='sm' onClick={() => pop()}>
        <ChevronLeft />
        Back
      </Button>
      <span className='truncate text-sm font-medium'>{name}</span>
      <div className='ml-auto flex items-center gap-2'>
        <AutosaveIndicator state={autosave} />
        <ProcedurePublishCluster procedureId={procedureId} onReload={onReload} />
      </div>
    </div>
  )
}
