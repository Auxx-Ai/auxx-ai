// apps/web/src/components/kopilot/ui/pickers/prompt-template-picker/prompt-template-slash-content.tsx

'use client'

import type { PromptTemplateItem } from '@auxx/lib/prompt-templates'
import type { Editor } from '@tiptap/react'
import { useImperativeHandle, useRef } from 'react'
import type { SlashContentHandle } from '~/components/editor/slash-commands/slash-list'
import { useCmdkRemote } from '~/components/pickers/use-cmdk-remote'
import { PromptTemplatePickerContent } from './prompt-template-picker-content'

type Range = { from: number; to: number }

interface PromptTemplateSlashContentProps {
  /** Keyboard handle — the `/` chip forwards Enter / arrows / Backspace-empty here. */
  ref?: React.Ref<SlashContentHandle>
  /**
   * Run an executor with the chip's range. The executor must `deleteRange(range)`
   * inside its own chain so chip removal + the insert land in ONE transaction.
   */
  onExecute: (cmd: (editor: Editor, range: Range) => void) => void
  /** Close the chip (keeps the typed text). */
  onClose: () => void
  /** Open the create-prompt dialog. */
  onCreateRequest: () => void
  /** Open the edit dialog for a template. */
  onEditRequest: (template: PromptTemplateItem) => void
  /** Close the chip and open the browse dialog. */
  onBrowseRequest: () => void
}

/**
 * Chip-driven prompt-template picker — wraps `PromptTemplatePickerContent`
 * (a `MultiSelectPicker`) as `SlashContentProps`. Input-driven (its own cmdk
 * input takes focus), so the `/` chip goes inert for the duration and
 * `popLevel` is a no-op. Selecting a template deletes the chip and inserts a
 * `promptTemplate` badge node in one transaction.
 */
export function PromptTemplateSlashContent({
  ref,
  onExecute,
  onClose,
  onCreateRequest,
  onEditRequest,
  onBrowseRequest,
}: PromptTemplateSlashContentProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const remote = useCmdkRemote(containerRef, 'prompt-template')

  useImperativeHandle(ref, () => ({ ...remote, popLevel: () => false }), [remote])

  return (
    <div ref={containerRef}>
      <PromptTemplatePickerContent
        onClose={onClose}
        onSelect={(template) => {
          onExecute((editor, range) => {
            editor
              .chain()
              .focus()
              .deleteRange(range)
              .insertContent({ type: 'promptTemplate', attrs: { id: template.id } })
              .insertContent(' ')
              .run()
          })
        }}
        onCreateRequest={onCreateRequest}
        onEditRequest={onEditRequest}
        onBrowseRequest={onBrowseRequest}
      />
    </div>
  )
}
