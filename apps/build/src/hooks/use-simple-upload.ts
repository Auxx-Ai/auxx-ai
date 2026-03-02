// apps/build/src/hooks/use-simple-upload.ts

'use client'

import { useCallback, useRef, useState } from 'react'

interface PresignResponse {
  presignedUrl: string
  fields?: Record<string, string>
  method: 'POST' | 'PUT'
  headers?: Record<string, string>
  storageKey: string
  cdnUrl: string
}

interface UploadResult {
  storageKey: string
  cdnUrl: string
}

interface UploadOptions {
  type?: 'icon' | 'screenshot'
}

interface UseSimpleUploadReturn {
  upload: (file: File, appId: string, options?: UploadOptions) => Promise<UploadResult>
  isUploading: boolean
  progress: number
  error: string | null
  abort: () => void
}

/**
 * Lightweight hook for direct-to-S3 uploads via presigned URLs.
 * No Zustand, no SSE — just React state + XMLHttpRequest for progress.
 */
export function useSimpleUpload(): UseSimpleUploadReturn {
  const [isUploading, setIsUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const xhrRef = useRef<XMLHttpRequest | null>(null)

  const abort = useCallback(() => {
    xhrRef.current?.abort()
    xhrRef.current = null
    setIsUploading(false)
    setProgress(0)
  }, [])

  const upload = useCallback(
    async (file: File, appId: string, options?: UploadOptions): Promise<UploadResult> => {
      setIsUploading(true)
      setProgress(0)
      setError(null)

      try {
        // Step 1: Get presigned URL
        const presignRes = await fetch('/api/upload/presign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appId,
            fileName: file.name,
            mimeType: file.type,
            size: file.size,
            type: options?.type,
          }),
        })

        if (!presignRes.ok) {
          const data = await presignRes.json()
          throw new Error(data.error || 'Failed to get upload URL')
        }

        const presign: PresignResponse = await presignRes.json()

        // Step 2: Upload directly to S3
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhrRef.current = xhr

          xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
              setProgress(Math.round((e.loaded / e.total) * 100))
            }
          })

          xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve()
            } else {
              reject(new Error(`Upload failed with status ${xhr.status}`))
            }
          })

          xhr.addEventListener('error', () => reject(new Error('Upload failed')))
          xhr.addEventListener('abort', () => reject(new Error('Upload aborted')))

          if (presign.fields) {
            // POST with form data (presigned POST)
            xhr.open('POST', presign.presignedUrl)
            const formData = new FormData()
            for (const [key, value] of Object.entries(presign.fields)) {
              formData.append(key, value)
            }
            formData.append('file', file)
            xhr.send(formData)
          } else {
            // PUT with raw file (presigned PUT)
            xhr.open('PUT', presign.presignedUrl)
            if (presign.headers) {
              for (const [key, value] of Object.entries(presign.headers)) {
                xhr.setRequestHeader(key, value)
              }
            }
            xhr.send(file)
          }
        })

        setProgress(100)
        return { storageKey: presign.storageKey, cdnUrl: presign.cdnUrl }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed'
        setError(message)
        throw err
      } finally {
        xhrRef.current = null
        setIsUploading(false)
      }
    },
    []
  )

  return { upload, isUploading, progress, error, abort }
}
