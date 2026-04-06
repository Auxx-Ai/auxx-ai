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
}

export function PromptTemplatePickerContent({
  onSelect,
  onCreateRequest,
  onEditRequest,
  onBrowseRequest,
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
  )
}
