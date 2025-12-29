// packages/lib/src/files/utils/download-response.ts

/**
 * File download response utilities
 * Shared helpers for creating consistent file download responses across all file types
 */

export interface FileInfo {
  name: string
  mimeType?: string | null
  size?: bigint | number | null
}

export interface RangeRequest {
  start: number
  end?: number
}

export interface FileDownloadResponse {
  buffer: Buffer
  status: number
  headers: Record<string, string>
}

/**
 * Create file download response with proper headers and range support
 */
export function createFileDownloadResponse(
  fileContent: Buffer,
  fileInfo: FileInfo,
  options: {
    range?: RangeRequest
    inline?: boolean
    cacheControl?: string
  } = {}
): FileDownloadResponse {
  const { range, inline = false, cacheControl = 'private, no-cache' } = options
  
  let buffer = fileContent
  let status = 200
  const headers: Record<string, string> = {}

  // Handle range requests for video/audio streaming
  if (range && (fileInfo.mimeType?.startsWith('video/') || fileInfo.mimeType?.startsWith('audio/'))) {
    const start = range.start
    const end = range.end ?? fileContent.length - 1
    
    buffer = fileContent.subarray(start, end + 1)
    status = 206 // Partial Content
    headers['Content-Range'] = `bytes ${start}-${end}/${fileContent.length}`
    headers['Accept-Ranges'] = 'bytes'
  }

  // Set content headers
  headers['Content-Type'] = fileInfo.mimeType || 'application/octet-stream'
  headers['Content-Length'] = buffer.length.toString()
  
  // Set disposition (inline for images/videos, attachment for downloads)
  const disposition = inline ? 'inline' : 'attachment'
  headers['Content-Disposition'] = `${disposition}; filename="${fileInfo.name}"`
  
  // Set cache control
  headers['Cache-Control'] = cacheControl

  // Add security headers
  headers['X-Content-Type-Options'] = 'nosniff'
  headers['X-Frame-Options'] = 'DENY'

  return { buffer, status, headers }
}

/**
 * Parse HTTP range header
 */
export function parseRangeHeader(rangeHeader: string | null): RangeRequest | null {
  if (!rangeHeader) return null
  
  const match = rangeHeader.match(/bytes=(\d+)-(\d*)?/)
  if (!match) return null
  
  const start = parseInt(match[1], 10)
  const end = match[2] ? parseInt(match[2], 10) : undefined
  
  return { start, end }
}

/**
 * Check if request accepts ranges
 */
export function supportsRangeRequests(mimeType?: string | null): boolean {
  if (!mimeType) return false
  return mimeType.startsWith('video/') || mimeType.startsWith('audio/')
}