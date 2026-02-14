// apps/web/src/components/file-upload/utils/direct-upload.ts

interface DirectUploadConfig {
  uploadMethod: 'single' | 'multipart'
  uploadType?: 'PUT' | 'POST'
  presignedUrl?: string
  presignedFields?: Record<string, string>
  uploadId?: string
  partPresignEndpoint?: string
  storageKey: string
}

interface DirectUploadResult {
  etag?: string
  uploadId?: string
  parts?: Array<{ partNumber: number; etag: string }>
  storageKey?: string
}

interface ProgressEvent {
  loaded: number
  total: number
  percentage: number
}

/**
 * Direct upload to storage using presigned URLs
 * Supports both single and multipart uploads
 */
export function directUpload({
  file,
  config,
  onProgress,
}: {
  file: File
  config: DirectUploadConfig
  onProgress?: (progress: ProgressEvent) => void
}): { abort: () => void; promise: Promise<DirectUploadResult> } {
  let aborted = false
  let currentAbort: (() => void) | undefined

  const uploadSingle = (): Promise<DirectUploadResult> => {
    return new Promise((resolve, reject) => {
      if (!config.presignedUrl) {
        return reject(new Error('Missing presignedUrl for single upload'))
      }

      const xhr = new XMLHttpRequest()

      // Progress tracking
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable && onProgress) {
          onProgress({
            loaded: event.loaded,
            total: event.total,
            percentage: Math.round((event.loaded / event.total) * 100),
          })
        }
      })

      // Success handling
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

      // Error handling
      xhr.addEventListener('error', () => reject(new Error('Upload failed')))
      xhr.addEventListener('abort', () => reject(new Error('Upload aborted')))

      // Configure request based on upload type
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

      // Set up abort function
      currentAbort = () => {
        aborted = true
        xhr.abort()
      }
    })
  }

  const uploadMultipart = async (): Promise<DirectUploadResult> => {
    if (!config.partPresignEndpoint || !config.uploadId) {
      throw new Error('Missing multipart configuration')
    }

    const chunkSize = 10 * 1024 * 1024 // 10MB chunks
    const totalSize = file.size
    const parts: Array<{ partNumber: number; etag: string }> = []
    let uploadedBytes = 0

    for (let start = 0, partNumber = 1; start < totalSize; start += chunkSize, partNumber++) {
      if (aborted) throw new Error('Upload aborted')

      const end = Math.min(start + chunkSize, totalSize)
      const chunk = file.slice(start, end)

      // Get presigned URL for this part
      const partResponse = await fetch(config.partPresignEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partNumber, size: chunk.size }),
      })

      if (!partResponse.ok) {
        throw new Error(`Failed to get presigned URL for part ${partNumber}`)
      }

      const { presignedUrl } = await partResponse.json()

      // Upload the part
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
            const etag = xhr.getResponseHeader('etag')?.replace(/"/g, '') || ''
            resolve(etag)
          } else {
            reject(new Error(`Part upload failed with status ${xhr.status}`))
          }
        })

        xhr.addEventListener('error', () => reject(new Error('Part upload failed')))
        xhr.addEventListener('abort', () => reject(new Error('Upload aborted')))

        xhr.open('PUT', presignedUrl)
        xhr.send(chunk)

        // Update current abort function for this part
        currentAbort = () => {
          aborted = true
          xhr.abort()
        }
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
    abort: () => currentAbort?.(),
    promise,
  }
}
