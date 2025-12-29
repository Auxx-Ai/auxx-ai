// apps/web/src/app/(protected)/app/rules/_components/testing/file-upload.tsx
'use client'

import { useCallback } from 'react'
import { Upload } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'

interface FileUploadProps {
  accept?: string
  onUpload: (file: File) => void
  className?: string
}

export function FileUpload({ accept, onUpload, className }: FileUploadProps) {
  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) {
        onUpload(file)
      }
    },
    [onUpload]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      const file = e.dataTransfer.files?.[0]
      if (file) {
        onUpload(file)
      }
    },
    [onUpload]
  )

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
  }, [])

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      className={cn(
        'relative border-2 border-dashed rounded-lg p-6 text-center hover:border-primary/50 transition-colors cursor-pointer',
        className
      )}>
      <input
        type="file"
        accept={accept}
        onChange={handleFileChange}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      />
      <Upload className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
      <p className="text-sm text-muted-foreground">Drop file here or click to upload</p>
      <p className="text-xs text-muted-foreground mt-1">
        {accept ? `Accepted formats: ${accept}` : 'All file types accepted'}
      </p>
    </div>
  )
}
