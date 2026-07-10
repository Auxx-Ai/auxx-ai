// apps/web/src/components/money/ui/settings/documents-logo-cell.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { useFileSelect } from '~/components/file-select'
import { FileSelectPicker } from '~/components/pickers/file-select-picker'

/** `{ assetId, url }` — MediaAsset ref stored in the `documents.logo` setting (§B.4 payload contract). */
export interface DocumentsLogo {
  assetId: string
  url: string
}

interface DocumentsLogoCellProps {
  value: DocumentsLogo | null
  onChange: (next: DocumentsLogo | null) => void
}

/**
 * Logo upload cell for the Documents settings page — clone of the chat-widget
 * logo cell (`chat-widget/ui/settings/sections/logo-upload-cell.tsx`), scoped
 * to an org-level asset (no `entityType`/`entityId`, `FILE` default) instead
 * of a chat-widget id. SVG rejected — react-pdf's `<Image>` can't render it.
 */
export function DocumentsLogoCell({ value, onChange }: DocumentsLogoCellProps) {
  const fileSelect = useFileSelect({
    allowMultiple: false,
    maxFiles: 1,
    autoStart: true,
    fileExtensions: ['.png', '.jpg', '.jpeg', '.webp'],
    sessionMetadata: { role: 'DOCUMENT_LOGO' },
    onUploadComplete: (files) => {
      const file = files?.[0]
      const assetId = file?.serverFileId || file?.id
      if (file?.url && assetId) {
        onChange({ assetId, url: file.url })
      }
    },
    onError: (error) => toastError({ title: 'Failed to upload logo', description: error }),
  })

  return (
    <div className='flex flex-col items-center gap-2 py-2 pe-2'>
      <div className='relative flex h-32 w-full items-center justify-center rounded-md border bg-white'>
        {value?.url ? (
          <img src={value.url} alt='Document logo' className='max-h-24 max-w-full object-contain' />
        ) : (
          <p className='text-sm text-muted-foreground'>No logo uploaded</p>
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
            onClick={() => onChange(null)}>
            Remove
          </Button>
        )}
      </div>
    </div>
  )
}
