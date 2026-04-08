// packages/types/file-ref/index.ts

/**
 * Branded string type for file references.
 * Format: `${sourceType}:${id}` where sourceType is 'asset' or 'file'
 *
 * Example: "asset:abc123" or "file:xyz456"
 */
export type FileRef = string & { readonly __brand: 'FileRef' }

/** Valid source types for file references */
export type FileRefSourceType = 'asset' | 'file'

/**
 * Create a FileRef from source type and id.
 */
export function toFileRef(sourceType: FileRefSourceType, id: string): FileRef {
  return `${sourceType}:${id}` as FileRef
}

/**
 * Parse a FileRef back to its components.
 */
export function parseFileRef(ref: FileRef): {
  sourceType: FileRefSourceType
  id: string
} {
  if (!ref) {
    console.error('[parseFileRef] FileRef is undefined or null:', ref)
    return { sourceType: 'file', id: '' }
  }

  const colonIndex = ref.indexOf(':')
  if (colonIndex === -1) {
    console.error('[parseFileRef] Malformed FileRef (missing colon):', ref)
    return { sourceType: 'file', id: ref }
  }

  return {
    sourceType: ref.slice(0, colonIndex) as FileRefSourceType,
    id: ref.slice(colonIndex + 1),
  }
}

/**
 * Type guard to check if a string is a valid FileRef format.
 */
export function isFileRef(value: unknown): value is FileRef {
  if (typeof value !== 'string') return false
  const colonIndex = value.indexOf(':')
  if (colonIndex === -1) return false
  const sourceType = value.slice(0, colonIndex)
  return sourceType === 'asset' || sourceType === 'file'
}

/**
 * Get the download URL for a FileRef.
 * Uses the unified /api/files/download/[fileId] route which accepts both plain IDs and FileRefs.
 */
export function getFileRefDownloadUrl(ref: FileRef): string {
  return `/api/files/download/${ref}`
}
