// apps/web/src/components/files/file-drop-zone.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Upload } from 'lucide-react'
import type React from 'react'
import { useCallback, useRef, useState } from 'react'

/**
 * Props for the FileDropZone component
 */
interface FileDropZoneProps {
  onFilesDropped: (files: File[]) => void
  currentFolderName?: string
  disabled?: boolean
  children: React.ReactNode
}

/**
 * Drop zone component that allows files to be dropped anywhere within its bounds
 * Provides visual feedback when files are dragged over the zone
 */
export function FileDropZone({
  onFilesDropped,
  currentFolderName = 'Files',
  disabled = false,
  children,
}: FileDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [dragCounter, setDragCounter] = useState(0)
  const dropRef = useRef<HTMLDivElement>(null)

  /**
   * Handle drag enter event
   * Uses a counter to properly track enter/leave events across nested elements
   */
  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (disabled) return

      setDragCounter((prev) => prev + 1)

      // Check if dragged items contain files
      if (e.dataTransfer.items) {
        const hasFiles = Array.from(e.dataTransfer.items).some((item) => item.kind === 'file')
        if (hasFiles) {
          setIsDragOver(true)
        }
      }
    },
    [disabled]
  )

  /**
   * Handle drag leave event
   * Only hide overlay when all nested elements have been left
   */
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()

    setDragCounter((prev) => {
      const newCount = prev - 1
      if (newCount === 0) {
        setIsDragOver(false)
      }
      return newCount
    })
  }, [])

  /**
   * Handle drag over event
   * Required to allow dropping
   */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  /**
   * Handle drop event
   * Extract files and pass them to the callback
   */
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()

      setIsDragOver(false)
      setDragCounter(0)

      if (disabled) return

      const files = Array.from(e.dataTransfer.files)
      if (files.length > 0) {
        onFilesDropped(files)
      }
    },
    [onFilesDropped, disabled]
  )

  return (
    <div
      ref={dropRef}
      className='relative min-h-0 w-full flex flex-col flex-1'
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}>
      {children}

      {/* Drag Overlay */}
      {isDragOver && (
        <div className='absolute inset-0 z-50 bg-blue-500/10 border-2 border-dashed border-blue-500 rounded-lg flex items-center justify-center backdrop-blur-sm'>
          <div className='text-center'>
            <Upload className='h-12 w-12 text-blue-600 mx-auto mb-4' />
            <h3 className='text-lg font-semibold text-blue-900 dark:text-blue-100 mb-2'>
              Drop files to upload
            </h3>
            <Badge variant='secondary' className='text-sm'>
              Uploading to: {currentFolderName}
            </Badge>
          </div>
        </div>
      )}
    </div>
  )
}
