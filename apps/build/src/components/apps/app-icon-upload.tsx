// apps/build/src/components/apps/app-icon-upload.tsx

'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Camera, Loader2 } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { toastError } from '~/components/global/toast'
import { usePatchApp } from '~/components/providers/dehydrated-state-provider'
import { useSimpleUpload } from '~/hooks/use-simple-upload'
import { api } from '~/trpc/react'

const ACCEPTED_TYPES = 'image/png,image/jpeg,image/webp,image/svg+xml'

interface AppIconUploadProps {
  appId: string
  appSlug: string
  appTitle: string
  currentAvatarUrl?: string | null
}

/**
 * App icon upload component with circular avatar preview and file picker.
 */
export function AppIconUpload({ appId, appSlug, appTitle, currentAvatarUrl }: AppIconUploadProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const { upload, isUploading, progress } = useSimpleUpload()
  const utils = api.useUtils()
  const patchApp = usePatchApp()

  const updateApp = api.apps.update.useMutation({
    onSuccess: (_data, variables) => {
      patchApp(appId, { avatarUrl: variables.avatarUrl ?? null })
      utils.apps.get.invalidate({ slug: appSlug })
    },
  })

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      // Reset input so re-selecting same file triggers change event
      e.target.value = ''

      // Show local preview immediately
      const objectUrl = URL.createObjectURL(file)
      setPreviewUrl(objectUrl)

      try {
        const result = await upload(file, appId)

        // Save avatar URL to app record
        await updateApp.mutateAsync({
          id: appId,
          avatarUrl: result.cdnUrl,
        })
      } catch (err) {
        // Revert preview on failure
        setPreviewUrl(null)
        toastError({
          title: 'Upload failed',
          description: err instanceof Error ? err.message : 'Failed to upload icon',
        })
      } finally {
        URL.revokeObjectURL(objectUrl)
      }
    },
    [appId, upload, updateApp, utils]
  )

  const displayUrl = previewUrl || currentAvatarUrl
  const fallbackInitial = appTitle.charAt(0).toUpperCase()

  return (
    <div className='flex items-center gap-4'>
      <button
        type='button'
        className='group relative size-16 rounded-full cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
        onClick={() => inputRef.current?.click()}
        disabled={isUploading}
        aria-label='Upload app icon'>
        <Avatar className='size-16'>
          <AvatarImage src={displayUrl || undefined} alt={appTitle} />
          <AvatarFallback className='text-lg'>{fallbackInitial}</AvatarFallback>
        </Avatar>

        {/* Hover overlay */}
        <div className='absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center'>
          {isUploading ? (
            <Loader2 className='size-5 text-white animate-spin' />
          ) : (
            <Camera className='size-5 text-white' />
          )}
        </div>

        {/* Progress ring */}
        {isUploading && progress > 0 && progress < 100 && (
          <svg className='absolute inset-0 size-16 -rotate-90' viewBox='0 0 64 64'>
            <circle
              cx='32'
              cy='32'
              r='30'
              fill='none'
              stroke='currentColor'
              strokeWidth='3'
              className='text-primary'
              strokeDasharray={`${(progress / 100) * 188.5} 188.5`}
              strokeLinecap='round'
            />
          </svg>
        )}
      </button>

      <div className='flex flex-col gap-0.5'>
        <span className='text-sm font-medium text-foreground'>App icon</span>
        <span className='text-xs text-muted-foreground'>PNG, JPG, WebP, or SVG. Max 2MB.</span>
      </div>

      <input
        ref={inputRef}
        type='file'
        accept={ACCEPTED_TYPES}
        onChange={handleFileSelect}
        className='hidden'
        aria-hidden='true'
      />
    </div>
  )
}
