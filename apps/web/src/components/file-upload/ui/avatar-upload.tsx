// apps/web/src/components/file-upload/ui/avatar-upload.tsx

'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Button } from '@auxx/ui/components/button'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { Loader2, Trash2, Upload, User } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { useFileUpload } from '../hooks/use-file-upload'

/**
 * Props for the AvatarUpload component
 */
interface AvatarUploadProps {
  /** Current avatar URL to display */
  currentAvatarUrl?: string
  /** Callback when upload completes successfully */
  onUploadComplete?: (assetId: string, url: string) => void
  /** Callback when upload starts */
  onUploadStart?: () => void
  /** Callback when an error occurs */
  onError?: (error: string) => void
  /** Additional CSS classes */
  className?: string
  /** Avatar size variant */
  size?: 'sm' | 'md' | 'lg'
  /** Visual style variant */
  variant?: 'default' | 'translucent'
  /** Disable the component */
  disabled?: boolean
}

/**
 * Size configurations for different avatar sizes
 */
const sizeConfig = {
  sm: {
    avatar: 'size-16',
    uploadText: 'text-xs',
    buttonSize: 'sm' as const,
  },
  md: {
    avatar: 'size-20',
    uploadText: 'text-sm',
    buttonSize: 'sm' as const,
  },
  lg: {
    avatar: 'size-24',
    uploadText: 'text-sm',
    buttonSize: 'default' as const,
  },
} as const

/**
 * AvatarUpload component for uploading user profile pictures
 * Uses the existing file upload infrastructure with UserProfileProcessor
 */
