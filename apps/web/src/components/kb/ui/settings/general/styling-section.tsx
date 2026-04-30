// apps/web/src/components/kb/ui/settings/general/styling-section.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { mergeDraftOverLive } from '@auxx/lib/kb/client'
import { Form, FormField } from '@auxx/ui/components/form'
import { RadioGroup, RadioGroupItemCard } from '@auxx/ui/components/radio-group'
import { Section } from '@auxx/ui/components/section'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { List, Minus, Pill } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { BaseType } from '~/components/workflow/types'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { useDraftSettingsAutosave } from '../../../hooks/use-draft-settings-autosave'
import { type KnowledgeBase, selectDraftedSections } from '../../../store/knowledge-base-store'
import { SectionStatusBadge } from '../section-header'

const FONT_OPTIONS = [
  { label: 'System Default', value: 'default' },
  { label: 'Inter', value: 'inter' },
  { label: 'Roboto', value: 'roboto' },
  { label: 'Open Sans', value: 'opensans' },
  { label: 'Montserrat', value: 'montserrat' },
]

const CORNER_OPTIONS = [
  { label: 'Rounded', value: 'rounded' },
  { label: 'Straight', value: 'straight' },
]

const sidebarStyles = [
  {
    value: 'default' as const,
    label: 'Default',
    icon: <List />,
    description: 'Rounded items with collapse rail',
  },
  {
    value: 'pill' as const,
    label: 'Pill',
    icon: <Pill />,
    description: 'Pill-shaped active indicator, no rail',
  },
  {
    value: 'line' as const,
    label: 'Line',
    icon: <Minus />,
    description: 'Continuous left line',
  },
]

const stylingSchema = z.object({
  fontFamily: z.string().nullish(),
  cornerStyle: z.enum(['rounded', 'straight']).default('rounded'),
  sidebarListStyle: z.enum(['default', 'pill', 'line']).default('default'),
})

type StylingFormValues = z.infer<typeof stylingSchema>

const lower = (v: string | null | undefined) => (v ? v.toLowerCase() : v)

function buildDefaults(kb: KnowledgeBase): StylingFormValues {
  const merged = mergeDraftOverLive(kb as any) as KnowledgeBase
  return {
    fontFamily: merged.fontFamily || 'default',
    cornerStyle: (lower(merged.cornerStyle) as StylingFormValues['cornerStyle']) || 'rounded',
    sidebarListStyle:
      (lower(merged.sidebarListStyle) as StylingFormValues['sidebarListStyle']) || 'default',
  }
}

interface StylingSectionProps {
  knowledgeBaseId: string
  knowledgeBase: KnowledgeBase
}

export function StylingSection({ knowledgeBaseId, knowledgeBase }: StylingSectionProps) {
  const form = useForm<StylingFormValues>({
    resolver: standardSchemaResolver(stylingSchema),
    defaultValues: buildDefaults(knowledgeBase),
  })

  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-hydrate on KB switch — autosave keeps the form in sync otherwise
  useEffect(() => {
    form.reset(buildDefaults(knowledgeBase))
  }, [knowledgeBase.id, form])

  const watch = form.watch()
  const { isSaving, lastSavedAt } = useDraftSettingsAutosave(knowledgeBaseId, watch, {
    registryKey: 'styling',
  })
  const drafted = selectDraftedSections(knowledgeBase).has('styling')

  return (
    <Form {...form}>
      <Section
        title='Site styles'
        description='Typography, icons and shapes.'
        actions={<SectionStatusBadge drafted={drafted} saving={isSaving} savedAt={lastSavedAt} />}>
        <VarEditorField orientation='responsive' className='p-0'>
          <FormField
            control={form.control}
            name='fontFamily'
            render={({ field, fieldState }) => (
              <VarEditorFieldRow
                title='Font family'
                type={BaseType.ENUM}
                showIcon
                validationError={fieldState.error?.message}>
                <FieldInputAdapter
                  fieldType={FieldType.SINGLE_SELECT}
                  fieldOptions={{ options: FONT_OPTIONS }}
                  value={field.value ?? 'default'}
                  onChange={(v) => field.onChange((v as string[])[0] ?? 'default')}
                  placeholder='System default'
                  triggerProps={{ className: 'w-full' }}
                />
              </VarEditorFieldRow>
            )}
          />
          <FormField
            control={form.control}
            name='cornerStyle'
            render={({ field, fieldState }) => (
              <VarEditorFieldRow
                title='Corner style'
                type={BaseType.ENUM}
                showIcon
                validationError={fieldState.error?.message}>
                <FieldInputAdapter
                  fieldType={FieldType.SINGLE_SELECT}
                  fieldOptions={{ options: CORNER_OPTIONS }}
                  value={field.value}
                  onChange={(v) => field.onChange((v as string[])[0] ?? 'rounded')}
                  placeholder='Pick…'
                  triggerProps={{ className: 'w-full' }}
                />
              </VarEditorFieldRow>
            )}
          />
        </VarEditorField>
      </Section>

      <Section title='Sidebar style' description='How active items render in the sidebar.'>
        <FormField
          control={form.control}
          name='sidebarListStyle'
          render={({ field }) => (
            <RadioGroup value={field.value} onValueChange={field.onChange} className='grid gap-2'>
              {sidebarStyles.map((s) => (
                <RadioGroupItemCard
                  key={s.value}
                  value={s.value}
                  label={s.label}
                  icon={s.icon}
                  description={s.description}
                />
              ))}
            </RadioGroup>
          )}
        />
      </Section>
    </Form>
  )
}
