// apps/web/src/components/file-upload/transport/direct-upload.ts

import type {
  DirectUploadResult,
  PresignedConfig,
  UploadHandle,
  UploadProgressEvent,
} from './types'
import { parseUploadErrorResponse } from './upload-error'

/** Multipart chunk size. Must stay at or above S3's 5MB minimum for non-final parts. */
const CHUNK_SIZE = 10 * 1024 * 1024

/**
 * Write one file's bytes straight to storage with the presigned config the session
 * route handed back. `XMLHttpRequest` rather than `fetch` for one reason: upload
 * progress events, which `fetch` still does not expose.
 *
 * Returns synchronously so the caller can register `abort` before awaiting.
 */
export function directUpload({
  file,
  config,
  onProgress,
}: {
  file: File
  config: PresignedConfig
  onProgress?: (progress: UploadProgressEvent) => void
}): UploadHandle {
  let aborted = false
  let currentAbort: (() => void) | undefined

  const uploadSingle = (): Promise<DirectUploadResult> => {
    return new Promise((resolve, reject) => {
      if (!config.presignedUrl) {
        return reject(new Error('Missing presignedUrl for single upload'))
      }

      const xhr = new XMLHttpRequest()

      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable && onProgress) {
          onProgress({
            loaded: event.loaded,
            total: event.total,
            percentage: Math.round((event.loaded / event.total) * 100),
          })
        }
      })

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const etag = xhr.getResponseHeader('etag')?.replace(/"/g, '')
          resolve({
            etag,
            storageKey:
              config.uploadType === 'POST' && config.presignedFields
                ? config.presignedFields.key
                : undefined,
          })
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`))
        }
      })

      xhr.addEventListener('error', () => reject(new Error('Upload failed')))
      xhr.addEventListener('abort', () => reject(new Error('Upload aborted')))

      if (config.uploadType === 'POST' && config.presignedFields) {
        // POST with form fields (policy-based)
        const formData = new FormData()
        Object.entries(config.presignedFields).forEach(([key, value]) => {
          formData.append(key, value)
        })
        formData.append('file', file)

        xhr.open('POST', config.presignedUrl)
        xhr.send(formData)
      } else {
        // PUT with raw body (default)
        xhr.open('PUT', config.presignedUrl)
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
        xhr.send(file)
      }

      currentAbort = () => xhr.abort()
    })
  }

  const uploadMultipart = async (): Promise<DirectUploadResult> => {
    if (!config.partPresignEndpoint || !config.uploadId) {
      throw new Error('Missing multipart configuration')
    }

    const totalSize = file.size
    const parts: Array<{ partNumber: number; etag: string }> = []
    let uploadedBytes = 0

    for (let start = 0, partNumber = 1; start < totalSize; start += CHUNK_SIZE, partNumber++) {
      if (aborted) throw new Error('Upload aborted')

      const end = Math.min(start + CHUNK_SIZE, totalSize)
      const chunk = file.slice(start, end)

      // Presign this part. A failure here leaves the session alive on the server
      // (PR 4e): part presigning mutates nothing, so it is safe to retry.
      const partResponse = await fetch(config.partPresignEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partNumber, size: chunk.size }),
      })

      if (!partResponse.ok) {
        throw await parseUploadErrorResponse(
          partResponse,
          `Failed to get presigned URL for part ${partNumber}`
        )
      }

      // The part presign happens between chunks, where no XHR is live and
      // `currentAbort` therefore does nothing. `abort()` sets the flag itself so a
      // cancel landing in this window is still honoured on the next iteration.
      if (aborted) throw new Error('Upload aborted')

      const { presignedUrl } = (await partResponse.json()) as { presignedUrl: string }

      const etag = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        const partProgressBase = uploadedBytes

        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable && onProgress) {
            const totalLoaded = partProgressBase + event.loaded
            onProgress({
              loaded: totalLoaded,
              total: totalSize,
              percentage: Math.round((totalLoaded / totalSize) * 100),
            })
          }
        })

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(xhr.getResponseHeader('etag')?.replace(/"/g, '') || '')
          } else {
            reject(new Error(`Part upload failed with status ${xhr.status}`))
          }
        })

        xhr.addEventListener('error', () => reject(new Error('Part upload failed')))
        xhr.addEventListener('abort', () => reject(new Error('Upload aborted')))

        xhr.open('PUT', presignedUrl)
        xhr.send(chunk)

        currentAbort = () => xhr.abort()
      })

      parts.push({ partNumber, etag })
      uploadedBytes = end
    }

    return {
      uploadId: config.uploadId,
      parts: parts.sort((a, b) => a.partNumber - b.partNumber),
    }
  }

  const promise = config.uploadMethod === 'single' ? uploadSingle() : uploadMultipart()

  return {
    abort: () => {
      // The flag is set here, not inside `currentAbort`. Setting it there meant an
      // abort arriving while a part was being presigned — when no XHR is live and
      // `currentAbort` is stale or unset — was silently dropped and the remaining
      // parts uploaded anyway.
      aborted = true
      currentAbort?.()
    },
    promise,
  }
}