export function AvatarUpload({
  currentAvatarUrl,
  onUploadComplete,
  onUploadStart,
  onError,
  className,
  size = 'md',
  variant = 'default',
  disabled = false,
}: AvatarUploadProps): JSX.Element {
  const [confirm, ConfirmDialog] = useConfirm()
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isRemoving, setIsRemoving] = useState(false)

  const removeAvatar = api.user.removeAvatar.useMutation()

  const config = sizeConfig[size]

  // Configure useFileUpload for avatar uploads
  const fileUpload = useFileUpload({
    entityType: 'USER_PROFILE',
    // entityId will be automatically set to authenticated user ID by backend
    config: {
      maxFileSize: 5 * 1024 * 1024, // 5MB
      allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      maxFiles: 1,
    },
    onComplete: (results) => {
      if (results.successCount > 0 && results.results?.[0]) {
        const result = results.results[0]
        onUploadComplete?.(result.metadata?.assetId || '', result.url || '')
        setPreviewUrl(result.url)
        toastSuccess({
          title: 'Avatar updated',
          description: 'Your profile picture has been updated successfully',
        })
      }
    },
    onError: (error) => {
      setPreviewUrl(null)
      onError?.(error)
      toastError({ title: 'Upload failed', description: error })
    },
  })

  // Handle file selection
  const handleFileSelect = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return

      const file = files[0]

      // Client-side validation
      if (!file.type.startsWith('image/')) {
        toastError({
          title: 'Invalid file type',
          description: 'Please select an image file (JPEG, PNG, WebP, or GIF)',
        })
        return
      }

      if (file.size > 5 * 1024 * 1024) {
        toastError({
          title: 'File too large',
          description: 'Please select an image smaller than 5MB',
        })
        return
      }

      // Create preview
      const reader = new FileReader()
      reader.onload = (e) => {
        setPreviewUrl(e.target?.result as string)
      }
      reader.readAsDataURL(file)

      try {
        onUploadStart?.()

        // Add files and start upload (session is created lazily by addFiles)
        await fileUpload.addFiles([file])
        await fileUpload.startUpload()
      } catch (error) {
        setPreviewUrl(null)
        const errorMessage = error instanceof Error ? error.message : 'Upload failed'
        onError?.(errorMessage)
        toastError({ title: 'Upload failed', description: errorMessage })
      }
    },
    [fileUpload, onUploadStart, onError]
  )

  // Handle file input change
  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || [])
      handleFileSelect(files)
      // Reset input to allow selecting the same file again
      event.target.value = ''
    },
    [handleFileSelect]
  )

  // Handle drag and drop
  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const files = Array.from(event.dataTransfer.files)
      handleFileSelect(files)
    },
    [handleFileSelect]
  )

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
  }, [])

  // Handle avatar removal
  // biome-ignore lint/correctness/useExhaustiveDependencies: removeAvatar.mutateAsync is stable from useMutation
  const handleRemove = useCallback(async () => {
    if (!currentAvatarUrl && !previewUrl) return

    const confirmed = await confirm({
      title: 'Remove avatar?',
      description: 'This will remove your current profile picture and use your initials instead.',
      confirmText: 'Remove',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (!confirmed) return

    setIsRemoving(true)
    try {
      // For now, just clear the preview and call the callback
      setPreviewUrl(null)
      onUploadComplete?.('', '') // Empty values to indicate removal
      await removeAvatar.mutateAsync()

      toastSuccess({
        title: 'Avatar removed',
        description: 'Your profile picture has been removed',
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to remove avatar'
      toastError({ title: 'Remove failed', description: errorMessage })
    } finally {
      setIsRemoving(false)
    }
  }, [currentAvatarUrl, previewUrl, confirm, onUploadComplete])

  const displayUrl = previewUrl || currentAvatarUrl
  const isUploading = fileUpload.isUploading
  const hasAvatar = Boolean(displayUrl)

  return (
    <div className={cn('flex items-center gap-4', className)}>
      {/* Avatar with drag and drop */}
      <div
        className={cn(
          'relative group cursor-pointer transition-opacity',
          config.avatar,
          disabled && 'opacity-50 cursor-not-allowed'
        )}
        onDrop={disabled ? undefined : handleDrop}
        onDragOver={disabled ? undefined : handleDragOver}
        onClick={
          disabled ? undefined : () => document.getElementById('avatar-upload-input')?.click()
        }>
        <Avatar
          className={cn(
            config.avatar,
            'border-2 border-dashed border-transparent transition-colors',
            variant === 'translucent' ? 'group-hover:border-white/30' : 'group-hover:border-border'
          )}>
          {hasAvatar && <AvatarImage src={displayUrl} alt='Profile' />}
          <AvatarFallback
            className={variant === 'translucent' ? 'bg-[#0519453d] text-white/60' : ''}>
            {isUploading ? (
              <Loader2 className='size-6 animate-spin' />
            ) : (
              <User className='size-6' />
            )}
          </AvatarFallback>
        </Avatar>

        {/* Upload overlay */}
        {!disabled && (
          <div className='absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-full flex items-center justify-center'>
            <Upload className='size-4 text-white' />
          </div>
        )}
      </div>

      {/* Controls */}
      <div className='flex flex-col gap-2 flex-1'>
        <div className='flex gap-2'>
          {/* Upload button */}
          <Button
            variant={variant === 'translucent' ? 'translucent' : 'outline'}
            type='button'
            size={config.buttonSize}
            disabled={disabled || isUploading}
            loading={isUploading}
            loadingText='Uploading...'
            onClick={() => document.getElementById('avatar-upload-input')?.click()}>
            <Upload />
            Upload
          </Button>

          {/* Remove button */}
          {hasAvatar && (
            <Button
              variant={variant === 'translucent' ? 'translucent' : 'outline'}
              type='button'
              size={config.buttonSize}
              disabled={disabled || isRemoving}
              loading={isRemoving}
              loadingText='Removing...'
              onClick={handleRemove}>
              <Trash2 />
              Remove
            </Button>
          )}
        </div>

        {/* Upload progress, errors, or instructions */}
        {isUploading ? (
          <div className='w-full h-8'>
            <div
              className={cn(
                'flex justify-between text-xs mb-1',
                variant === 'translucent' ? 'text-white/60' : 'text-primary-500'
              )}>
              <span>Uploading...</span>
              <span>{fileUpload.uploadSummary?.overallProgress || 0}%</span>
            </div>
            <div className='w-full bg-muted rounded-full h-1.5'>
              <div
                className='bg-info h-1.5 rounded-full transition-all'
                style={{ width: `${fileUpload.uploadSummary?.overallProgress || 0}%` }}
              />
            </div>
          </div>
        ) : fileUpload.errors.length > 0 ? (
          <div className='w-full h-8'>
            <div className='text-xs text-destructive'>
              Upload failed: {fileUpload.errors[0]?.message || 'Unknown error'}
            </div>
          </div>
        ) : (
          <div className='w-full h-8'>
            <p
              className={cn(
                'max-w-xs text-xs',
                config.uploadText,
                variant === 'translucent' ? 'text-white/60' : 'text-primary-500'
              )}>
              Upload a photo to use as your profile picture. Max 5MB. Supports JPEG, PNG, WebP, and
              GIF.
            </p>
          </div>
        )}
      </div>

      {/* Hidden file input */}
      <input
        id='avatar-upload-input'
        type='file'
        accept='image/jpeg,image/png,image/webp,image/gif'
        className='hidden'
        onChange={handleInputChange}
        disabled={disabled}
      />

      {/* Confirmation dialog */}
      <ConfirmDialog />
    </div>
  )
}
