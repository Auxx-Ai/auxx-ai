// apps/web/src/components/kb/ui/settings/layout/header-section.tsx
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
import { NavigationManager } from './navigation-manager'

const navigationItemSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  link: z.string().min(1, 'Link is required'),
})

const headerSchema = z.object({
  headerEnabled: z.boolean().default(true),
  searchbarPosition: z.enum(['center', 'corner']).default('center'),
  headerNavigation: z.array(navigationItemSchema).default([]),
})

type HeaderFormValues = z.infer<typeof headerSchema>

const SEARCHBAR_OPTIONS = [
  { label: 'Center', value: 'center' },
  { label: 'Corner', value: 'corner' },
]

function buildDefaults(kb: KnowledgeBase): HeaderFormValues {
  const merged = mergeDraftOverLive(kb as any) as KnowledgeBase
  return {
    headerEnabled: merged.headerEnabled ?? true,
    searchbarPosition:
      (merged.searchbarPosition as HeaderFormValues['searchbarPosition']) || 'center',
    headerNavigation:
      ((merged.headerNavigation ?? []) as HeaderFormValues['headerNavigation']) ?? [],
  }
}

interface HeaderSectionProps {
  knowledgeBaseId: string
  knowledgeBase: KnowledgeBase
}

export function HeaderSection({ knowledgeBaseId, knowledgeBase }: HeaderSectionProps) {
  const form = useForm<HeaderFormValues>({
    resolver: standardSchemaResolver(headerSchema),
    defaultValues: buildDefaults(knowledgeBase),
  })

  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-hydrate on KB switch — autosave keeps the form in sync otherwise
  useEffect(() => {
    form.reset(buildDefaults(knowledgeBase))
  }, [knowledgeBase.id, form])

  const headerEnabled = form.watch('headerEnabled')
  const watch = form.watch()
  const { isSaving, lastSavedAt } = useDraftSettingsAutosave(knowledgeBaseId, watch, {
    registryKey: 'header',
  })
  const drafted = selectDraftedSections(knowledgeBase).has('header')

  return (
    <Section
      title='Header'
      description='Top navigation and search bar visible across all pages.'
      showEnable
      enabled={headerEnabled}
      onEnableChange={(checked) => form.setValue('headerEnabled', checked, { shouldDirty: true })}
      actions={<SectionStatusBadge drafted={drafted} saving={isSaving} savedAt={lastSavedAt} />}>
      <Form {...form}>
        <VarEditorField orientation='vertical' className='p-0'>
          <FormField
            control={form.control}
            name='searchbarPosition'
            render={({ field, fieldState }) => (
              <VarEditorFieldRow
                title='Search bar'
                description="Pick the style of the search bar. On small screens it's displayed as an icon button."
                type={BaseType.ENUM}
                showIcon
                validationError={fieldState.error?.message}>
                <FieldInputAdapter
                  fieldType={FieldType.SINGLE_SELECT}
                  fieldOptions={{ options: SEARCHBAR_OPTIONS }}
                  value={field.value}
                  onChange={(v) => field.onChange((v as string[])[0] ?? 'center')}
                  placeholder='Pick…'
                  triggerProps={{ className: 'w-full' }}
                />
              </VarEditorFieldRow>
            )}
          />

          <FormField
            control={form.control}
            name='headerNavigation'
            render={({ field, fieldState }) => (
              <VarEditorFieldRow
                title='Navigation'
                description='Configure the navigation menu items for the header. Drag to rearrange.'
                type={BaseType.ARRAY}
                showIcon
                validationError={fieldState.error?.message}>
                <NavigationManager
                  type='header'
                  value={field.value}
                  onChange={field.onChange}
                  disabled={!headerEnabled}
                />
              </VarEditorFieldRow>
            )}
          />
        </VarEditorField>
      </Form>
    </Section>
  )
}
