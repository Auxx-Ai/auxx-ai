// apps/web/src/components/kb/ui/settings/general/branding-section.tsx
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
import { BaseType } from '~/components/workflow/types'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { useDraftSettingsAutosave } from '../../../hooks/use-draft-settings-autosave'
import { type KnowledgeBase, selectDraftedSections } from '../../../store/knowledge-base-store'
import { SectionStatusBadge } from '../section-header'

const brandingSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().nullish(),
})

type BrandingFormValues = z.infer<typeof brandingSchema>

interface BrandingSectionProps {
  knowledgeBaseId: string
  knowledgeBase: KnowledgeBase
}

function buildDefaults(kb: KnowledgeBase): BrandingFormValues {
  const merged = mergeDraftOverLive(kb as any) as KnowledgeBase
  return {
    name: merged.name,
    description: merged.description ?? '',
  }
}

export function BrandingSection({ knowledgeBaseId, knowledgeBase }: BrandingSectionProps) {
  const form = useForm<BrandingFormValues>({
    resolver: standardSchemaResolver(brandingSchema),
    defaultValues: buildDefaults(knowledgeBase),
  })

  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-hydrate on KB switch — autosave keeps the form in sync otherwise
  useEffect(() => {
    form.reset(buildDefaults(knowledgeBase), { keepDirty: false })
  }, [knowledgeBase.id, form])

  const watch = form.watch()
  const { isSaving, lastSavedAt } = useDraftSettingsAutosave(knowledgeBaseId, watch, {
    registryKey: 'branding',
  })
  const drafted = selectDraftedSections(knowledgeBase).has('identity')

  return (
    <Section
      title='Brand'
      description='Title and short description shown on your knowledge base.'
      actions={<SectionStatusBadge drafted={drafted} saving={isSaving} savedAt={lastSavedAt} />}>
      <Form {...form}>
        <VarEditorField orientation='vertical' className='p-0'>
          <FormField
            control={form.control}
            name='name'
            render={({ field, fieldState }) => (
              <VarEditorFieldRow
                title='Title'
                description='Overwrite the title and icon of your content when published.'
                type={BaseType.STRING}
                showIcon
                isRequired
                validationError={fieldState.error?.message}>
                <FieldInputAdapter
                  fieldType={FieldType.TEXT}
                  value={field.value}
                  onChange={(v) => field.onChange(v ?? '')}
                  placeholder='My Knowledge Base'
                />
              </VarEditorFieldRow>
            )}
          />

          <FormField
            control={form.control}
            name='description'
            render={({ field, fieldState }) => (
              <VarEditorFieldRow
                title='Description'
                description='A brief description of your knowledge base.'
                type={BaseType.STRING}
                showIcon
                validationError={fieldState.error?.message}>
                <FieldInputAdapter
                  fieldType={FieldType.TEXT}
                  value={field.value ?? ''}
                  onChange={(v) => field.onChange(v ?? '')}
                  placeholder='Enter a description...'
                />
              </VarEditorFieldRow>
            )}
          />
        </VarEditorField>
      </Form>
    </Section>
  )
}
