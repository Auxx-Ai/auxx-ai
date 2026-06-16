// apps/web/src/components/pickers/files-picker.tsx
'use client'

import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import type React from 'react'
import { memo, useCallback, useState } from 'react'
import type { FileItem } from '~/components/files/files-store'
import { FileBrowseLevel } from '~/components/pickers/file-browse-level'

/**
 * Selection state interface
 */
export interface FileSelection {
  files: string[]
  folders: string[]
}

/**
 * Props for the FilesPicker component
 */
interface FilesPickerProps {
  // Selection control
  selectedFiles?: string[]
  selectedFolders?: string[]
  onChange?: (selection: FileSelection) => void

  // Selection behavior
  allowMultiple?: boolean
  allowFiles?: boolean
  allowFolders?: boolean
  onlyLeafSelection?: boolean

  // Filtering
  fileExtensions?: string[]
  maxFileSize?: number

  // Enhanced search capabilities
  enableGlobalSearch?: boolean
  searchPlaceholder?: string
  showPath?: boolean

  // Popover control
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: React.ReactNode

  // UI control
  className?: string
  disabled?: boolean
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number

  // Content sizing
  width?: number | string
  maxHeight?: number | string

  // Keyboard navigation
  enableKeyboardNavigation?: boolean
  onSelect?: (item: FileItem) => void
}

/**
 * Files picker — a Popover wrapper around {@link FileBrowseLevel}. Owns the
 * popover open state and the selection semantics (toggle the controlled
 * file/folder id sets; single-select replaces and closes).
 */
function filesPicker({
  selectedFiles = [],
  selectedFolders = [],
  onChange,
  allowMultiple = true,
  allowFiles = true,
  allowFolders = true,
  onlyLeafSelection = false,
  fileExtensions,
  maxFileSize,
  enableGlobalSearch = false,
  searchPlaceholder = 'Search files and folders...',
  showPath = false,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  trigger,
  disabled = false,
  className,
  align = 'start',
  side = 'bottom',
  sideOffset = 4,
  width = 400,
  enableKeyboardNavigation = true,
  onSelect,
}: FilesPickerProps): React.ReactElement {
  // Internal open state for uncontrolled mode
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen
  const onOpenChange = controlledOnOpenChange || setInternalOpen

  const handleSelectItem = useCallback(
    (item: FileItem) => {
      onSelect?.(item)
      const isFile = item.type === 'file'
      const alreadySelected = isFile
        ? selectedFiles.includes(item.id)
        : selectedFolders.includes(item.id)

      if (alreadySelected) {
        onChange?.(
          isFile
            ? { files: selectedFiles.filter((id) => id !== item.id), folders: selectedFolders }
            : { files: selectedFiles, folders: selectedFolders.filter((id) => id !== item.id) }
        )
        return
      }

      if (!allowMultiple) {
        onChange?.(isFile ? { files: [item.id], folders: [] } : { files: [], folders: [item.id] })
        onOpenChange(false)
        return
      }

      onChange?.(
        isFile
          ? { files: [...selectedFiles, item.id], folders: selectedFolders }
          : { files: selectedFiles, folders: [...selectedFolders, item.id] }
      )
    },
    [selectedFiles, selectedFolders, onChange, allowMultiple, onOpenChange, onSelect]
  )

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild disabled={disabled}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        className={cn('p-0', className)}
        align={align}
        side={side}
        sideOffset={sideOffset}
        style={{ width: typeof width === 'number' ? `${width}px` : width }}>
        <FileBrowseLevel
          selectedFiles={selectedFiles}
          selectedFolders={selectedFolders}
          onSelectItem={handleSelectItem}
          allowMultiple={allowMultiple}
          allowFiles={allowFiles}
          allowFolders={allowFolders}
          onlyLeafSelection={onlyLeafSelection}
          fileExtensions={fileExtensions}
          maxFileSize={maxFileSize}
          enableGlobalSearch={enableGlobalSearch}
          searchPlaceholder={searchPlaceholder}
          showPath={showPath}
          enableKeyboardNavigation={enableKeyboardNavigation}
          onRequestClose={() => onOpenChange(false)}
        />
      </PopoverContent>
    </Popover>
  )
}

export const FilesPicker = memo(filesPicker)
