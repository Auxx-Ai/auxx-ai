// apps/web/src/components/data-connectors/ui/stream-detail-bar.tsx
'use client'

import { AutosizeInput, type AutosizeInputRef } from '@auxx/ui/components/autosize-input'
import { Button } from '@auxx/ui/components/button'
import { useNavStack } from '@auxx/ui/components/nav-stack'
import { ChevronLeft, CircleHelp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { getConnectorDraftState, useConnectorDraftStore } from '../stores/connector-draft-store'
import { StreamGuideDialog } from './stream-guide-dialog'

interface StreamDetailBarProps {
  connectorId: string
  streamId: string
  /** Null until the user names the stream — the input shows its placeholder. */
  streamKey: string | null
  /** Hides request/pagination copy in the guide for app-kind connectors. */
  isGenericRest: boolean
}

/**
 * Shared-bar content for the pushed `stream` drill level. Carries the iOS-style
 * back affordance plus an inline-editable stream name — the stream is created
 * blank from the section and named here (mirrors the agent `ProcedureDetailBar`).
 * Rename writes the connector DRAFT (plans/data-connectors/v4); the save bar commits it.
 */
export function StreamDetailBar({
  connectorId,
  streamId,
  streamKey,
  isGenericRest,
}: StreamDetailBarProps) {
  const { pop } = useNavStack()
  const [guideOpen, setGuideOpen] = useState(false)
  // Prefer the draft's stream name so an unsaved rename shows live; fall back to the prop.
  const draftKey = useConnectorDraftStore(
    (s) => s.draft.streams.find((st) => st.id === streamId)?.streamKey
  )
  const name = draftKey ?? streamKey ?? ''

  // Local draft so typing stays smooth; the optimistic write lands on commit.
  // Re-seed from `streamKey` when it changes externally (stream switch, refetch)
  // but never while focused — that would clobber an in-progress edit.
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
    getConnectorDraftState().renameStream(streamId, trimmed)
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
    <div className='flex h-9 items-center gap-2 px-2'>
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
        placeholder='Stream name'
        inputClassName='text-sm font-medium text-foreground bg-transparent outline-none truncate placeholder:text-muted-foreground'
        minWidth={40}
        maxWidth={240}
      />
      <Button variant='ghost' size='xs' className='ml-auto' onClick={() => setGuideOpen(true)}>
        <CircleHelp />
        Guide
      </Button>
      {guideOpen && (
        <StreamGuideDialog
          open={guideOpen}
          onOpenChange={setGuideOpen}
          isGenericRest={isGenericRest}
        />
      )}
    </div>
  )
}
