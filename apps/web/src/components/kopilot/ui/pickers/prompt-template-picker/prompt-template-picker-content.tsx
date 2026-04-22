// apps/web/src/components/kopilot/ui/pickers/prompt-template-picker/prompt-template-picker-content.tsx

'use client'

import type { PromptTemplateItem } from '@auxx/lib/prompt-templates'
import type { SelectOption } from '@auxx/types/custom-field'
import { useMemo } from 'react'
import { MultiSelectPicker } from '~/components/pickers/multi-select-picker'
import { usePromptTemplateMutations } from '../../../hooks/use-prompt-template-mutations'
import { usePromptTemplates } from '../../../hooks/use-prompt-templates'

interface PromptTemplatePickerContentProps {
  /** Called when a template is selected — parent inserts badge into editor */
  onSelect: (template: PromptTemplateItem) => void
  /** Called when user clicks "Create prompt" — parent opens dialog */
  onCreateRequest: () => void
  /** Called when user clicks edit on a template — parent opens edit dialog */
  onEditRequest: (template: PromptTemplateItem) => void
  /** Called when user clicks "Browse prompts" — parent opens browse dialog */
  onBrowseRequest: () => void
  /**
   * Called when the user presses Backspace on the empty cmdk search.
   * Wire to the inline-picker hook's `closePicker` to dismiss the popover
   * and delete the trigger character from the editor.
   */
  onClose?: () => void
}

export function PromptTemplatePickerContent({
  onSelect,
  onCreateRequest,
  onEditRequest,
  onBrowseRequest,
  onClose,
}: PromptTemplatePickerContentProps) {
  const { templates, isLoading } = usePromptTemplates()
  const { remove } = usePromptTemplateMutations()

  const templateOptions: SelectOption[] = useMemo(
    () =>
      templates.map((t) => ({
        value: t.id,
        label: t.name,
        icon: t.icon?.iconId,
        color: t.icon?.color,
      })),
    [templates]
  )

  const handleSelectSingle = (value: string) => {
    const template = templates.find((t) => t.id === value)
    if (template) {
      onSelect(template)
    }
  }

  const handleEdit = (value: string) => {
    const template = templates.find((t) => t.id === value)
    if (template) {
      onEditRequest(template)
    }
  }

  const handleOptionsChange = (options: SelectOption[]) => {
    // Detect deletions (option removed from list)
    const optionIds = new Set(options.map((o) => o.value))
    for (const template of templates) {
      if (!optionIds.has(template.id) && template.type === 'user') {
        remove.mutate({ id: template.id })
      }
    }
  }

  return (
    <div
      onKeyDown={(e) => {
        if (!onClose) return
        if (e.key !== 'Backspace') return
        // MultiSelectPicker renders a cmdk input; check its value to decide
        // whether Backspace should dismiss the popover or just delete a char.
        const input = (e.currentTarget as HTMLElement).querySelector<HTMLInputElement>(
          '[cmdk-input]'
        )
        if (input && input.value.length === 0) {
          e.preventDefault()
          onClose()
        }
      }}>
      <MultiSelectPicker
        options={templateOptions}
        value={[]}
        onChange={() => {}}
        multi={false}
        canManage={false}
        canAdd={true}
        onCreate={onCreateRequest}
        createLabel='Create prompt'
        onBrowse={onBrowseRequest}
        browseLabel='Browse prompts'
        onSelectSingle={handleSelectSingle}
        onEdit={handleEdit}
        placeholder='Search prompts...'
        isLoading={isLoading}
        onOptionsChange={handleOptionsChange}
      />
    </div>
  )
}
