// apps/web/src/components/kb/ui/settings/layout/footer-section.tsx
'use client'

import { FormField } from '@auxx/ui/components/form'
import { Section } from '@auxx/ui/components/section'
import type { UseFormReturn } from 'react-hook-form'
import { BaseType } from '~/components/workflow/types'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import type { LayoutFormValues } from './layout-schema'
import { NavigationManager } from './navigation-manager'

interface FooterSectionProps {
  form: UseFormReturn<LayoutFormValues>
  isPending: boolean
}

export function FooterSection({ form, isPending }: FooterSectionProps) {
  const footerEnabled = form.watch('footerEnabled')

  return (
    <Section
      title='Footer'
      description='Bottom navigation visible across all pages.'
      showEnable
      enabled={footerEnabled}
      onEnableChange={(checked) => form.setValue('footerEnabled', checked)}
      isReadOnly={isPending}>
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
                disabled={!footerEnabled || isPending}
              />
            </VarEditorFieldRow>
          )}
        />
      </VarEditorField>
    </Section>
  )
}
