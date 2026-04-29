// apps/web/src/components/kb/ui/settings/general/modes-section.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { FormField } from '@auxx/ui/components/form'
import { Section } from '@auxx/ui/components/section'
import type { UseFormReturn } from 'react-hook-form'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { BaseType } from '~/components/workflow/types'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import type { GeneralFormValues } from './general-schema'

interface ModesSectionProps {
  form: UseFormReturn<GeneralFormValues>
  isPending: boolean
}

const MODE_OPTIONS = [
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
]

export function ModesSection({ form, isPending }: ModesSectionProps) {
  return (
    <Section title='Modes' description='Light/dark mode behaviour for visitors.'>
      <VarEditorField orientation='responsive' className='p-0'>
        <FormField
          control={form.control}
          name='showMode'
          render={({ field, fieldState }) => (
            <VarEditorFieldRow
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
                disabled={isPending}
              />
            </VarEditorFieldRow>
          )}
        />

        <FormField
          control={form.control}
          name='defaultMode'
          render={({ field, fieldState }) => (
            <VarEditorFieldRow
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
                disabled={isPending}
                triggerProps={{ className: 'w-full' }}
              />
            </VarEditorFieldRow>
          )}
        />
      </VarEditorField>
    </Section>
  )
}
