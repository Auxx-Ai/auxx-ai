// apps/web/src/components/kb/ui/settings/general/logos-section.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { FormField } from '@auxx/ui/components/form'
import { Section } from '@auxx/ui/components/section'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { Moon, Sun } from 'lucide-react'
import type { UseFormReturn } from 'react-hook-form'
import { useFileSelect } from '~/components/file-select'
import { FileSelectPicker } from '~/components/pickers/file-select-picker'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import type { GeneralFormValues } from './general-schema'

interface LogosSectionProps {
  form: UseFormReturn<GeneralFormValues>
  isPending: boolean
  knowledgeBaseId: string
}

interface LogoUploadCellProps {
  variant: 'light' | 'dark'
  value: string
  onChange: (url: string) => void
  knowledgeBaseId: string
  isPending: boolean
}

function LogoUploadCell({
  variant,
  value,
  onChange,
  knowledgeBaseId,
  isPending,
}: LogoUploadCellProps) {
  const fileSelect = useFileSelect({
    entityType: 'KNOWLEDGE_BASE',
    entityId: knowledgeBaseId,
    allowMultiple: false,
    maxFiles: 1,
    autoStart: true,
    fileExtensions: ['.png', '.jpg', '.jpeg', '.webp', '.svg'],
    sessionMetadata: { role: 'KB_LOGO', variant, title: `kb-logo-${variant}` },
    onUploadComplete: (files) => {
      const url = files?.[0]?.url || ''
      if (url) {
        onChange(url)
        toastSuccess({ title: `${variant === 'light' ? 'Light' : 'Dark'} logo uploaded` })
      }
    },
    onError: (error) => toastError({ title: 'Failed to upload logo', description: error }),
  })

  const previewBg = variant === 'light' ? 'bg-white' : 'bg-gray-800'
  const emptyText = variant === 'light' ? 'text-muted-foreground' : 'text-gray-300'

  return (
    <div className='flex flex-col items-center gap-2 py-2'>
      <div
        className={`relative flex h-32 w-full items-center justify-center rounded-md border ${previewBg}`}>
        {value ? (
          <img src={value} alt={`${variant} logo`} className='max-h-24 max-w-full object-contain' />
        ) : (
          <p className={`text-sm ${emptyText}`}>No logo uploaded</p>
        )}
      </div>
      <div className='flex items-center gap-2'>
        <FileSelectPicker fileSelect={fileSelect}>
          <Button type='button' variant='outline' size='sm' disabled={isPending}>
            {value ? 'Change logo' : 'Upload logo'}
          </Button>
        </FileSelectPicker>
        {value && (
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='text-destructive'
            onClick={() => onChange('')}
            disabled={isPending}>
            Remove
          </Button>
        )}
      </div>
    </div>
  )
}

export function LogosSection({ form, isPending, knowledgeBaseId }: LogosSectionProps) {
  return (
    <Section
      title='Logos'
      description="Replace the content's title with a custom logo. Recommended width: 600px or wider.">
      <VarEditorField orientation='vertical' className='p-0'>
        <FormField
          control={form.control}
          name='logoLight'
          render={({ field, fieldState }) => (
            <VarEditorFieldRow
              title='Light mode logo'
              showIcon
              icon={<Sun className='size-3.5' />}
              validationError={fieldState.error?.message}>
              <LogoUploadCell
                variant='light'
                value={field.value ?? ''}
                onChange={(v) => field.onChange(v)}
                knowledgeBaseId={knowledgeBaseId}
                isPending={isPending}
              />
            </VarEditorFieldRow>
          )}
        />

        <FormField
          control={form.control}
          name='logoDark'
          render={({ field, fieldState }) => (
            <VarEditorFieldRow
              title='Dark mode logo'
              showIcon
              icon={<Moon className='size-3.5' />}
              validationError={fieldState.error?.message}>
              <LogoUploadCell
                variant='dark'
                value={field.value ?? ''}
                onChange={(v) => field.onChange(v)}
                knowledgeBaseId={knowledgeBaseId}
                isPending={isPending}
              />
            </VarEditorFieldRow>
          )}
        />
      </VarEditorField>
    </Section>
  )
}
