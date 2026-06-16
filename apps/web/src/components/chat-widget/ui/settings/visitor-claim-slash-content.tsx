// apps/web/src/components/chat-widget/ui/settings/visitor-claim-slash-content.tsx
'use client'

import { useImperativeHandle, useRef } from 'react'
import type { SlashContentHandle } from '~/components/editor/slash-commands/slash-list'
import { useCmdkRemote } from '~/components/pickers/use-cmdk-remote'
import { VisitorClaimPickerContent } from './visitor-claim-picker-content'

interface VisitorClaimSlashContentProps {
  /** Keyboard handle — the chip forwards Enter / arrows / Backspace-empty here. */
  ref?: React.Ref<SlashContentHandle>
  /** Invoked with the token id — caller deletes the chip + inserts the placeholder node. */
  onSelect: (id: string) => void
  /** Close the chip (keeps the typed text). */
  onClose: () => void
}

/**
 * Chip-driven visitor-claim picker — the three visitor identify claims
 * (`VisitorClaimPickerContent`) wrapped as `SlashContentProps`. Flat (no
 * drill), input-driven (its own CommandInput takes focus), so the chip goes
 * inert for the duration and `popLevel` is a no-op.
 */
export function VisitorClaimSlashContent({
  ref,
  onSelect,
  onClose,
}: VisitorClaimSlashContentProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const remote = useCmdkRemote(containerRef, 'visitor-claim')

  useImperativeHandle(ref, () => ({ ...remote, popLevel: () => false }), [remote])

  return (
    <div ref={containerRef} className='w-60 overflow-hidden'>
      <VisitorClaimPickerContent onClose={onClose} onSelect={onSelect} />
    </div>
  )
}
