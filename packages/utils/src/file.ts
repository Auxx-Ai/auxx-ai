/**
 * Formats a byte value into a human-readable string with appropriate units
 * @param bytes - The number of bytes to format (supports both number and bigint)
 * @param decimals - Number of decimal places to include (default: 2)
 * @returns A formatted string with appropriate unit suffix
 */
export function formatBytes(bytes: number | bigint, decimals: number = 2): string {
  // Handle null, undefined, or invalid values
  if (bytes == null || (typeof bytes !== 'number' && typeof bytes !== 'bigint')) {
    return '0 B'
  }

  // Convert bigint to number for calculations
  const numBytes = typeof bytes === 'bigint' ? Number(bytes) : bytes

  // Handle NaN, negative numbers, or zero
  if (Number.isNaN(numBytes) || numBytes < 0) return '0 B'
  if (numBytes === 0) return '0 B'

  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

  // Calculate the appropriate size unit
  const i = Math.floor(Math.log(numBytes) / Math.log(k))

  // Clamp the index to valid array bounds
  const safeIndex = Math.max(0, Math.min(i, sizes.length - 1))

  // Format the number with the specified decimals
  return parseFloat((numBytes / k ** safeIndex).toFixed(decimals)) + ' ' + sizes[safeIndex]
}

/**
 * Get file extension from filename
 */
export function getFileExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() || ''
}

/**
 * Extract directory path from a full file path (excluding the filename)
 * @param filePath - The full file path including filename
 * @returns The directory path without the filename, or '/' if at root
 */
export function getDirectoryPath(filePath: string): string {
  if (!filePath || filePath === '/') {
    return '/'
  }

  const lastSlashIndex = filePath.lastIndexOf('/')
  if (lastSlashIndex === -1) {
    return '/'
  }

  const directoryPath = filePath.substring(0, lastSlashIndex)
  return directoryPath || '/'
}

/**
 * Check if a file is an image based on its MIME type
 * @param mimeType - The MIME type to check
 * @returns True if the MIME type represents an image
 */
export function isImageFile(mimeType?: string | null): boolean {
  if (!mimeType) return false
  return mimeType.startsWith('image/')
}

/**
 * Check if an image file can be safely previewed in the browser
 * @param mimeType - The MIME type to check
 * @returns True if the image can be safely previewed (excludes SVG for security)
 */
export function isPreviewableImage(mimeType?: string | null): boolean {
  if (!mimeType) return false
  // Exclude SVG for security reasons - can contain scripts
  const previewable = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
  return previewable.includes(mimeType.toLowerCase())
}

/**
 * Sanitize filename for safe storage
 * Removes invalid characters and enforces length limits
 */
