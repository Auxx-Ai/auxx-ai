// apps/web/src/components/file-select/types.ts

import type { EntityType } from '@auxx/lib/files/types'
import type { EntityUploadConfig } from '~/components/file-upload/types'
import type { FileItem } from '~/components/files/files-store'

/**
 * FileSelectItem is now just an alias to FileItem for backward compatibility
 * All file handling uses the canonical FileItem type
 */
export type FileSelectItem = FileItem

/**
 * Props for the FileSelect component
 */
export interface FileSelectProps {
  // Selection behavior
  allowMultiple?: boolean
  maxFiles?: number

  // File validation
  fileExtensions?: string[]
  maxFileSize?: number

  // Upload configuration
  entityType?: EntityType
  entityId?: string
  uploadConfig?: Partial<EntityUploadConfig>

  // UI control
  showDropZone?: boolean
  showFilePicker?: boolean
  compact?: boolean
  placeholder?: string

  // Callbacks
  onChange?: (items: FileItem[]) => void
  onUploadComplete?: (items: FileItem[]) => void
  onError?: (error: string) => void

  // Form integration
  value?: FileItem[]
  defaultValue?: FileItem[]

  // Additional props
  className?: string
  disabled?: boolean
}

/**
 * State for the useFileSelect hook
 */
export interface FileSelectState {
  selectedItems: FileItem[]
  uploadSession: string | null
  pickerOpen: boolean
  dragActive: boolean
  errors: string[]
}

/**
 * Actions for the useFileSelect hook
 */
export interface FileSelectActions {
  // Item management
  addItems: (items: FileItem[]) => void
  removeItem: (id: string) => void
  clearItems: () => void

  // Upload actions
  startUpload: () => Promise<void>
  cancelUpload: () => void
  retryUpload: (itemId: string) => void

  // Picker actions
  openPicker: () => void
  closePicker: () => void

  // File operations
  addFiles: (files: File[]) => Promise<void>
  addExistingFiles: (fileItems: FileItem[]) => void

  // Validation
  validateFile: (file: File) => string | null

  // Error handling
  addError: (error: string) => void
  clearErrors: () => void

  // Drag and drop
  setDragActive: (active: boolean) => void
}

/**
 * Options for the useFileSelect hook
 */
export interface UseFileSelectOptions {
  entityType?: EntityType
  entityId?: string
  uploadConfig?: Partial<EntityUploadConfig>
  maxFiles?: number
  maxFileSize?: number
  fileExtensions?: string[]
  allowMultiple?: boolean
  autoStart?: boolean
  autoCreateSession?: boolean
  /** Optional metadata to attach to the upload session (forwarded to server) */
  sessionMetadata?: Record<string, any>
  onChange?: (items: FileSelectItem[]) => void
  onUploadComplete?: (items: FileSelectItem[]) => void
  /** Called when existing files from library are added (separate from uploads) */
  onExistingFilesAdded?: (items: FileSelectItem[]) => void
  onError?: (error: string) => void
}

/**
 * Return type for the useFileSelect hook
 */
export interface UseFileSelectReturn extends FileSelectState, FileSelectActions {}
