// apps/web/src/components/pickers/file-picker.tsx
'use client'

import { type FileRef, getFileRefDownloadUrl } from '@auxx/types/file-ref'
import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPlaceholder,
  CommandSeparator,
} from '@auxx/ui/components/command'
import { formatBytes } from '@auxx/utils/file'
import { Download, File, FolderOpen, Trash2, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { UploadingFile } from '~/components/fields/inputs/hooks/use-field-file-upload'

interface FilePickerProps {
  files: Array<{
    id: string // fieldValueId — passed to onRemove
    ref: FileRef
    name: string
    mimeType: string | null
    size: number | null
  }>
  uploadingFiles: UploadingFile[]
  canAddMore: boolean
  onUpload: () => void
  onBrowse: () => void
  onRemove: (fieldValueId: string) => void
  onDownload?: (ref: FileRef) => void
  placeholder?: string
}

export function FilePicker({
  files,
  uploadingFiles,
  canAddMore,
  onUpload,
  onBrowse,
  onRemove,
  placeholder = 'Search files...',
}: FilePickerProps) {
  const [search, setSearch] = useState('')

  const filteredFiles = useMemo(() => {
    if (!search || !files) return files
    const q = search.toLowerCase()
    return files.filter((f) => f.name.toLowerCase().includes(q))
  }, [files, search])

  const hasAnyFiles = (files?.length ?? 0) > 0 || uploadingFiles.length > 0
  const hasVisibleFiles = (filteredFiles?.length ?? 0) > 0 || uploadingFiles.length > 0

  return (
    <Command shouldFilter={false}>
      {hasAnyFiles && (
        <CommandInput placeholder={placeholder} value={search} onValueChange={setSearch} />
      )}
      <CommandList>
        {hasVisibleFiles && (
          <CommandGroup>
            {filteredFiles?.map((file) => (
              <FileItemRow
                key={file.id}
                value={file.id}
                name={file.name}
                mimeType={file.mimeType}
                size={file.size}
                downloadUrl={getFileRefDownloadUrl(file.ref)}
                onRemove={() => onRemove(file.id)}
              />
            ))}

            {uploadingFiles.map((file) => (
              <FileItemRow
                key={file.id}
                value={file.id}
                name={file.name}
                mimeType={file.mimeType}
                progress={file.progress}
                status={file.status}
              />
            ))}
          </CommandGroup>
        )}

        {hasAnyFiles && !hasVisibleFiles && (
          <CommandPlaceholder>No matching files</CommandPlaceholder>
        )}
        {!hasAnyFiles && <CommandPlaceholder>No files attached</CommandPlaceholder>}

        <CommandSeparator />
        <CommandGroup>
          {canAddMore ? (
            <>
              <CommandItem onSelect={onUpload}>
                <Upload className='size-4' />
                Upload file
              </CommandItem>
              <CommandItem onSelect={onBrowse}>
                <FolderOpen className='size-4' />
                Browse files
              </CommandItem>
            </>
          ) : (
            <CommandPlaceholder>Maximum files reached</CommandPlaceholder>
          )}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

interface FileItemRowProps {
  name: string
  mimeType?: string | null
  size?: number | null
  progress?: number
  status?: string
  downloadUrl?: string
  onRemove?: () => void
  value: string
  key?: string
}

function FileItemRow({
  name,
  mimeType,
  size,
  progress,
  status,
  downloadUrl,
  onRemove,
  ...commandItemProps
}: FileItemRowProps) {
  const isUploading = status === 'uploading' || status === 'processing'

  return (
    <CommandItem
      {...commandItemProps}
      disabled={isUploading}
      className='group/file relative overflow-hidden'>
      <div className='flex min-w-0 flex-1 items-center gap-2'>
        <File className='size-4 shrink-0 text-muted-foreground' />
        <span className='truncate text-sm'>{name}</span>
        {isUploading && progress != null && (
          <span className='ml-auto tabular-nums text-xs text-muted-foreground'>
            {Math.round(progress)}%
          </span>
        )}
      </div>
      {!isUploading && (downloadUrl || onRemove) && (
        <div
          style={{ '--btn-width': '50px' } as React.CSSProperties}
          className='absolute inset-y-0 right-0 flex items-center translate-x-[calc(var(--btn-width)+8px)] group-hover/file:translate-x-0 transition-transform duration-200 ease-out'>
          <div className='w-4 h-full bg-gradient-to-r from-transparent to-accent/50 dark:to-[#404754]/50 transition-opacity duration-200' />
          <div className='flex items-center gap-0.5 bg-accent/50 dark:bg-[#404754]/50 pr-0.5'>
            {downloadUrl && (
              <Button variant='ghost' size='icon-xs' asChild>
                <a href={downloadUrl} download onClick={(e) => e.stopPropagation()}>
                  <Download />
                </a>
              </Button>
            )}
            {onRemove && (
              <Button
                variant='destructive-hover'
                size='icon-xs'
                onClick={(e) => {
                  e.stopPropagation()
                  onRemove()
                }}>
                <Trash2 />
              </Button>
            )}
          </div>
        </div>
      )}
    </CommandItem>
  )
}
