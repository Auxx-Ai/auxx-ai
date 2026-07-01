// apps/web/src/components/kb/ui/settings/general/colors-section.tsx
'use client'

import { mergeDraftOverLive } from '@auxx/lib/kb/client'
import { Form, FormField } from '@auxx/ui/components/form'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { Section } from '@auxx/ui/components/section'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { useEffect, useState } from 'react'
import { type UseFormReturn, useForm } from 'react-hook-form'
import { z } from 'zod'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { ColorField } from '~/components/ui/color-field'
import { BaseType } from '~/components/workflow/types'
import { useDraftSettingsAutosave } from '../../../hooks/use-draft-settings-autosave'
import { type KnowledgeBase, selectDraftedSections } from '../../../store/knowledge-base-store'
import { SectionStatusBadge } from '../section-header'

const colorRows = [
  { key: 'primary', label: 'Primary', description: 'Main elements such as buttons and links' },
  { key: 'tint', label: 'Tint', description: 'Background and secondary elements' },
  { key: 'info', label: 'Info', description: 'Informational badges and notices' },
  { key: 'success', label: 'Success', description: 'Successful state indicators' },
  { key: 'warning', label: 'Warning', description: 'Warning state indicators' },
  { key: 'danger', label: 'Danger', description: 'Errors and destructive actions' },
] as const

const colorsSchema = z.object({
  primaryColorLight: z.string().nullish(),
  primaryColorDark: z.string().nullish(),
  tintColorLight: z.string().nullish(),
  tintColorDark: z.string().nullish(),
  infoColorLight: z.string().nullish(),
  infoColorDark: z.string().nullish(),
  successColorLight: z.string().nullish(),
  successColorDark: z.string().nullish(),
  warningColorLight: z.string().nullish(),
  warningColorDark: z.string().nullish(),
  dangerColorLight: z.string().nullish(),
  dangerColorDark: z.string().nullish(),
})

type ColorsFormValues = z.infer<typeof colorsSchema>

const COLOR_DEFAULTS: Record<keyof ColorsFormValues, string> = {
  primaryColorLight: '#346DDB',
  primaryColorDark: '#346DDB',
  tintColorLight: '#D7DEEC',
  tintColorDark: '#010309',
  infoColorLight: '#787878',
  infoColorDark: '#787878',
  successColorLight: '#00C950',
  successColorDark: '#00C950',
  warningColorLight: '#FE9A00',
  warningColorDark: '#FE9A00',
  dangerColorLight: '#FB2C36',
  dangerColorDark: '#FB2C36',
}

function buildDefaults(kb: KnowledgeBase): ColorsFormValues {
  const merged = mergeDraftOverLive(kb as any) as KnowledgeBase
  const out: Partial<ColorsFormValues> = {}
  for (const k of Object.keys(COLOR_DEFAULTS) as Array<keyof ColorsFormValues>) {
    out[k] = ((merged as any)[k] as string | null) || COLOR_DEFAULTS[k]
  }
  return out as ColorsFormValues
}

interface ColorPaletteFieldsProps {
  form: UseFormReturn<ColorsFormValues>
  mode: 'light' | 'dark'
}

function ColorPaletteFields({ form, mode }: ColorPaletteFieldsProps) {
  const suffix = mode === 'light' ? 'Light' : 'Dark'

  return (
    <FieldPanel orientation='responsive' className='p-0' resizeId='kb-settings'>
      {colorRows.map((row) => {
        const fieldName = `${row.key}Color${suffix}` as keyof ColorsFormValues
        return (
          <FormField
            key={fieldName}
            control={form.control}
            name={fieldName}
            render={({ field, fieldState }) => (
              <FieldPanelRow
                title={row.label}
                description={row.description}
                type={BaseType.STRING}
                showIcon
                validationError={fieldState.error?.message}>
                <ColorField
                  value={(field.value as string) || ''}
                  onChange={field.onChange}
                  placeholder='Pick a color'
                />
              </FieldPanelRow>
            )}
          />
        )
      })}
    </FieldPanel>
  )
}

interface ColorsSectionProps {
  knowledgeBaseId: string
  knowledgeBase: KnowledgeBase
}

export function ColorsSection({ knowledgeBaseId, knowledgeBase }: ColorsSectionProps) {
  const [mode, setMode] = useState<'light' | 'dark'>('light')

  const form = useForm<ColorsFormValues>({
    resolver: standardSchemaResolver(colorsSchema),
    defaultValues: buildDefaults(knowledgeBase),
  })

  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-hydrate on KB switch — autosave keeps the form in sync otherwise
  useEffect(() => {
    form.reset(buildDefaults(knowledgeBase))
  }, [knowledgeBase.id, form])

  const watch = form.watch()
  const { isSaving, lastSavedAt } = useDraftSettingsAutosave(knowledgeBaseId, watch, {
    registryKey: 'colors',
  })
  const drafted = selectDraftedSections(knowledgeBase).has('colors')

  return (
    <Section
      title='Colors'
      description='Pick brand and semantic colours for each mode.'
      actions={
        <div className='flex items-center gap-2'>
          <SectionStatusBadge drafted={drafted} saving={isSaving} savedAt={lastSavedAt} />
          <RadioTab size='sm' value={mode} onValueChange={(v) => setMode(v as 'light' | 'dark')}>
            <RadioTabItem value='light'>Light</RadioTabItem>
            <RadioTabItem value='dark'>Dark</RadioTabItem>
          </RadioTab>
        </div>
      }>
      <Form {...form}>
        <ColorPaletteFields form={form} mode={mode} />
      </Form>
    </Section>
  )
}
