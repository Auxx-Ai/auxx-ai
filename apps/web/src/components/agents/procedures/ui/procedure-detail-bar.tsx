// apps/web/src/components/agents/procedures/ui/procedure-detail-bar.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { useNavStack } from '@auxx/ui/components/nav-stack'
import { ChevronLeft } from 'lucide-react'
import { AutosaveIndicator, type AutosaveState } from '../../ui/shared/autosave-indicator'
import { useProcedure } from '../hooks/use-procedure'
import { useProcedureMutations } from '../hooks/use-procedure-mutations'

interface ProcedureDetailBarProps {
  procedureId: string
  /** Lifted from the editor — shows live Saving…/Saved next to Publish. */
  autosave: AutosaveState
}

/**
 * The procedure-detail nav bar: the shared-bar content for the pushed `procedure`
 * NavStack level. Same height as the agent tab strip (`h-9`) so the shared
 * `<NavStackBar>` frame doesn't jump as the two cross-fade. Carries Back, the
 * procedure name, autosave status, and Publish — version history lands here next.
 *
 * Rendered by `<NavStackBar>` (which sits OUTSIDE `NavStackPanels`' `overflow-hidden`),
 * so the page-level sticky bar pins to the outer `ScrollArea` while the panels slide.
 */
export function ProcedureDetailBar({ procedureId, autosave }: ProcedureDetailBarProps) {
  const { pop } = useNavStack()
  // Store-backed (optimistic) meta — the title + Publish-enabled state track
  // live edits because both read the same overlay the editor writes to.
  const { meta } = useProcedure(procedureId)
  const { publish, isPublishing } = useProcedureMutations()

  const name = meta?.name ?? 'Procedure'
  const whenToUseEmpty = (meta?.whenToUse ?? '').trim() === ''

  return (
    <div className='flex h-9 items-center gap-2 px-2'>
      <Button variant='ghost' size='sm' onClick={() => pop()}>
        <ChevronLeft />
        Back
      </Button>
      <span className='truncate text-sm font-medium'>{name}</span>
      <div className='ml-auto flex items-center gap-2'>
        <AutosaveIndicator state={autosave} />
        {/* TODO: version-history dropdown (procedure.listVersions + revert) lands here. */}
        <Button
          size='sm'
          loading={isPublishing}
          loadingText='Publishing…'
          disabled={whenToUseEmpty}
          onClick={() => void publish(procedureId)}>
          Publish
        </Button>
      </div>
    </div>
  )
}