export function sanitizeFilename(
  filename: string,
  options?: {
    maxLength?: number
    replacementChar?: string
    preserveExtension?: boolean
  }
): string {
  const opts = {
    maxLength: 255,
    replacementChar: '_',
    preserveExtension: true,
    ...options,
  }

  // Remove line breaks
  let safe = filename.replace(/[\r\n]/g, '')

  // Replace Windows-incompatible and potentially dangerous characters
  safe = safe.replace(/[<>:"/\\|?*\0]/g, opts.replacementChar)

  // Replace control characters
  safe = safe.replace(/[\x00-\x1f\x80-\x9f]/g, opts.replacementChar)

  // Trim whitespace
  safe = safe.trim()

  // Handle length limits
  if (safe.length > opts.maxLength) {
    if (opts.preserveExtension) {
      const ext = safe.lastIndexOf('.')
      if (ext > 0) {
        const name = safe.substring(0, ext)
        const extension = safe.substring(ext)
        // Ensure we have space for at least 1 character + extension
        const maxNameLength = opts.maxLength - extension.length
        safe = name.substring(0, Math.max(1, maxNameLength)) + extension
      } else {
        safe = safe.substring(0, opts.maxLength)
      }
    } else {
      safe = safe.substring(0, opts.maxLength)
    }
  }

  // Ensure filename is not empty
  if (!safe) {
    safe = 'unnamed'
  }

  return safe
}

/**
 * Calculate base64 encoded size
 * Returns size after base64 encoding with overhead
 */
export function calculateBase64Size(bytes: number): number {
  // Base64 encoding increases size by approximately 4/3
  // Every 3 bytes becomes 4 characters
  return Math.ceil((bytes * 4) / 3)
}

/**
 * Validate attachment size limits
 * Checks individual and total size constraints
 */
export function validateAttachmentSizes(
  attachments: Array<{ size: number; filename: string }>,
  limits: {
    maxSingleSize: number
    maxTotalSize: number
    encodingOverhead?: number
  }
): {
  valid: boolean
  errors: Array<{ filename: string; reason: string }>
} {
  const errors: Array<{ filename: string; reason: string }> = []
  const overhead = limits.encodingOverhead || 1.33 // Default base64 overhead

  let totalSize = 0

  for (const attachment of attachments) {
    const encodedSize = attachment.size * overhead

    if (encodedSize > limits.maxSingleSize) {
      errors.push({
        filename: attachment.filename,
        reason: `File size (${formatBytes(encodedSize)}) exceeds maximum allowed size (${formatBytes(limits.maxSingleSize)})`,
      })
    }

    totalSize += encodedSize
  }

  if (totalSize > limits.maxTotalSize) {
    errors.push({
      filename: 'Total attachments',
      reason: `Total size (${formatBytes(totalSize)}) exceeds maximum allowed size (${formatBytes(limits.maxTotalSize)})`,
    })
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Get MIME type from file extension
 * Returns appropriate content-type for file (default: application/octet-stream)
 */
export function getMimeTypeFromExtension(filename: string): string {
  const ext = getFileExtension(filename)

  const mimeTypes: Record<string, string> = {
    // Images
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',

    // Documents
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    odt: 'application/vnd.oasis.opendocument.text',
    ods: 'application/vnd.oasis.opendocument.spreadsheet',

    // Text
    txt: 'text/plain',
    csv: 'text/csv',
    html: 'text/html',
    htm: 'text/html',
    xml: 'text/xml',
    json: 'application/json',
    md: 'text/markdown',

    // Archives
    zip: 'application/zip',
    rar: 'application/x-rar-compressed',
    '7z': 'application/x-7z-compressed',
    tar: 'application/x-tar',
    gz: 'application/gzip',

    // Media
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    mp4: 'video/mp4',
    avi: 'video/x-msvideo',
    mov: 'video/quicktime',

    // Code
    js: 'application/javascript',
    css: 'text/css',
    ts: 'application/typescript',
    py: 'text/x-python',
    java: 'text/x-java-source',
    c: 'text/x-c',
    cpp: 'text/x-c++',
    h: 'text/x-c',
    sh: 'application/x-sh',
  }

  return mimeTypes[ext] || 'application/octet-stream'
}

/**
 * Get attachment byte size for provider limits
 * Calculates size for attachment validation
 */
export function getAttachmentByteSize(attachment: {
  content?: Buffer | string
  size?: number
}): number {
  if (attachment.size !== undefined) {
    return attachment.size
  }

  if (attachment.content) {
    if (Buffer.isBuffer(attachment.content)) {
      return attachment.content.length
    }
    return Buffer.from(attachment.content).length
  }

  return 0
}

/**
 * Extract filename from full path
 * Returns just the filename without directory path
 */
export function getFilenameFromPath(filePath: string): string {
  if (!filePath) return ''

  // Handle both forward and backslashes
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))

  if (lastSlash === -1) {
    return filePath
  }

  return filePath.substring(lastSlash + 1)
}

/**
 * Check whether a MIME type can be previewed inline in the browser.
 * Returns false for types that would trigger a download (e.g. .docx, .xlsx, .pptx).
 */
export function canPreviewInline(mimeType: string | null | undefined): boolean {
  if (!mimeType) return false
  if (mimeType.startsWith('image/')) return true
  if (mimeType.startsWith('video/')) return true
  if (mimeType.startsWith('audio/')) return true
  if (mimeType === 'application/pdf') return true
  if (mimeType.startsWith('text/') && mimeType !== 'text/csv') return true
  if (mimeType === 'application/json') return true
  if (mimeType === 'application/xml' || mimeType === 'text/xml') return true
  return false
}

/**
 * Get standardized file type category for display
 * @param mimeType File MIME type
 * @param ext File extension
 * @returns Standardized file type string
 */
export function getStandardFileType(mimeType?: string, ext?: string): string {
  // Check MIME type first
  if (mimeType) {
    if (mimeType.startsWith('image/')) {
      return 'Image'
    }
    if (mimeType.startsWith('video/')) {
      return 'Video'
    }
    if (mimeType.startsWith('audio/')) {
      return 'Audio'
    }
    if (mimeType.startsWith('text/')) {
      return 'Text'
    }
    if (mimeType === 'application/pdf') {
      return 'PDF'
    }
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) {
      return 'Spreadsheet'
    }
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) {
      return 'Presentation'
    }
    if (mimeType.includes('document') || mimeType.includes('word')) {
      return 'Document'
    }
    if (
      mimeType.includes('zip') ||
      mimeType.includes('archive') ||
      mimeType.includes('compressed')
    ) {
      return 'Archive'
    }
    if (mimeType === 'application/json') {
      return 'JSON'
    }
    if (mimeType === 'application/xml' || mimeType === 'text/xml') {
      return 'XML'
    }
  }

  // Fallback to extension
  if (ext) {
    const extension = ext.toLowerCase()

    // Images
    if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'ico', 'tiff'].includes(extension)) {
      return 'Image'
    }

    // Videos
    if (['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', '3gp', 'm4v'].includes(extension)) {
      return 'Video'
    }

    // Audio
    if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'opus'].includes(extension)) {
      return 'Audio'
    }

    // Documents
    if (['txt', 'md', 'rtf'].includes(extension)) {
      return 'Text'
    }
    if (['doc', 'docx', 'odt'].includes(extension)) {
      return 'Document'
    }

    // PDFs
    if (extension === 'pdf') {
      return 'PDF'
    }

    // Spreadsheets
    if (['xls', 'xlsx', 'ods'].includes(extension)) {
      return 'Spreadsheet'
    }
    if (extension === 'csv') {
      return 'CSV'
    }

    // Presentations
    if (['ppt', 'pptx', 'odp'].includes(extension)) {
      return 'Presentation'
    }

    // Code files
    if (['js', 'jsx'].includes(extension)) {
      return 'JavaScript'
    }
    if (['ts', 'tsx'].includes(extension)) {
      return 'TypeScript'
    }
    if (['html', 'htm'].includes(extension)) {
      return 'HTML'
    }
    if (['css', 'scss', 'sass', 'less'].includes(extension)) {
      return 'Stylesheet'
    }
    if (extension === 'json') {
      return 'JSON'
    }
    if (['xml', 'xsl'].includes(extension)) {
      return 'XML'
    }
    if (extension === 'py') {
      return 'Python'
    }
    if (['java', 'class', 'jar'].includes(extension)) {
      return 'Java'
    }
    if (['cpp', 'cxx', 'cc'].includes(extension)) {
      return 'C++'
    }
    if (extension === 'c') {
      return 'C'
    }
    if (extension === 'php') {
      return 'PHP'
    }
    if (extension === 'rb') {
      return 'Ruby'
    }
    if (extension === 'go') {
      return 'Go'
    }
    if (extension === 'rs') {
      return 'Rust'
    }
    if (extension === 'swift') {
      return 'Swift'
    }
    if (['kt', 'kts'].includes(extension)) {
      return 'Kotlin'
    }
    if (['sh', 'bash', 'zsh', 'fish'].includes(extension)) {
      return 'Shell Script'
    }

    // Archives
    if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'lz', 'lzma'].includes(extension)) {
      return 'Archive'
    }

    // Fonts
    if (['ttf', 'otf', 'woff', 'woff2', 'eot'].includes(extension)) {
      return 'Font'
    }

    // Executables
    if (['exe', 'msi', 'deb', 'rpm', 'dmg', 'pkg', 'app'].includes(extension)) {
      return 'Executable'
    }

    // Data files
    if (['sql', 'db', 'sqlite', 'sqlite3'].includes(extension)) {
      return 'Database'
    }
  }

  // Return the extension as-is if we can't categorize it
  return ext ? ext.toUpperCase() : 'File'
}

