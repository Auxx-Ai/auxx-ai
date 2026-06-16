// apps/web/src/components/pickers/file-select-picker.tsx

'use client'

import type { EntityType } from '@auxx/lib/files/types'
import { type FileRef, getFileRefDownloadUrl, toFileRef } from '@auxx/types/file-ref'
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
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { Download, File, FolderOpen, RotateCw, Trash2, Upload } from 'lucide-react'
import type React from 'react'
import { useMemo, useState } from 'react'
import { FileSelectDialog } from '~/components/file-select/file-select-dialog'
import { useFileSelect } from '~/components/file-select/hooks/use-file-select'
import type { UseFileSelectReturn } from '~/components/file-select/types'
import type { FileItem as FileItemType } from '~/components/files/files-store'

/**
 * Props for FileSelectPicker component
 */
export interface FileSelectPickerProps {
  // File selection hook instance (optional - will create internally if not provided)
  fileSelect?: UseFileSelectReturn

  // File constraints
  fileTypes?: string[]
  allowMultiple?: boolean
  maxFiles?: number
  maxFileSize?: number

  // Entity configuration (for internal hook creation)
  entityType?: EntityType
  entityId?: string

  // Callbacks (only used when no external fileSelect provided)
  onSelect?: (files: FileItemType[]) => void
  onUploadComplete?: (files: FileItemType[]) => void
  onExistingFilesAdded?: (files: FileItemType[]) => void
  onError?: (error: string) => void

  // Popover control
  open?: boolean
  onOpenChange?: (open: boolean) => void

  // PopoverContent options
  className?: string
  disabled?: boolean
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number

  // Hide "Browse files" — restrict picker to fresh uploads only
  hideBrowseExisting?: boolean

  // Display
  children: React.ReactNode
}

/**
 * Props for the internal content component (requires fileSelect)
 */
interface FileSelectPickerContentProps extends Omit<FileSelectPickerProps, 'fileSelect'> {
  fileSelect: UseFileSelectReturn
}

/**
 * FileSelectPicker - Popover-based file selection component
 *
 * Routes to either:
 * - FileSelectPickerContent (when external fileSelect provided)
 * - FileSelectPickerWithInternalHook (when no external fileSelect, creates its own)
 */
export function FileSelectPicker({
  fileSelect: externalFileSelect,
  ...props
}: FileSelectPickerProps) {
  // If external fileSelect provided, use it directly
  if (externalFileSelect) {
    return <FileSelectPickerContent fileSelect={externalFileSelect} {...props} />
  }

  // Otherwise, create internal hook in a separate component
  return <FileSelectPickerWithInternalHook {...props} />
}

/**
 * Wrapper that creates its own useFileSelect hook
 * Only rendered when no external fileSelect is provided
 */
function FileSelectPickerWithInternalHook({
  allowMultiple = true,
  maxFiles,
  maxFileSize,
  fileTypes,
  entityType = 'FILE',
  entityId,
  onUploadComplete,
  onExistingFilesAdded,
  onError,
  ...props
}: Omit<FileSelectPickerProps, 'fileSelect'>) {
  const fileSelect = useFileSelect({
    allowMultiple,
    maxFiles,
    maxFileSize,
    fileExtensions: fileTypes,
    entityType,
    entityId,
    onChange: () => {},
    onUploadComplete,
    onExistingFilesAdded,
    onError,
  })

  return (
    <FileSelectPickerContent
      fileSelect={fileSelect}
      allowMultiple={allowMultiple}
      maxFiles={maxFiles}
      fileTypes={fileTypes}
      {...props}
    />
  )
}

/** Build a download URL for a ready file (filesystem item or completed upload). */
function downloadUrlFor(item: FileItemType): string | undefined {
  if (item.source === 'filesystem') return getFileRefDownloadUrl(toFileRef('file', item.id))
  if (item.status === 'completed') {
    return getFileRefDownloadUrl(toFileRef('asset', item.serverFileId ?? item.id))
  }
  return undefined
}

/**
 * The actual picker UI content.
 *
 * Mirrors the dynamic-view `FilePicker` look — a searchable Command list with
 * hover-reveal row actions and Upload / Browse rows — but driven by the
 * composer's `useFileSelect` data model. "Browse files" opens the shared
 * `FileSelectDialog`.
 */
