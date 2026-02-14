// apps/web/src/components/files/utils/attachment-thumbnail.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'

interface AttachmentThumbnailProps {
  attachmentId: string
  alt: string
  className?: string
  fallback?: React.ReactNode
  maxRetries?: number
  retryDelay?: number
}

/**
 * Component for displaying attachment thumbnails with smart polling
 * Handles 202 responses when thumbnails are being generated
 * @param attachmentId - The ID of the attachment to display
 * @param alt - Alternative text for the image
 * @param className - Additional CSS classes to apply
 * @param fallback - Component to display if image fails to load
 * @param maxRetries - Maximum number of polling attempts (default: 5)
 * @param retryDelay - Delay between polling attempts in ms (default: 2000)
 */
export function AttachmentThumbnail({
  attachmentId,
  alt,
  className,
  fallback,
  maxRetries = 5,
  retryDelay = 2000,
}: AttachmentThumbnailProps) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attemptCount, setAttemptCount] = useState(0)
  const timeoutRef = useRef<NodeJS.Timeout>()

  useEffect(() => {
    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    // Simply try to load the image - the browser will handle redirects
    // If it loads successfully, great. If not, we'll retry.
    setStatus('loading')

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [attachmentId])

  const handleImageError = () => {
    // On error, check if we should retry
    if (attemptCount < maxRetries) {
      setAttemptCount((prev) => prev + 1)
      // Exponential backoff for retries
      const backoffDelay = retryDelay * 1.5 ** attemptCount
      timeoutRef.current = setTimeout(() => {
        // Force re-render by updating a key or timestamp
        setStatus('loading')
      }, backoffDelay)
    } else {
      setStatus('error')
    }
  }

  const handleImageLoad = () => {
    setStatus('ready')
  }

  if (status === 'error' && fallback) {
    return <>{fallback}</>
  }

  return (
    <div className='relative size-12'>
      {status === 'loading' && (
        <div className='absolute inset-0 bg-gray-200 animate-pulse rounded' />
      )}
      <img
        key={`${attachmentId}-${attemptCount}`} // Force reload on retry
        src={`/api/attachments/${attachmentId}/thumbnail`}
        alt={alt}
        className={cn('size-12 object-cover rounded', className)}
        width={48}
        height={48}
        loading='lazy'
        decoding='async'
        onLoad={handleImageLoad}
        onError={handleImageError}
        style={{ opacity: status === 'ready' ? 1 : 0, transition: 'opacity 0.2s' }}
      />
      {status === 'error' && fallback}
    </div>
  )
}
