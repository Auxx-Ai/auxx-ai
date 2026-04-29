// apps/web/src/components/kb/ui/settings/general/identity-section.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { FormField } from '@auxx/ui/components/form'
import { Section } from '@auxx/ui/components/section'
import type { UseFormReturn } from 'react-hook-form'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { BaseType } from '~/components/workflow/types'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import type { GeneralFormValues } from './general-schema'

interface IdentitySectionProps {
  form: UseFormReturn<GeneralFormValues>
  isPending: boolean
}

const VISIBILITY_OPTIONS = [
  { label: 'Public', value: 'PUBLIC' },
  { label: 'Internal — sign-in required', value: 'INTERNAL' },
]

export function IdentitySection({ form, isPending }: IdentitySectionProps) {
  return (
    <Section title='Basic' description='Public identity of your knowledge base'>
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
                disabled={isPending}
              />
            </VarEditorFieldRow>
          )}
        />

        <FormField
          control={form.control}
          name='slug'
          render={({ field, fieldState }) => (
            <VarEditorFieldRow
              title='URL slug'
              description='Used in the URL of your knowledge base.'
              type={BaseType.STRING}
              showIcon
              isRequired
              validationError={fieldState.error?.message}>
              <FieldInputAdapter
                fieldType={FieldType.TEXT}
                value={field.value}
                onChange={(v) => field.onChange(v ?? '')}
                placeholder='my-knowledge-base'
                disabled={isPending}
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
                disabled={isPending}
              />
            </VarEditorFieldRow>
          )}
        />

        <FormField
          control={form.control}
          name='customDomain'
          render={({ field, fieldState }) => (
            <VarEditorFieldRow
              title='Custom domain'
              description='Set a custom domain for your knowledge base.'
              type={BaseType.STRING}
              showIcon
              validationError={fieldState.error?.message}>
              <FieldInputAdapter
                fieldType={FieldType.TEXT}
                value={field.value ?? ''}
                onChange={(v) => field.onChange(v ?? '')}
                placeholder='docs.example.com'
                disabled={isPending}
              />
            </VarEditorFieldRow>
          )}
        />

        <FormField
          control={form.control}
          name='visibility'
          render={({ field, fieldState }) => (
            <VarEditorFieldRow
              title='Visibility'
              description='Public knowledge bases are accessible to anyone with the link. Internal knowledge bases require visitors to sign in and be a member of your organization.'
              type={BaseType.ENUM}
              showIcon
              validationError={fieldState.error?.message}>
              <FieldInputAdapter
                fieldType={FieldType.SINGLE_SELECT}
                fieldOptions={{ options: VISIBILITY_OPTIONS }}
                value={field.value ?? 'PUBLIC'}
                onChange={(v) => field.onChange((v as string[])[0] ?? 'PUBLIC')}
                placeholder='Public'
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
