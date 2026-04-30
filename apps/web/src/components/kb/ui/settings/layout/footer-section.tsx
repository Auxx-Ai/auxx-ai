// apps/web/src/components/kb/ui/settings/layout/footer-section.tsx
'use client'

import { mergeDraftOverLive } from '@auxx/lib/kb/client'
import { Form, FormField } from '@auxx/ui/components/form'
import { Section } from '@auxx/ui/components/section'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
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

const footerSchema = z.object({
  footerEnabled: z.boolean().default(true),
  footerNavigation: z.array(navigationItemSchema).default([]),
})

type FooterFormValues = z.infer<typeof footerSchema>

function buildDefaults(kb: KnowledgeBase): FooterFormValues {
  const merged = mergeDraftOverLive(kb as any) as KnowledgeBase
  return {
    footerEnabled: merged.footerEnabled ?? true,
    footerNavigation:
      ((merged.footerNavigation ?? []) as FooterFormValues['footerNavigation']) ?? [],
  }
}

interface FooterSectionProps {
  knowledgeBaseId: string
  knowledgeBase: KnowledgeBase
}

export function FooterSection({ knowledgeBaseId, knowledgeBase }: FooterSectionProps) {
  const form = useForm<FooterFormValues>({
    resolver: standardSchemaResolver(footerSchema),
    defaultValues: buildDefaults(knowledgeBase),
  })

  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-hydrate on KB switch — autosave keeps the form in sync otherwise
  useEffect(() => {
    form.reset(buildDefaults(knowledgeBase))
  }, [knowledgeBase.id, form])

  const footerEnabled = form.watch('footerEnabled')
  const watch = form.watch()
  const { isSaving, lastSavedAt } = useDraftSettingsAutosave(knowledgeBaseId, watch, {
    registryKey: 'footer',
  })
  const drafted = selectDraftedSections(knowledgeBase).has('footer')

  return (
    <Section
      title='Footer'
      description='Bottom navigation visible across all pages.'
      showEnable
      enabled={footerEnabled}
      onEnableChange={(checked) => form.setValue('footerEnabled', checked, { shouldDirty: true })}
      actions={<SectionStatusBadge drafted={drafted} saving={isSaving} savedAt={lastSavedAt} />}>
      <Form {...form}>
        <VarEditorField orientation='vertical' className='p-0'>
          <FormField
            control={form.control}
            name='footerNavigation'
            render={({ field, fieldState }) => (
              <VarEditorFieldRow
                title='Navigation'
                description='Configure the navigation menu items for the footer. Drag to rearrange.'
                type={BaseType.ARRAY}
                showIcon
                validationError={fieldState.error?.message}>
                <NavigationManager
                  type='footer'
                  value={field.value}
                  onChange={field.onChange}
                  disabled={!footerEnabled}
                />
              </VarEditorFieldRow>
            )}
          />
        </VarEditorField>
      </Form>
    </Section>
  )
}
