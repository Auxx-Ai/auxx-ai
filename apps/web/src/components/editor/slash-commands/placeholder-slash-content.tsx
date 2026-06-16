// apps/web/src/components/editor/slash-commands/placeholder-slash-content.tsx
'use client'

import { useImperativeHandle, useRef } from 'react'
import { PlaceholderPickerContent } from '~/components/editor/placeholders/placeholder-picker-content'
import { useCmdkRemote } from '~/components/pickers/use-cmdk-remote'
import type { SlashContentHandle } from './slash-list'

export interface PlaceholderSlashContentProps {
  /** Keyboard handle — the chip forwards Enter / arrows / Backspace-empty here. */
  ref?: React.Ref<SlashContentHandle>
  /** Invoked with the token id — caller deletes the chip + inserts the placeholder node. */
  onSelect: (id: string) => void
  /** Close the chip (keeps the typed text, mirroring `@`). */
  onClose: () => void
  /**
   * Back affordance when mounted as a drilled level under a parent slash menu
   * (mail's "Insert placeholder" tool). Omit at the root — e.g. the snippet
   * editor's `{` trigger opens straight into the picker.
   */
  onBack?: () => void
  /** Label for the back header shown when `onBack` is set. */
  backLabel?: string
}

/**
 * Chip-driven placeholder picker — the entity-root → field drill
 * (`PlaceholderPickerContent`) wrapped as `SlashContentProps`. It's
 * input-driven (its own CommandInput takes real focus), so the chip goes
 * inert for the duration; `popLevel` pops back to the parent menu when
 * embedded under one.
 *
 * Shared by the mail composer's "Insert placeholder" drill and the snippet
 * editor's `{` trigger.
 */
export function PlaceholderSlashContent({
  ref,
  onSelect,
  onClose,
  onBack,
  backLabel,
}: PlaceholderSlashContentProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const remote = useCmdkRemote(containerRef, 'placeholder')

  useImperativeHandle(
    ref,
    () => ({
      ...remote,
      popLevel: () => {
        if (!onBack) return false
        onBack()
        return true
      },
    }),
    [remote, onBack]
  )

  return (
    <div ref={containerRef} className='w-72 overflow-hidden'>
      <PlaceholderPickerContent
        onBack={onBack}
        backLabel={backLabel}
        onClose={onClose}
        onSelect={onSelect}
      />
    </div>
  )
}
