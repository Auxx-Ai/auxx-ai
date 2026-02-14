// apps/web/src/components/pickers/file-select-picker.tsx

'use client'

import type { EntityType } from '@auxx/lib/files/types'
import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { Files, Upload } from 'lucide-react'
import type React from 'react'
import { FileSelectPickerButton } from '~/components/file-select/file-select-picker-button'
import { useFileSelect } from '~/components/file-select/hooks/use-file-select'
import type { UseFileSelectReturn } from '~/components/file-select/types'
import { FileItem } from '~/components/file-upload/ui/file-item'
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
      fileTypes={fileTypes}
      {...props}
    />
  )
}

/**
 * The actual picker UI content
 * Always receives a fileSelect instance (either external or internal)
 */
function FileSelectPickerContent({
  fileSelect,
  allowMultiple = true,
  fileTypes,
  onSelect,
  open,
  onOpenChange,
  className,
  disabled,
  align = 'start',
  side,
  sideOffset,
  children,
}: FileSelectPickerContentProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>

      <PopoverContent
        className={cn('w-96 p-0', className)}
        align={align}
        side={side}
        sideOffset={sideOffset}
        disabled={disabled}>
        {/* Action buttons at top */}
        <div className='flex gap-2 p-3 border-b'>
          <Button
            variant='outline'
            size='sm'
            className='flex-1'
            onClick={() => {
              const input = document.createElement('input')
              input.type = 'file'
              input.multiple = allowMultiple
              input.accept = fileTypes ? fileTypes.join(',') : '*/*'
              input.onchange = (e) => {
                const files = Array.from((e.target as HTMLInputElement).files || [])
                if (files.length > 0) {
                  fileSelect.addFiles(files)
                }
              }
              input.click()
            }}>
            <Upload />
            Choose Files
          </Button>

          <FileSelectPickerButton
            open={fileSelect.pickerOpen}
            onOpenChange={(open) => (open ? fileSelect.openPicker() : fileSelect.closePicker())}
            onFilesSelected={(files) => fileSelect.addExistingFiles(files)}
            allowMultiple={allowMultiple}
            variant='outline'
            size='sm'
            className='flex-1'>
            <Files />
            Browse Existing
          </FileSelectPickerButton>
        </div>

        <Command>
          <CommandList>
            <CommandEmpty>No files selected.</CommandEmpty>
            {fileSelect.selectedItems.length > 0 && (
              <CommandGroup heading='Files'>
                {fileSelect.selectedItems.map((item) => (
                  <CommandItem
                    key={item.id}
                    className='py-1 px-2 data-[selected=true]:bg-transparent'>
                    <FileItem
                      file={item}
                      onRemove={() => fileSelect.removeItem(item.id)}
                      onRetry={() => fileSelect.retryUpload(item.id)}
                      onCancel={() => fileSelect.cancelUpload()}
                      showControls={true}
                      className='w-full'
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
