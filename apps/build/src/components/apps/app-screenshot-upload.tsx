// apps/build/src/components/apps/app-screenshot-upload.tsx

'use client'

import { Loader2, Plus, X } from 'lucide-react'
import { useCallback, useRef } from 'react'
import { toastError } from '~/components/global/toast'
import { useSimpleUpload } from '~/hooks/use-simple-upload'
import { api } from '~/trpc/react'

const ACCEPTED_TYPES = 'image/png,image/jpeg,image/webp'
const MAX_SLOTS = 3

interface AppScreenshotUploadProps {
  appId: string
  appSlug: string
  currentScreenshots: string[]
}

/**
 * App screenshot upload component with 3 slots for marketplace listing images.
 * Each slot uploads independently and saves immediately via mutation.
 */
export function AppScreenshotUpload({
  appId,
  appSlug,
  currentScreenshots,
}: AppScreenshotUploadProps) {
  const utils = api.useUtils()
  const { upload, isUploading, progress } = useSimpleUpload()
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])
  const uploadingSlotRef = useRef<number | null>(null)

  const updateApp = api.apps.update.useMutation({
    onSuccess: () => {
      utils.apps.get.invalidate({ slug: appSlug })
    },
  })

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>, slotIndex: number) => {
      const file = e.target.files?.[0]
      if (!file) return

      e.target.value = ''
      uploadingSlotRef.current = slotIndex

      try {
        const result = await upload(file, appId, { type: 'screenshot' })

        const newScreenshots = [...currentScreenshots]
        if (slotIndex < newScreenshots.length) {
          newScreenshots[slotIndex] = result.cdnUrl
        } else {
          newScreenshots.push(result.cdnUrl)
        }

        await updateApp.mutateAsync({
          id: appId,
          screenshots: newScreenshots,
        })
      } catch (err) {
        toastError({
          title: 'Upload failed',
          description: err instanceof Error ? err.message : 'Failed to upload screenshot',
        })
      } finally {
        uploadingSlotRef.current = null
      }
    },
    [appId, upload, updateApp, currentScreenshots]
  )

  const handleRemove = useCallback(
    async (slotIndex: number) => {
      const newScreenshots = currentScreenshots.filter((_, i) => i !== slotIndex)

      try {
        await updateApp.mutateAsync({
          id: appId,
          screenshots: newScreenshots,
        })
      } catch (err) {
        toastError({
          title: 'Failed to remove screenshot',
          description: err instanceof Error ? err.message : 'Something went wrong',
        })
      }
    },
    [appId, updateApp, currentScreenshots]
  )

  return (
    <div className='grid grid-cols-3 gap-3'>
      {Array.from({ length: MAX_SLOTS }, (_, index) => {
        const url = currentScreenshots[index]
        const isSlotUploading = isUploading && uploadingSlotRef.current === index

        return (
          <div key={index} className='relative'>
            {url && !isSlotUploading ? (
              // Filled slot
              <div className='group relative h-[200px] rounded-2xl overflow-hidden border bg-muted'>
                <img src={url} alt={`Screenshot ${index + 1}`} className='size-full object-cover' />
                <button
                  type='button'
                  onClick={() => handleRemove(index)}
                  disabled={updateApp.isPending}
                  className='absolute top-2 right-2 size-7 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-black/80'
                  aria-label={`Remove screenshot ${index + 1}`}>
                  <X className='size-4' />
                </button>
              </div>
            ) : (
              // Empty or uploading slot
              <button
                type='button'
                onClick={() => inputRefs.current[index]?.click()}
                disabled={isUploading || updateApp.isPending}
                className='flex h-[200px] w-full items-center justify-center rounded-2xl border border-dashed bg-muted hover:bg-muted/80 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50'
                aria-label={`Upload screenshot ${index + 1}`}>
                {isSlotUploading ? (
                  <div className='flex flex-col items-center gap-2'>
                    <Loader2 className='size-6 text-muted-foreground animate-spin' />
                    <span className='text-xs text-muted-foreground'>{progress}%</span>
                  </div>
                ) : (
                  <Plus className='size-6 text-muted-foreground' />
                )}
              </button>
            )}

            <input
              ref={(el) => {
                inputRefs.current[index] = el
              }}
              type='file'
              accept={ACCEPTED_TYPES}
              onChange={(e) => handleFileSelect(e, index)}
              className='hidden'
              aria-hidden='true'
            />
          </div>
        )
      })}
    </div>
  )
}
