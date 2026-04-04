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
}

export function PromptTemplatePickerContent({
  onSelect,
  onCreateRequest,
}: PromptTemplatePickerContentProps) {
  const { templates, isLoading } = usePromptTemplates()
  const { update, remove } = usePromptTemplateMutations()

  const templateOptions: SelectOption[] = useMemo(
    () =>
      templates.map((t) => ({
        value: t.id,
        label: t.name,
        icon: t.icon?.iconId,
        color: undefined,
      })),
    [templates]
  )

  const handleSelectSingle = (value: string) => {
    const template = templates.find((t) => t.id === value)
    if (template) {
      onSelect(template)
    }
  }

  const handleOptionsChange = (options: SelectOption[]) => {
    // Detect renames and deletions by comparing with current templates
    const currentMap = new Map(templates.map((t) => [t.id, t]))

    for (const opt of options) {
      const existing = currentMap.get(opt.value)
      if (existing && existing.name !== opt.label && existing.type === 'user') {
        update.mutate({ id: opt.value, name: opt.label })
      }
    }

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
      canManage={true}
      canAdd={true}
      onCreate={onCreateRequest}
      createLabel='Create prompt'
      onSelectSingle={handleSelectSingle}
      placeholder='Search prompts...'
      isLoading={isLoading}
      onOptionsChange={handleOptionsChange}
    />
  )
}
