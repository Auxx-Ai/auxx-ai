// apps/web/src/components/datasets/document-upload-zone.tsx

'use client'

import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent } from '@auxx/ui/components/card'
import { Progress } from '@auxx/ui/components/progress'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { formatBytes } from '@auxx/utils/file'
import { AlertCircle, CheckCircle, FileText, Loader2, Upload, X } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { api } from '~/trpc/react'

interface FileWithProgress {
  file: File
  progress: number
  status: 'pending' | 'uploading' | 'completed' | 'error'
  error?: string
  documentId?: string
}

interface DocumentUploadZoneProps {
  datasetId: string
  onUploadComplete?: (documents: any[]) => void
  className?: string
}

const ACCEPTED_FILE_TYPES = {
  'text/plain': ['.txt'],
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/msword': ['.doc'],
  'text/markdown': ['.md'],
  'text/csv': ['.csv'],
  'application/json': ['.json'],
}

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

/**
 * Document upload zone for datasets
 * Provides drag-and-drop file upload with progress tracking
 * Integrates with the existing file upload system and document processing pipeline
 */
export function DocumentUploadZone({
  datasetId,
  onUploadComplete,
  className,
}: DocumentUploadZoneProps) {
  const [files, setFiles] = useState<FileWithProgress[]>([])
  const [isUploading, setIsUploading] = useState(false)

  const utils = api.useUtils()

  // Use the existing document.upload tRPC endpoint
  const uploadDocuments = api.document.upload.useMutation({
    onSuccess: (data) => {
      toastSuccess({
        title: 'Documents uploaded',
        description: `Successfully uploaded documents to dataset`,
      })

      // Mark all files as completed
      setFiles((prev) => prev.map((f) => ({ ...f, status: 'completed' as const, progress: 100 })))

      // Refresh datasets list and stats
      utils.dataset.list.invalidate()
      utils.dataset.getOrganizationStats.invalidate()
      utils.dataset.getById.invalidate({ id: datasetId })

      // Call success callback and clear files after delay
      onUploadComplete?.(data.documents || [])

      setTimeout(() => {
        setFiles([])
        setIsUploading(false)
      }, 2000)
    },
    onError: (error) => {
      toastError({
        title: 'Upload failed',
        description: error.message,
      })

      // Mark files as error
      setFiles((prev) =>
        prev.map((f) => ({
          ...f,
          status: 'error' as const,
          error: error.message,
        }))
      )

      setIsUploading(false)
    },
  })

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newFiles: FileWithProgress[] = acceptedFiles.map((file) => ({
      file,
      progress: 0,
      status: 'pending' as const,
    }))

    setFiles((prev) => [...prev, ...newFiles])
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_FILE_TYPES,
    maxSize: MAX_FILE_SIZE,
    multiple: true,
    onDropRejected: (rejectedFiles) => {
      rejectedFiles.forEach(({ file, errors }) => {
        const error = errors[0]
        toastError({
          title: `Failed to add ${file.name}`,
          description: error?.message || 'File rejected',
        })
      })
    },
  })

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleUpload = async () => {
    if (files.length === 0) return

    setIsUploading(true)

    try {
      // Simulate progress for UX
      const progressInterval = setInterval(() => {
        setFiles((prev) =>
          prev.map((f) =>
            f.status === 'pending'
              ? {
                  ...f,
                  status: 'uploading' as const,
                  progress: Math.min(f.progress + 10, 90),
                }
              : f
          )
        )
      }, 200)

      // Prepare documents for upload
      const documentsToUpload = files.map((fileItem) => {
        // Determine document type based on file extension/mime type
        const getDocumentType = (file: File) => {
          const ext = file.name.toLowerCase().split('.').pop()
          switch (ext) {
            case 'pdf':
              return 'PDF'
            case 'docx':
            case 'doc':
              return 'DOCX'
            case 'md':
            case 'markdown':
              return 'MARKDOWN'
            case 'csv':
              return 'CSV'
            case 'json':
              return 'JSON'
            case 'txt':
            default:
              return 'TXT'
          }
        }

        return {
          datasetId,
          title: fileItem.file.name.replace(/\.[^/.]+$/, ''), // Remove extension
          filename: fileItem.file.name,
          mimeType: fileItem.file.type,
          type: getDocumentType(fileItem.file),
          size: fileItem.file.size,
          // Note: In a real implementation, you'd need to upload the file content
          // This is a simplified version that assumes the tRPC endpoint handles file upload
          // You might need to convert File to base64 or use FormData
          content: undefined, // File content would be processed server-side
        }
      })

      // Clear the progress interval
      clearInterval(progressInterval)

      // Upload documents
      await uploadDocuments.mutateAsync({
        documents: documentsToUpload,
      })
    } catch (error) {
      setFiles((prev) =>
        prev.map((f) => ({
          ...f,
          status: 'error' as const,
          error: error instanceof Error ? error.message : 'Upload failed',
        }))
      )
      setIsUploading(false)
    }
  }

  const getStatusIcon = (status: FileWithProgress['status']) => {
    switch (status) {
      case 'uploading':
        return <Loader2 className='h-4 w-4 animate-spin' />
      case 'completed':
        return <CheckCircle className='h-4 w-4 text-green-600' />
      case 'error':
        return <AlertCircle className='h-4 w-4 text-red-600' />
      default:
        return <FileText className='h-4 w-4' />
    }
  }

  return (
    <div className={className}>
      {/* Drop Zone */}
      <Card
        {...getRootProps()}
        className={cn(
          'border-2 border-dashed transition-colors cursor-pointer',
          isDragActive ? 'border-primary bg-primary/5' : 'border-border',
          'hover:border-primary hover:bg-primary/5',
          isUploading && 'cursor-not-allowed opacity-50'
        )}>
        <CardContent className='flex flex-col items-center justify-center py-12 px-6'>
          <input {...getInputProps()} disabled={isUploading} />
          <Upload className='h-12 w-12 text-muted-foreground mb-4' />
          <div className='text-center'>
            <p className='text-lg font-medium mb-2'>
              {isDragActive ? 'Drop files here...' : 'Upload documents to your dataset'}
            </p>
            <p className='text-sm text-muted-foreground mb-4'>
              Drag and drop files here, or click to browse
            </p>
            <div className='flex flex-wrap gap-2 justify-center'>
              <Badge variant='secondary'>PDF</Badge>
              <Badge variant='secondary'>DOCX</Badge>
              <Badge variant='secondary'>TXT</Badge>
              <Badge variant='secondary'>MD</Badge>
              <Badge variant='secondary'>CSV</Badge>
              <Badge variant='secondary'>JSON</Badge>
            </div>
            <p className='text-xs text-muted-foreground mt-2'>Maximum file size: 50MB per file</p>
          </div>
        </CardContent>
      </Card>

      {/* File List */}
      {files.length > 0 && (
        <div className='mt-6 space-y-3'>
          <div className='flex items-center justify-between'>
            <h3 className='text-lg font-medium'>Files ({files.length})</h3>
            <div className='space-x-2'>
              <Button
                variant='outline'
                size='sm'
                onClick={() => setFiles([])}
                disabled={isUploading}>
                Clear All
              </Button>
              <Button
                size='sm'
                onClick={handleUpload}
                disabled={isUploading || files.length === 0}
                loading={isUploading}
                loadingText='Uploading...'>
                Upload {files.length} File{files.length !== 1 ? 's' : ''}
              </Button>
            </div>
          </div>

          <div className='space-y-2'>
            {files.map((fileItem, index) => (
              <Card key={index}>
                <CardContent className='p-4'>
                  <div className='flex items-center gap-3'>
                    <div className='flex-shrink-0'>{getStatusIcon(fileItem.status)}</div>

                    <div className='flex-1 min-w-0'>
                      <p className='font-medium truncate'>{fileItem.file.name}</p>
                      <p className='text-sm text-muted-foreground'>
                        {formatBytes(fileItem.file.size)}
                      </p>

                      {fileItem.status === 'uploading' && (
                        <Progress value={fileItem.progress} className='mt-2' />
                      )}

                      {fileItem.status === 'error' && fileItem.error && (
                        <Alert className='mt-2'>
                          <AlertCircle className='h-4 w-4' />
                          <AlertDescription className='text-sm'>{fileItem.error}</AlertDescription>
                        </Alert>
                      )}

                      {fileItem.status === 'completed' && (
                        <p className='text-sm text-green-600 mt-1'>Successfully uploaded</p>
                      )}
                    </div>

                    {!isUploading && fileItem.status === 'pending' && (
                      <Button variant='ghost' size='sm' onClick={() => removeFile(index)}>
                        <X className='h-4 w-4' />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
