// apps/web/src/components/agents/procedures/ui/procedure-detail-bar.tsx
'use client'

import { AutosizeInput, type AutosizeInputRef } from '@auxx/ui/components/autosize-input'
import { Button } from '@auxx/ui/components/button'
import { useNavStack } from '@auxx/ui/components/nav-stack'
import { ChevronLeft } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AutosaveIndicator, type AutosaveState } from '../../ui/shared/autosave-indicator'
import { useProcedure } from '../hooks/use-procedure'
import { useProcedureMutations } from '../hooks/use-procedure-mutations'
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
 * editable procedure name, autosave status, and the publish cluster (status pill +
 * publish/changes/discard + `⌄`: version history / delete).
 *
 * Rendered by `<NavStackBar>` (which sits OUTSIDE `NavStackPanels`' `overflow-hidden`),
 * so the page-level sticky bar pins to the outer `ScrollArea` while the panels slide.
 */
export function ProcedureDetailBar({ procedureId, autosave, onReload }: ProcedureDetailBarProps) {
  const { pop } = useNavStack()
  // Store-backed (optimistic) meta — the title tracks live edits because it reads
  // the same overlay the rename writes to.
  const { meta } = useProcedure(procedureId)
  const { patchMeta } = useProcedureMutations()

  const name = meta?.name ?? 'Procedure'

  // Local draft so typing stays smooth; the optimistic store update lands via
  // `patchMeta`. Re-seed from `name` when it changes externally (procedure switch
  // or background refetch) but never while the field is focused — that would
  // clobber an in-progress edit. The bar is reused across procedures (not keyed).
  const inputRef = useRef<AutosizeInputRef>(null)
  const [editValue, setEditValue] = useState(name)
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setEditValue(name)
  }, [name, focused])

  const commitName = () => {
    const trimmed = editValue.trim()
    if (!trimmed || trimmed === name) {
      setEditValue(name)
      return
    }
    patchMeta(procedureId, { name: trimmed })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      inputRef.current?.blur()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setEditValue(name)
      inputRef.current?.blur()
    }
  }

  return (
    <div className='flex h-9 items-center gap-2 px-2 no-scrollbar overflow-y-auto'>
      <Button variant='ghost' size='icon-xs' className='rounded-md' onClick={() => pop()}>
        <ChevronLeft />
      </Button>
      <AutosizeInput
        ref={inputRef}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          commitName()
        }}
        onKeyDown={handleKeyDown}
        placeholder='Procedure name'
        inputClassName='text-sm font-medium text-foreground bg-transparent outline-none truncate placeholder:text-muted-foreground'
        minWidth={40}
        maxWidth={240}
      />
      <div className='ml-auto flex items-center gap-2 pr-2 shrink-0'>
        <AutosaveIndicator state={autosave} />
        <ProcedurePublishCluster procedureId={procedureId} onReload={onReload} />
      </div>
    </div>
  )
}
