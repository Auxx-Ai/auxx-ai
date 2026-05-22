// apps/web/src/components/chat-widget/ui/settings/sections/logo-upload-cell.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { useFileSelect } from '~/components/file-select'
import { FileSelectPicker } from '~/components/pickers/file-select-picker'

interface LogoUploadCellProps {
  variant: 'light' | 'dark'
  value: string
  onChange: (url: string) => void
  chatWidgetId: string
}

export function LogoUploadCell({ variant, value, onChange, chatWidgetId }: LogoUploadCellProps) {
  const fileSelect = useFileSelect({
    entityType: 'CHAT_WIDGET',
    entityId: chatWidgetId,
    allowMultiple: false,
    maxFiles: 1,
    autoStart: true,
    fileExtensions: ['.png', '.jpg', '.jpeg', '.webp'],
    sessionMetadata: {
      role: 'CHAT_WIDGET_LOGO',
      variant,
      title: `chat-widget-logo-${variant}`,
    },
    onUploadComplete: (files) => {
      const url = files?.[0]?.url || ''
      if (url) {
        onChange(url)
        toastSuccess({ title: `${variant === 'light' ? 'Light' : 'Dark'} logo uploaded` })
      }
    },
    onError: (error) => toastError({ title: 'Failed to upload logo', description: error }),
  })

  const previewBg = variant === 'light' ? 'bg-white' : 'bg-[var(--color-primary)]'
  const emptyText = variant === 'light' ? 'text-muted-foreground' : 'text-white/80'

  return (
    <div className='flex flex-col items-center gap-2 py-2 pe-2'>
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
          <Button type='button' variant='outline' size='sm'>
            {value ? 'Change logo' : 'Upload logo'}
          </Button>
        </FileSelectPicker>
        {value && (
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='text-destructive'
            onClick={() => onChange('')}>
            Remove
          </Button>
        )}
      </div>
    </div>
  )
}
