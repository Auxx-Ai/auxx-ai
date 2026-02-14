// apps/web/src/components/attachments/attachment-preview.tsx

'use client'

import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent } from '@auxx/ui/components/card'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { AlertTriangle, Download, ExternalLink, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '~/trpc/react'
import { getFileIcon } from '../files/utils/file-icon'

/**
 * Props for the AttachmentPreview component
 */
interface AttachmentPreviewProps {
  /** Type of attachment - file or asset */
  type: 'file' | 'asset'
  /** ID of the file or asset */
  id: string
  /** Version to preview - current, latest, or specific version number */
  version?: 'current' | 'latest' | number
  /** Custom className for styling */
  className?: string
  /** Preferred renderer type */
  preferredRenderer?: 'auto' | 'image' | 'video' | 'audio' | 'pdf' | 'text'
  /** Whether to show interactive toolbar */
  interactive?: boolean
  /** Width of the preview container */
  width?: string | number
  /** Height of the preview container */
  height?: string | number
}

/**
 * AttachmentPreview component that can preview files and media assets
 * with versioning support (current, latest, or specific version number).
 */
export function AttachmentPreview({
  type,
  id,
  version = 'current',
  className,
  preferredRenderer = 'auto',
  interactive = false,
  width = '100%',
  height = 300,
}: AttachmentPreviewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [filename, setFilename] = useState<string>('')
  const [mimeType, setMimeType] = useState<string>('')
  const [size, setSize] = useState<bigint | undefined>()
  const [expiresAt, setExpiresAt] = useState<Date | undefined>()
  const [versionNumber, setVersionNumber] = useState<number>(0)
  const [error, setError] = useState<string | null>(null)
  const [isExpired, setIsExpired] = useState(false)

  // Query to get preview download reference
  const {
    data: downloadRef,
    isLoading,
    error: queryError,
    refetch,
  } = api.file.getAttachmentPreviewRef.useQuery(
    {
      type,
      id,
      version,
      disposition: 'inline',
    },
    {
      enabled: Boolean(id),
      staleTime: 5 * 60 * 1000, // 5 minutes
      refetchOnWindowFocus: false,
    }
  )

  // Update state when download reference is fetched
  useEffect(() => {
    if (downloadRef) {
      if (downloadRef.type === 'url') {
        setPreviewUrl(downloadRef.url)
        setExpiresAt(downloadRef.expiresAt)
      } else {
        setError('Stream-based content not supported for preview')
      }
      setFilename(downloadRef.filename)
      setMimeType(downloadRef.mimeType || '')
      setSize(downloadRef.size)
      setVersionNumber(downloadRef.versionNumber)
      setError(null)
      setIsExpired(false)
    }
  }, [downloadRef])

  // Handle query errors
  useEffect(() => {
    if (queryError) {
      setError(queryError.message || 'Failed to load preview')
    }
  }, [queryError])

  // Check for URL expiration
  useEffect(() => {
    if (!expiresAt) return

    const checkExpiration = () => {
      if (new Date() > expiresAt) {
        setIsExpired(true)
        setPreviewUrl(null)
      }
    }

    // Check immediately
    checkExpiration()

    // Set up interval to check every minute
    const interval = setInterval(checkExpiration, 60000)

    return () => clearInterval(interval)
  }, [expiresAt])

  // Determine the appropriate renderer based on MIME type or preference
  const getRenderer = useCallback(() => {
    if (preferredRenderer !== 'auto') {
      return preferredRenderer
    }

    if (!mimeType) return 'fallback'

    if (mimeType.startsWith('image/')) return 'image'
    if (mimeType.startsWith('video/')) return 'video'
    if (mimeType.startsWith('audio/')) return 'audio'
    if (mimeType === 'application/pdf') return 'pdf'
    // Don't use iframe for CSV files as they auto-download
    if (mimeType === 'text/csv' || mimeType === 'application/csv') {
      return 'fallback'
    }
    if (mimeType.startsWith('text/') || mimeType.includes('json') || mimeType.includes('xml')) {
      return 'text'
    }

    return 'fallback'
  }, [mimeType, preferredRenderer])

  // Handle refresh action
  const handleRefresh = useCallback(() => {
    setError(null)
    setIsExpired(false)
    refetch()
  }, [refetch])

  // Handle download action
  const handleDownload = useCallback(() => {
    if (previewUrl) {
      const link = document.createElement('a')
      link.href = previewUrl
      link.download = filename
      link.setAttribute('target', '_blank')
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
  }, [previewUrl, filename])

  // Handle open in new tab
  const handleOpenExternal = useCallback(() => {
    if (previewUrl) {
      window.open(previewUrl, '_blank')
    }
  }, [previewUrl])

  // Render loading state
  if (isLoading) {
    return (
      <Card className={cn('overflow-hidden', className)} style={{ width, height }}>
        <CardContent className='p-4 h-full flex flex-col justify-center items-center'>
          <Skeleton className='w-12 h-12 rounded-lg mb-2' />
          <Skeleton className='w-24 h-4 mb-1' />
          <Skeleton className='w-16 h-3' />
        </CardContent>
      </Card>
    )
  }

  // Render error state
  if (error || isExpired) {
    return (
      <Card className={cn('overflow-hidden', className)} style={{ width, height }}>
        <CardContent className='p-4 h-full flex flex-col justify-center'>
          <Alert variant='destructive' className='mb-4'>
            <AlertTriangle className='h-4 w-4' />
            <AlertDescription>{isExpired ? 'Preview URL has expired' : error}</AlertDescription>
          </Alert>
          {interactive && (
            <div className='flex gap-2 justify-center'>
              <Button
                variant='outline'
                size='sm'
                onClick={handleRefresh}
                disabled={isLoading}
                className='flex items-center gap-2'>
                <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
                Retry
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  // Render preview based on file type
  const renderPreview = () => {
    const renderer = getRenderer()

    if (!previewUrl) {
      return (
        <div className='flex flex-col items-center justify-center h-full text-center p-4'>
          <div className='flex items-center justify-center w-12 h-12 rounded-lg bg-muted mb-2'>
            {getFileIcon(mimeType, undefined, 'h-6 w-6')}
          </div>
          <p className='text-sm font-medium'>{filename}</p>
          <p className='text-xs text-muted-foreground'>Preview not available</p>
        </div>
      )
    }

    switch (renderer) {
      case 'image':
        return (
          <img
            src={previewUrl}
            alt={filename}
            className='w-full h-full object-contain'
            onError={() => setError('Failed to load image')}
          />
        )

      case 'video':
        return (
          <video
            src={previewUrl}
            controls
            className='w-full h-full'
            onError={() => setError('Failed to load video')}>
            <source src={previewUrl} type={mimeType} />
            Your browser does not support the video tag.
          </video>
        )

      case 'audio':
        return (
          <div className='flex flex-col items-center justify-center h-full p-4'>
            <div className='flex items-center justify-center w-16 h-16 rounded-lg bg-muted mb-4'>
              {getFileIcon(mimeType, undefined, 'h-8 w-8')}
            </div>
            <audio
              src={previewUrl}
              controls
              className='w-full max-w-sm'
              onError={() => setError('Failed to load audio')}>
              <source src={previewUrl} type={mimeType} />
              Your browser does not support the audio tag.
            </audio>
            <p className='text-sm font-medium mt-2'>{filename}</p>
          </div>
        )

      case 'pdf':
        return (
          <iframe
            src={previewUrl}
            className='w-full h-full border-0'
            title={`PDF Preview: ${filename}`}
            onError={() => setError('Failed to load PDF')}
          />
        )

      case 'text':
        return (
          <iframe
            src={previewUrl}
            className='w-full h-full border-0 bg-white'
            title={`Text Preview: ${filename}`}
            onError={() => setError('Failed to load text file')}
          />
        )

      default:
        return (
          <div className='flex flex-col items-center justify-center h-full text-center p-4'>
            <div className='flex items-center justify-center w-16 h-16 rounded-lg bg-muted mb-4'>
              {getFileIcon(mimeType, undefined, 'h-8 w-8')}
            </div>
            <p className='text-sm font-medium mb-1'>{filename}</p>
            <p className='text-xs text-muted-foreground mb-4'>{mimeType || 'Unknown file type'}</p>
            {interactive && (
              <div className='flex gap-2'>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={handleDownload}
                  className='flex items-center gap-2'>
                  <Download className='h-4 w-4' />
                  Download
                </Button>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={handleOpenExternal}
                  className='flex items-center gap-2'>
                  <ExternalLink className='h-4 w-4' />
                  Open
                </Button>
              </div>
            )}
          </div>
        )
    }
  }

  return (
    <Card className={cn('overflow-hidden', className)} style={{ width, height }}>
      <CardContent className='p-0 h-full flex flex-col'>
        {/* Interactive toolbar */}
        {interactive && previewUrl && (
          <div className='flex items-center justify-between p-2 border-b bg-muted/50'>
            <div className='flex items-center gap-2 text-xs text-muted-foreground'>
              <span>Version {versionNumber}</span>
              {size && <span>• {(Number(size) / 1024 / 1024).toFixed(2)} MB</span>}
            </div>
            <div className='flex gap-1'>
              <Button
                variant='ghost'
                size='sm'
                onClick={handleDownload}
                className='h-7 px-2 text-xs'>
                <Download className='h-3 w-3' />
              </Button>
              <Button
                variant='ghost'
                size='sm'
                onClick={handleOpenExternal}
                className='h-7 px-2 text-xs'>
                <ExternalLink className='h-3 w-3' />
              </Button>
              <Button
                variant='ghost'
                size='sm'
                onClick={handleRefresh}
                className='h-7 px-2 text-xs'>
                <RefreshCw className='h-3 w-3' />
              </Button>
            </div>
          </div>
        )}

        {/* Preview content */}
        <div className='flex-1 min-h-0'>{renderPreview()}</div>
      </CardContent>
    </Card>
  )
}
