// apps/web/src/components/file-select/hooks/use-file-select.ts

'use client'

import { generateId } from '@auxx/utils/generateId'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useFileUpload } from '~/components/file-upload/hooks/use-file-upload'
import type { FileItem } from '~/components/files/files-store'
import type { FileSelectState, UseFileSelectOptions, UseFileSelectReturn } from '../types'

/**
 * Convert a File object to a FileItem for upload
 */
function fileToFileItem(file: File): FileItem {
  const id = generateId()
  return {
    id,
    name: file.name,
    type: 'file',
    size: BigInt(file.size),
    displaySize: file.size,
    mimeType: file.type || null,
    ext: file.name.includes('.') ? `.${file.name.split('.').pop()}` : null,
    createdAt: new Date(),
    updatedAt: new Date(),
    path: '/',
    parentId: null,

    // Upload-specific fields
    status: 'pending',
    progress: 0,
    isUploading: true,
    source: 'upload',
    tempId: id,
  }
}

/**
 * Prepare a FileItem from filesystem for use in FileSelect
 * No conversion needed - just ensure source is set
 */
function prepareFileSystemItem(fileItem: FileItem): FileItem {
  return {
    ...fileItem,
    source: 'filesystem',
    isUploading: false,
  }
}

/**
 * Main hook for FileSelect component state management
 */
