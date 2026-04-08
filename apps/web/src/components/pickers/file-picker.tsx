// apps/web/src/components/pickers/file-picker.tsx
'use client'

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
import { File, FolderOpen, Upload, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { UploadingFile } from '~/components/fields/inputs/hooks/use-field-file-upload'

interface FilePickerProps {
  files: Array<{
    id: string // fieldValueId — passed to onRemove
    name: string
    mimeType: string | null
    size: number | null
  }>
  uploadingFiles: UploadingFile[]
  canAddMore: boolean
  onUpload: () => void
  onBrowse: () => void
  onRemove: (fieldValueId: string) => void
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

  const hasFiles = (filteredFiles?.length ?? 0) > 0 || uploadingFiles.length > 0

  return (
    <Command shouldFilter={false}>
      {hasFiles && (
        <CommandInput placeholder={placeholder} value={search} onValueChange={setSearch} />
      )}
      <CommandList>
        {hasFiles && (
          <CommandGroup>
            {filteredFiles?.map((file) => (
              <CommandItem key={file.id} value={file.id} className='group'>
                <FileItemRow name={file.name} mimeType={file.mimeType} size={file.size} />
                <button
                  type='button'
                  className='ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-sm opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100'
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemove(file.id)
                  }}>
                  <X className='size-3.5' />
                </button>
              </CommandItem>
            ))}

            {uploadingFiles.map((file) => (
              <CommandItem key={file.id} value={file.id} disabled>
                <FileItemRow
                  name={file.name}
                  mimeType={file.mimeType}
                  progress={file.progress}
                  status={file.status}
                />
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {!hasFiles && <CommandPlaceholder>No files attached</CommandPlaceholder>}

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

function FileItemRow({
  name,
  mimeType,
  size,
  progress,
  status,
}: {
  name: string
  mimeType?: string | null
  size?: number | null
  progress?: number
  status?: string
}) {
  const isUploading = status === 'uploading' || status === 'processing'

  return (
    <div className='flex min-w-0 flex-1 items-center gap-2'>
      <File className='size-4 shrink-0 text-muted-foreground' />
      <span className='truncate text-sm'>{name}</span>
      {isUploading && progress != null && (
        <span className='ml-auto tabular-nums text-xs text-muted-foreground'>
          {Math.round(progress)}%
        </span>
      )}
      {/* {!isUploading && size != null && (
        <span className='ml-auto text-xs text-muted-foreground'>{formatBytes(Number(size))}</span>
      )} */}
    </div>
  )
}
