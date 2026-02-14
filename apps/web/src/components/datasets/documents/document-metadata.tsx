// apps/web/src/components/datasets/documents/document-metadata.tsx
'use client'
import type { DocumentEntity as Document } from '@auxx/database/models'
import { Separator } from '@auxx/ui/components/separator'
import { format } from 'date-fns'
import { DocumentStatus } from './document-utils'

interface DocumentMetadataTabProps {
  document: Document
}
export function DocumentMetadataTab({ document }: DocumentMetadataTabProps) {
  return (
    <div className='p-4'>
      <div className='space-y-4'>
        <div>
          <h4 className='text-sm font-medium mb-2'>Basic Information</h4>
          <div className='space-y-2 text-sm'>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Document ID:</span>
              <code className='font-mono'>{document.id}</code>
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Filename:</span>
              <span className='truncate max-w-[200px]'>{document.filename}</span>
            </div>
            {document.title && (
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>Title:</span>
                <span className='truncate max-w-[200px]'>{document.title}</span>
              </div>
            )}
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>MIME Type:</span>
              <code className='font-mono text-xs'>{document.mimeType || 'Unknown'}</code>
            </div>
          </div>
        </div>

        <Separator />

        <div>
          <h4 className='text-sm font-medium mb-2'>Processing Information</h4>
          <div className='space-y-2 text-sm'>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Status:</span>
              <DocumentStatus status={document.status} size='sm' />
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Total Segments:</span>
              <span>{document.totalChunks ?? 0}</span>
            </div>
          </div>
        </div>

        <Separator />

        <div>
          <h4 className='text-sm font-medium mb-2'>Timestamps</h4>
          <div className='space-y-2 text-sm'>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Created:</span>
              <span>{format(new Date(document.createdAt), 'MMM d, yyyy HH:mm:ss')}</span>
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Updated:</span>
              <span>{format(new Date(document.updatedAt), 'MMM d, yyyy HH:mm:ss')}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