export function useFileSelect(options: UseFileSelectOptions = {}): UseFileSelectReturn {
  const {
    entityType = 'FILE', // Default to 'FILE' entity type
    entityId,
    uploadConfig,
    maxFiles,
    maxFileSize,
    fileExtensions,
    allowMultiple = true,
    autoStart = false,
    // autoCreateSession removed - sessions are created lazily
    sessionMetadata,
    onChange,
    onUploadComplete,
    onExistingFilesAdded,
    onError,
  } = options

  // Local state
  const [selectedItems, setSelectedItems] = useState<FileItem[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  // Track upload session mapping
  const uploadToSelectIdMap = useRef<Map<string, string>>(new Map())

  // Ref to hold latest callback to avoid stale closure in onComplete
  const onUploadCompleteRef = useRef(onUploadComplete)
  useEffect(() => {
    onUploadCompleteRef.current = onUploadComplete
  }, [onUploadComplete])

  // File upload hook for handling uploads - pass ALL configurations
  const upload = useFileUpload({
    entityType,
    entityId,
    sessionMetadata,
    // Pass validation config
    maxFiles,
    maxFileSize,
    fileExtensions,
    // Pass behavior config
    allowMultiple,
    autoStart,
    // autoCreateSession removed - sessions are created lazily on file interaction
    // Pass upload config
    config: uploadConfig,
    onComplete: (results) => {
      // Build completed items directly from results to avoid stale closure issues
      // results.results contains the file info from useFileUpload
      const completedItems: FileItem[] = (results.results || [])
        .filter((r: any) => r.success)
        .map((r: any) => ({
          id: r.fileId,
          name: r.filename,
          type: 'file' as const,
          size: BigInt(r.size || 0),
          displaySize: r.size || 0,
          mimeType: r.mimeType || null,
          ext: r.filename?.includes('.') ? `.${r.filename.split('.').pop()}` : null,
          createdAt: new Date(),
          updatedAt: new Date(),
          path: '/',
          parentId: null,
          status: 'completed',
          progress: 100,
          source: 'upload',
          isUploading: false,
          url: r.url,
          serverFileId: r.metadata?.assetId || r.fileId,
        }))

      // Also update selectedItems state for UI consistency
      if (completedItems.length > 0) {
        setSelectedItems((prev) => {
          // Merge completed items with existing items, updating status
          const updated = prev.map((item) => {
            const completed = completedItems.find(
              (c) => uploadToSelectIdMap.current.get(c.id) === item.id || c.id === item.uploadFileId
            )
            if (completed) {
              return { ...item, ...completed, id: item.id }
            }
            return item
          })
          return updated
        })

        onUploadCompleteRef.current?.(completedItems)
      }
    },
    onError: (error) => {
      addError(error)
      onError?.(error)
    },
    onChange: (_files) => {
      // Sync with local state if needed
      // onChange is already called when selectedItems changes
    },
    onProgress: (_progress) => {
      // Update progress for uploading items
      setSelectedItems((prev) =>
        prev.map((item) => {
          if (item.source === 'upload') {
            const uploadFile = upload.files.find(
              (f) => uploadToSelectIdMap.current.get(f.id) === item.id
            )
            if (uploadFile) {
              return {
                ...item,
                status: uploadFile.status,
                progress: uploadFile.progress,
                error: uploadFile.error,
                // Copy serverFileId as soon as it's known so submit can enable
                serverFileId: (uploadFile as any).serverFileId || item.serverFileId,
                uploadFileId: item.uploadFileId, // Preserve the upload file ID
              } as FileItem
            }
          }
          return item
        })
      )
    },
  })

  // File validation
  const validateFile = useCallback(
    (file: File): string | null => {
      // Size validation
      if (maxFileSize && file.size > maxFileSize) {
        return `File size (${(file.size / 1024 / 1024).toFixed(2)}MB) exceeds maximum allowed size (${(maxFileSize / 1024 / 1024).toFixed(2)}MB)`
      }

      // Extension validation
      if (fileExtensions && fileExtensions.length > 0) {
        const fileExt = file.name.split('.').pop()?.toLowerCase()
        const allowedExts = fileExtensions.map((ext) => ext.replace('.', '').toLowerCase())

        if (!fileExt || !allowedExts.includes(fileExt)) {
          return `File type .${fileExt} is not allowed. Allowed types: ${fileExtensions.join(', ')}`
        }
      }

      return null
    },
    [maxFileSize, fileExtensions]
  )

  // Error management
  const addError = useCallback((error: string) => {
    setErrors((prev) => [...prev, error])
  }, [])

  // Add files for upload
  const addFiles = useCallback(
    async (files: File[]) => {
      // Validate each file
      const validFiles: File[] = []
      const validationErrors: string[] = []

      for (const file of files) {
        const error = validateFile(file)
        if (error) {
          validationErrors.push(`${file.name}: ${error}`)
        } else {
          validFiles.push(file)
        }
      }

      // Check total file count
      if (maxFiles && selectedItems.length + validFiles.length > maxFiles) {
        const allowedCount = maxFiles - selectedItems.length
        validationErrors.push(
          `Cannot add ${validFiles.length} files. Maximum ${maxFiles} files allowed (${allowedCount} slots remaining)`
        )

        if (allowedCount > 0) {
          validFiles.splice(allowedCount) // Keep only files that fit
        } else {
          validFiles.length = 0 // Clear all files
        }
      }

      // Single selection mode
      if (!allowMultiple && validFiles.length > 0) {
        validFiles.splice(1) // Keep only first file
      }

      if (validationErrors.length > 0) {
        setErrors((prev) => [...prev, ...validationErrors])
        onError?.(validationErrors.join('; '))
      }

      if (validFiles.length === 0) return

      // Create FileItems for upload
      const newItems = validFiles.map(fileToFileItem)

      // Add to upload queue and track mapping deterministically using returned IDs
      const addedIds = await upload.addFiles(validFiles)
      addedIds.forEach((uploadFileId, index) => {
        uploadToSelectIdMap.current.set(uploadFileId, newItems[index].id)
        // Store the upload file ID for real-time subscription
        newItems[index].uploadFileId = uploadFileId
      })

      // Update state
      if (!allowMultiple) {
        setSelectedItems(newItems) // Replace all items
      } else {
        setSelectedItems((prev) => [...prev, ...newItems])
      }

      // Trigger onChange
      const updatedItems = allowMultiple ? [...selectedItems, ...newItems] : newItems
      onChange?.(updatedItems)

      // Auto-start upload if enabled
      if (autoStart) {
        try {
          await upload.startUpload()
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Upload failed to start'
          addError(message)
          onError?.(message)
        }
      }
    },
    [
      validateFile,
      maxFiles,
      selectedItems,
      allowMultiple,
      upload,
      onChange,
      onError,
      autoStart,
      addError,
    ]
  )

  // Add existing files from filesystem
  const addExistingFiles = useCallback(
    (fileItems: FileItem[]) => {
      // Dedupe: filter out files already selected
      const deduped = fileItems.filter((f) => !selectedItems.some((item) => item.id === f.id))

      if (deduped.length === 0) {
        console.log('[useFileSelect] No new files to add (all already selected)')
        return
      }

      // Check limits
      let itemsToAdd = deduped

      if (maxFiles && selectedItems.length + itemsToAdd.length > maxFiles) {
        const allowedCount = maxFiles - selectedItems.length
        itemsToAdd = itemsToAdd.slice(0, allowedCount)

        if (allowedCount < deduped.length) {
          addError(`Only added ${allowedCount} files. Maximum ${maxFiles} files allowed.`)
        }
      }

      if (!allowMultiple && itemsToAdd.length > 0) {
        itemsToAdd = [itemsToAdd[0]] // Keep only first item
      }

      if (itemsToAdd.length === 0) return

      const newItems = itemsToAdd.map(prepareFileSystemItem)

      // Update state and call callbacks with latest state
      setSelectedItems((prev) => {
        const next = allowMultiple ? [...prev, ...newItems] : newItems
        // Call onChange with the updated state
        onChange?.(next)
        return next
      })

      // Notify that existing files were added (separate from onChange)
      if (newItems.length > 0 && onExistingFilesAdded) {
        onExistingFilesAdded(newItems)
      }
    },
    [maxFiles, selectedItems, allowMultiple, onChange, onExistingFilesAdded, addError]
  )

  // Add items directly
  const addItems = useCallback(
    (items: FileItem[]) => {
      if (!allowMultiple && items.length > 0) {
        setSelectedItems([items[0]])
        onChange?.([items[0]])
      } else {
        setSelectedItems((prev) => [...prev, ...items])
        onChange?.([...selectedItems, ...items])
      }
    },
    [allowMultiple, selectedItems, onChange]
  )

  // Remove item
  const removeItem = useCallback(
    (id: string) => {
      setSelectedItems((prev) => {
        const updated = prev.filter((item) => item.id !== id)
        onChange?.(updated)
        return updated
      })

      // Also remove from upload queue if it's an upload item
      const item = selectedItems.find((item) => item.id === id)
      if (item?.source === 'upload') {
        const uploadId = Array.from(uploadToSelectIdMap.current.entries()).find(
          ([, selectId]) => selectId === id
        )?.[0]

        if (uploadId) {
          upload.removeFile(uploadId)
          uploadToSelectIdMap.current.delete(uploadId)
        }
      }
    },
    [selectedItems, upload, onChange]
  )

  // Clear all items
  const clearItems = useCallback(() => {
    setSelectedItems([])
    upload.reset()
    uploadToSelectIdMap.current.clear()
    onChange?.([])
  }, [upload, onChange])

  // Upload actions
  const startUpload = useCallback(async () => {
    try {
      await upload.startUpload()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed'
      addError(message)
      onError?.(message)
    }
  }, [upload, onError])

  const cancelUpload = useCallback(() => {
    upload.cancelUpload()
  }, [upload])

  const retryUpload = useCallback(
    (itemId: string) => {
      const uploadId = Array.from(uploadToSelectIdMap.current.entries()).find(
        ([, selectId]) => selectId === itemId
      )?.[0]

      if (uploadId) {
        upload.retry(uploadId)
      }
    },
    [upload]
  )

  // Picker actions
  const openPicker = useCallback(() => setPickerOpen(true), [])
  const closePicker = useCallback(() => setPickerOpen(false), [])

  // Clear errors
  const clearErrors = useCallback(() => {
    setErrors([])
    upload.clearErrors()
  }, [upload])

  return {
    // State
    selectedItems,
    uploadSession: upload.sessionId,
    pickerOpen,
    dragActive,
    errors,

    // Actions
    addItems,
    removeItem,
    clearItems,
    startUpload,
    cancelUpload,
    retryUpload,
    openPicker,
    closePicker,
    addFiles,
    addExistingFiles,
    validateFile,
    addError,
    clearErrors,
    setDragActive,
  }
}
