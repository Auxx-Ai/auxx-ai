// apps/web/src/components/kb/ui/settings/layout/header-section.tsx
'use client'

import { mergeDraftOverLive } from '@auxx/lib/kb/client'
import { Form, FormField } from '@auxx/ui/components/form'
import { Section } from '@auxx/ui/components/section'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
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
  headerNavigation: z.array(navigationItemSchema).default([]),
})

type HeaderFormValues = z.infer<typeof headerSchema>

function buildDefaults(kb: KnowledgeBase): HeaderFormValues {
  const merged = mergeDraftOverLive(kb as any) as KnowledgeBase
  return {
    headerEnabled: merged.headerEnabled ?? true,
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
        <FieldPanel orientation='vertical' className='p-0' resizeId='kb-settings'>
          <FormField
            control={form.control}
            name='headerNavigation'
            render={({ field, fieldState }) => (
              <FieldPanelRow
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
              </FieldPanelRow>
            )}
          />
        </FieldPanel>
      </Form>
    </Section>
  )
}
