// apps/web/src/components/kb/ui/settings/general/styling-section.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { FormField } from '@auxx/ui/components/form'
import { RadioGroup, RadioGroupItemCard } from '@auxx/ui/components/radio-group'
import { Section } from '@auxx/ui/components/section'
import { List, Minus, Pill } from 'lucide-react'
import type { UseFormReturn } from 'react-hook-form'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { BaseType } from '~/components/workflow/types'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import type { GeneralFormValues } from './general-schema'

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
  { value: 'default' as const, label: 'Default', icon: <List />, description: 'Plain list rows' },
  { value: 'pill' as const, label: 'Pill', icon: <Pill />, description: 'Selected item rounded' },
  { value: 'line' as const, label: 'Line', icon: <Minus />, description: 'Underline indicator' },
]

interface StylingSectionProps {
  form: UseFormReturn<GeneralFormValues>
  isPending: boolean
}

export function StylingSection({ form, isPending }: StylingSectionProps) {
  return (
    <>
      <Section title='Site styles' description='Typography, icons and shapes.'>
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
                  disabled={isPending}
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
                  disabled={isPending}
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
            <RadioGroup
              value={field.value}
              onValueChange={field.onChange}
              disabled={isPending}
              className='grid gap-2 sm:grid-cols-3'>
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
    </>
  )
}
