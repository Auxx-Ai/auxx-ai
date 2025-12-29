// apps/web/src/components/file-select/file-select-picker-button.tsx

'use client'

import React from 'react'
import { FolderOpen, Plus } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { FileSelectDialog } from './file-select-dialog'
import type { FileItem } from '~/components/files/files-store'

/**
 * Props for FileSelectPickerButton component
 */
interface FileSelectPickerButtonProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onFilesSelected: (files: FileItem[]) => void
  allowMultiple?: boolean
  disabled?: boolean
  variant?: 'button' | 'inline'
  size?: 'sm' | 'md' | 'lg'
  className?: string
  title?: string
  description?: string
  maxSelection?: number
}

/**
 * Button component that opens a file picker dialog using FileSelectDialog
 * Simplified wrapper around FileSelectDialog for backward compatibility
 */
export function FileSelectPickerButton({
  open,
  onOpenChange,
  onFilesSelected,
  allowMultiple = true,
  disabled = false,
  variant = 'button',
  size = 'default',
  className,
  title,
  description,
  maxSelection,
}: FileSelectPickerButtonProps) {
  const trigger =
    variant === 'inline' ? (
      <Button variant="ghost" size="sm" disabled={disabled} className={className}>
        <Plus />
        Add from Files
      </Button>
    ) : (
      <Button variant="outline" size="sm" disabled={disabled} className={className}>
        <FolderOpen />
        Browse Files
      </Button>
    )

  return (
    <FileSelectDialog
      trigger={trigger}
      open={open}
      onOpenChange={onOpenChange}
      onFilesSelected={onFilesSelected}
      allowMultiple={allowMultiple}
      title={title}
      description={description}
      maxSelection={maxSelection}
      disabled={disabled}
    />
  )
}
