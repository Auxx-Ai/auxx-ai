// packages/lib/src/files/utils/download-response.ts

/**
 * File download response utilities
 * Shared helpers for creating consistent file download responses across all file types
 */

import { encodeRFC5987ValueChars } from '@auxx/utils'

export interface FileInfo {
  name: string
  mimeType?: string | null
  size?: number | null
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
 * Build an RFC 6266 `Content-Disposition` value that survives any filename.
 *
 * HTTP header values are ByteStrings: a single code point above U+00FF makes
 * `new Response(..., { headers })` throw `TypeError: Cannot convert argument to a
 * ByteString`, which the route's catch turns into a bare 500. Interpolating the raw
 * name meant EVERY macOS screenshot was undownloadable — since macOS 13 those names
 * carry U+202F NARROW NO-BREAK SPACE before AM/PM — along with anything containing
 * emoji, CJK, curly quotes, or accents outside Latin-1.
 *
 * So: a sanitized ASCII `filename` for old clients, plus the real name in
 * `filename*` as UTF-8 percent-encoding, which every current browser prefers.
 * Quotes and backslashes are stripped from the fallback rather than escaped — they
 * are what lets a crafted name break out of the quoted-string and inject a header
 * parameter. The `filename*` half goes through {@link encodeRFC5987ValueChars},
 * not bare `encodeURIComponent` — RFC 5987 attr-char excludes `!'()*`, and `'`
 * is the ext-value delimiter itself.
 */
export function encodeContentDisposition(disposition: string, name: string): string {
  const asciiFallback =
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping controls is the point
    name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '') || 'download'
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodeRFC5987ValueChars(name)}`
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

  // Advertise range support for streamable media on EVERY response, not only the
  // 206 — a player probes with a plain GET or HEAD first, and an answer without
  // `Accept-Ranges` tells it seeking is unavailable.
  if (supportsRangeRequests(fileInfo.mimeType)) {
    headers['Accept-Ranges'] = 'bytes'
  }

  // Handle range requests for video/audio streaming
  if (range && supportsRangeRequests(fileInfo.mimeType)) {
    const start = range.start
    const end = range.end ?? fileContent.length - 1

    buffer = fileContent.subarray(start, end + 1)
    status = 206 // Partial Content
    headers['Content-Range'] = `bytes ${start}-${end}/${fileContent.length}`
  }

  // Set content headers
  headers['Content-Type'] = fileInfo.mimeType || 'application/octet-stream'
  headers['Content-Length'] = buffer.length.toString()

  // Set disposition (inline for images/videos, attachment for downloads)
  const disposition = inline ? 'inline' : 'attachment'
  headers['Content-Disposition'] = encodeContentDisposition(disposition, fileInfo.name)

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
  if (!match?.[1]) return null

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
