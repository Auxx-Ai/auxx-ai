// apps/web/src/components/agents/procedures/ui/procedure-detail-bar.tsx
'use client'

import { AutosizeInput, type AutosizeInputRef } from '@auxx/ui/components/autosize-input'
import { Button } from '@auxx/ui/components/button'
import { useNavStack } from '@auxx/ui/components/nav-stack'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AutosaveIndicator, type AutosaveState } from '../../ui/shared/autosave-indicator'
import { useProcedure } from '../hooks/use-procedure'
import { useProcedureMutations } from '../hooks/use-procedure-mutations'
import { useProcedureDraft } from './procedure-draft-provider'
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
 * AND `drill` NavStack levels (same instance). Same height as the agent tab strip
 * (`h-9`) so the shared `<NavStackBar>` frame doesn't jump as the levels cross-fade.
 * Carries Back, the editable name, autosave status, and the publish cluster (status
 * pill + publish/changes/discard + `⌄`: version history / delete).
 *
 * Context-aware title: at the `procedure` level the input renames the procedure; when
 * drilled into a `sub:`/`code:` body it renames THAT block (via the lifted draft owner)
 * and shows the procedure name as a back-crumb. One header for the whole stack — no
 * second name field inside the panel.
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
  const draft = useProcedureDraft()

  // Which entity the bar is titling: the drilled block when drilled, else the procedure.
  const drill = draft?.drill ?? null
  const subId = drill?.startsWith('sub:') ? drill.slice('sub:'.length) : null
  const codeId = drill?.startsWith('code:') ? drill.slice('code:'.length) : null
  const isDrilled = Boolean(subId || codeId)

  const procedureName = meta?.name ?? 'Procedure'
  const blockName = subId
    ? draft?.subProcedures.find((s) => s.id === subId)?.name
    : codeId
      ? draft?.codeBlocks.find((c) => c.id === codeId)?.name
      : undefined
  const name = isDrilled ? (blockName ?? '') : procedureName
  const placeholder = subId ? 'Sub-procedure name' : codeId ? 'Code block name' : 'Procedure name'

  // Local draft so typing stays smooth; the optimistic update lands via the right
  // writer. Re-seed from `name` when it changes externally (procedure switch, drill
  // change, or background refetch) but never while focused — that would clobber an
  // in-progress edit. The bar is reused across levels (not keyed).
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
    if (subId && draft) draft.renameSubProcedure(subId, trimmed)
    else if (codeId && draft) draft.renameCodeBlock(codeId, trimmed)
    else patchMeta(procedureId, { name: trimmed })
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
      {isDrilled && (
        <>
          <button
            type='button'
            onClick={() => pop()}
            className='shrink-0 truncate max-w-[140px] text-sm text-muted-foreground hover:text-foreground'>
            {procedureName}
          </button>
          <ChevronRight className='size-3.5 shrink-0 text-muted-foreground' />
        </>
      )}
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
        placeholder={placeholder}
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