function FileSelectPickerContent({
  fileSelect,
  allowMultiple = true,
  maxFiles,
  fileTypes,
  open,
  onOpenChange,
  className,
  disabled,
  align = 'start',
  side,
  sideOffset,
  hideBrowseExisting,
  children,
}: FileSelectPickerContentProps) {
  const [search, setSearch] = useState('')
  const [browseOpen, setBrowseOpen] = useState(false)

  const { selectedItems } = fileSelect

  // Ready files are downloadable (filesystem items or completed uploads); the
  // rest are still in flight (pending / uploading / failed).
  const readyFiles = useMemo(
    () => selectedItems.filter((it) => it.source === 'filesystem' || it.status === 'completed'),
    [selectedItems]
  )
  const inProgressFiles = useMemo(
    () => selectedItems.filter((it) => it.source !== 'filesystem' && it.status !== 'completed'),
    [selectedItems]
  )

  const filteredReady = useMemo(() => {
    if (!search) return readyFiles
    const q = search.toLowerCase()
    return readyFiles.filter((f) => f.name.toLowerCase().includes(q))
  }, [readyFiles, search])

  const hasAnyFiles = selectedItems.length > 0
  const hasVisibleFiles = filteredReady.length > 0 || inProgressFiles.length > 0
  const canAddMore = maxFiles ? selectedItems.length < maxFiles : true
  const remainingSlots = maxFiles ? Math.max(0, maxFiles - selectedItems.length) : undefined

  const openNativeFilePicker = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = allowMultiple
    input.accept = fileTypes ? fileTypes.join(',') : '*/*'
    input.onchange = (e) => {
      const files = Array.from((e.target as HTMLInputElement).files || [])
      if (files.length > 0) fileSelect.addFiles(files)
    }
    input.click()
  }

  return (
    <>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>{children}</PopoverTrigger>

        <PopoverContent
          className={cn('w-96 p-0', className)}
          align={align}
          side={side}
          sideOffset={sideOffset}
          disabled={disabled}>
          <Command shouldFilter={false}>
            {hasAnyFiles && (
              <CommandInput
                placeholder='Search files...'
                value={search}
                onValueChange={setSearch}
              />
            )}
            <CommandList>
              {hasVisibleFiles && (
                <CommandGroup>
                  {filteredReady.map((file) => (
                    <FileSelectRow
                      key={file.id}
                      value={file.id}
                      name={file.name}
                      downloadUrl={downloadUrlFor(file)}
                      onRemove={() => fileSelect.removeItem(file.id)}
                    />
                  ))}

                  {inProgressFiles.map((file) => (
                    <FileSelectRow
                      key={file.id}
                      value={file.id}
                      name={file.name}
                      progress={file.progress}
                      status={file.status}
                      onRetry={
                        file.status === 'failed' ? () => fileSelect.retryUpload(file.id) : undefined
                      }
                      onRemove={() => fileSelect.removeItem(file.id)}
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
                    <CommandItem onSelect={openNativeFilePicker}>
                      <Upload className='size-4' />
                      Upload file
                    </CommandItem>
                    {!hideBrowseExisting && (
                      <CommandItem onSelect={() => setBrowseOpen(true)}>
                        <FolderOpen className='size-4' />
                        Browse files
                      </CommandItem>
                    )}
                  </>
                ) : (
                  <CommandPlaceholder>Maximum files reached</CommandPlaceholder>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {browseOpen && (
        <FileSelectDialog
          open={browseOpen}
          onOpenChange={setBrowseOpen}
          onFilesSelected={(files) => {
            fileSelect.addExistingFiles(files)
            setBrowseOpen(false)
          }}
          allowMultiple={allowMultiple}
          maxSelection={remainingSlots}
          title='Select files'
          confirmText='Attach'
        />
      )}
    </>
  )
}

interface FileSelectRowProps {
  name: string
  progress?: number
  status?: string
  downloadUrl?: string
  onRemove?: () => void
  onRetry?: () => void
  value: string
}

/**
 * A single file row with a hover-reveal action rail (download / retry / remove).
 * In-progress rows are disabled and show their upload percentage instead.
 */
function FileSelectRow({
  name,
  progress,
  status,
  downloadUrl,
  onRemove,
  onRetry,
  ...commandItemProps
}: FileSelectRowProps) {
  const isUploading = status === 'uploading' || status === 'processing' || status === 'pending'

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
        {status === 'failed' && <span className='ml-auto text-xs text-destructive'>Failed</span>}
      </div>
      {!isUploading && (downloadUrl || onRetry || onRemove) && (
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
            {onRetry && (
              <Button
                variant='ghost'
                size='icon-xs'
                onClick={(e) => {
                  e.stopPropagation()
                  onRetry()
                }}>
                <RotateCw />
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