/**
 * Get file category for filtering purposes
 * @param mimeType File MIME type
 * @param ext File extension
 * @returns File category string
 */
export function getFileCategory(mimeType?: string, ext?: string): string {
  if (mimeType) {
    if (mimeType.startsWith('image/')) return 'images'
    if (mimeType.startsWith('video/')) return 'videos'
    if (mimeType.startsWith('audio/')) return 'audio'
    if (
      mimeType.startsWith('text/') ||
      mimeType.includes('document') ||
      mimeType.includes('word') ||
      mimeType === 'application/pdf'
    )
      return 'documents'
    if (mimeType.includes('zip') || mimeType.includes('archive') || mimeType.includes('compressed'))
      return 'archives'
  }

  if (ext) {
    const extension = ext.toLowerCase()

    if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'ico', 'tiff'].includes(extension)) {
      return 'images'
    }
    if (['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', '3gp', 'm4v'].includes(extension)) {
      return 'videos'
    }
    if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'opus'].includes(extension)) {
      return 'audio'
    }
    if (
      [
        'txt',
        'md',
        'rtf',
        'doc',
        'docx',
        'odt',
        'pdf',
        'xls',
        'xlsx',
        'csv',
        'ppt',
        'pptx',
      ].includes(extension)
    ) {
      return 'documents'
    }
    if (
      [
        'js',
        'jsx',
        'ts',
        'tsx',
        'html',
        'css',
        'scss',
        'json',
        'xml',
        'py',
        'java',
        'cpp',
        'c',
        'php',
        'rb',
        'go',
        'rs',
        'swift',
        'kotlin',
      ].includes(extension)
    ) {
      return 'code'
    }
    if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'].includes(extension)) {
      return 'archives'
    }
  }

  return 'other'
}
