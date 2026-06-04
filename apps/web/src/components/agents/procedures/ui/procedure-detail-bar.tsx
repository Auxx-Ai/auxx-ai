// apps/web/src/components/agents/procedures/ui/procedure-detail-bar.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { useNavStack } from '@auxx/ui/components/nav-stack'
import { toastError } from '@auxx/ui/components/toast'
import { ChevronLeft } from 'lucide-react'
import { useCallback } from 'react'
import { api } from '~/trpc/react'
import { AutosaveIndicator, type AutosaveState } from '../../ui/shared/autosave-indicator'

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
  const utils = api.useUtils()
  const query = api.procedure.getById.useQuery({ id: procedureId })
  const publish = api.procedure.publish.useMutation()

  const data = query.data
  const name = data?.name ?? 'Procedure'
  const whenToUseEmpty = (data?.whenToUse ?? '').trim() === ''

  const handlePublish = useCallback(async () => {
    try {
      await publish.mutateAsync({ id: procedureId })
      await utils.procedure.getById.invalidate({ id: procedureId })
      await utils.procedure.listVersions.invalidate({ id: procedureId })
    } catch (err) {
      toastError({ title: 'Publish failed', description: (err as Error).message })
    }
  }, [publish, procedureId, utils])

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
          loading={publish.isPending}
          loadingText='Publishing…'
          disabled={whenToUseEmpty}
          onClick={handlePublish}>
          Publish
        </Button>
      </div>
    </div>
  )
}
