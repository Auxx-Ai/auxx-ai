// apps/web/src/components/kb/ui/settings/layout/header-section.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { FormField } from '@auxx/ui/components/form'
import { Section } from '@auxx/ui/components/section'
import type { UseFormReturn } from 'react-hook-form'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { BaseType } from '~/components/workflow/types'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import type { LayoutFormValues } from './layout-schema'
import { NavigationManager } from './navigation-manager'

const SEARCHBAR_OPTIONS = [
  { label: 'Center', value: 'center' },
  { label: 'Corner', value: 'corner' },
]

interface HeaderSectionProps {
  form: UseFormReturn<LayoutFormValues>
  isPending: boolean
}

export function HeaderSection({ form, isPending }: HeaderSectionProps) {
  const headerEnabled = form.watch('headerEnabled')

  return (
    <Section
      title='Header'
      description='Top navigation and search bar visible across all pages.'
      showEnable
      enabled={headerEnabled}
      onEnableChange={(checked) => form.setValue('headerEnabled', checked)}
      isReadOnly={isPending}>
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
                disabled={isPending}
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
                disabled={!headerEnabled || isPending}
              />
            </VarEditorFieldRow>
          )}
        />
      </VarEditorField>
    </Section>
  )
}
