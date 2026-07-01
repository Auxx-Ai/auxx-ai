// apps/web/src/components/kb/ui/settings/general/modes-section.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { mergeDraftOverLive } from '@auxx/lib/kb/client'
import { Form, FormField } from '@auxx/ui/components/form'
import { Section } from '@auxx/ui/components/section'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { useDraftSettingsAutosave } from '../../../hooks/use-draft-settings-autosave'
import { type KnowledgeBase, selectDraftedSections } from '../../../store/knowledge-base-store'
import { SectionStatusBadge } from '../section-header'

const modesSchema = z.object({
  showMode: z.boolean().default(true),
  defaultMode: z.enum(['light', 'dark']).default('light'),
})

type ModesFormValues = z.infer<typeof modesSchema>

const lower = (v: string | null | undefined) => (v ? v.toLowerCase() : v)

function buildDefaults(kb: KnowledgeBase): ModesFormValues {
  const merged = mergeDraftOverLive(kb as any) as KnowledgeBase
  return {
    showMode: merged.showMode,
    defaultMode: (lower(merged.defaultMode) as ModesFormValues['defaultMode']) || 'light',
  }
}

const MODE_OPTIONS = [
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
]

interface ModesSectionProps {
  knowledgeBaseId: string
  knowledgeBase: KnowledgeBase
}

export function ModesSection({ knowledgeBaseId, knowledgeBase }: ModesSectionProps) {
  const form = useForm<ModesFormValues>({
    resolver: standardSchemaResolver(modesSchema),
    defaultValues: buildDefaults(knowledgeBase),
  })

  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-hydrate on KB switch — autosave keeps the form in sync otherwise
  useEffect(() => {
    form.reset(buildDefaults(knowledgeBase))
  }, [knowledgeBase.id, form])

  const watch = form.watch()
  const { isSaving, lastSavedAt } = useDraftSettingsAutosave(knowledgeBaseId, watch, {
    registryKey: 'modes',
  })
  const drafted = selectDraftedSections(knowledgeBase).has('modes')

  return (
    <Section
      title='Modes'
      description='Light/dark mode behaviour for visitors.'
      actions={<SectionStatusBadge drafted={drafted} saving={isSaving} savedAt={lastSavedAt} />}>
      <Form {...form}>
        <FieldPanel orientation='responsive' className='p-0' resizeId='kb-settings'>
          <FormField
            control={form.control}
            name='showMode'
            render={({ field, fieldState }) => (
              <FieldPanelRow
                title='Show switcher'
                description='Allow users to switch between light and dark mode.'
                type={BaseType.BOOLEAN}
                showIcon
                validationError={fieldState.error?.message}>
                <FieldInputAdapter
                  fieldType={FieldType.CHECKBOX}
                  fieldOptions={{ variant: 'switch' }}
                  value={field.value}
                  onChange={(v) => field.onChange(v)}
                />
              </FieldPanelRow>
            )}
          />

          <FormField
            control={form.control}
            name='defaultMode'
            render={({ field, fieldState }) => (
              <FieldPanelRow
                title='Default mode'
                description='All your viewers will see this mode by default.'
                type={BaseType.ENUM}
                showIcon
                validationError={fieldState.error?.message}>
                <FieldInputAdapter
                  fieldType={FieldType.SINGLE_SELECT}
                  fieldOptions={{ options: MODE_OPTIONS }}
                  value={field.value}
                  onChange={(v) => field.onChange((v as string[])[0] ?? 'light')}
                  placeholder='Pick…'
                  triggerProps={{ className: 'w-full' }}
                />
              </FieldPanelRow>
            )}
          />
        </FieldPanel>
      </Form>
    </Section>
  )
}
