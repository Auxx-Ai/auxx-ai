// apps/web/src/components/files/utils/file-icon.tsx

import { getIcon } from '@auxx/ui/components/icons'
import { cn } from '@auxx/ui/lib/utils'

/** Return type for getFileIconId */
export interface FileIconInfo {
  /** Icon ID matching EntityIcon iconId (e.g., 'file-image', 'file-text') */
  iconId: string
  /** Color ID matching EntityIcon color (e.g., 'blue', 'purple', 'green') */
  color: string
}

/**
 * Get icon ID and color for a file based on its MIME type or extension
 * Returns values compatible with EntityIcon component
 * @param mimeType File MIME type
 * @param ext File extension
 * @returns Object with iconId and color for use with EntityIcon
 */
export function getFileIconId(mimeType?: string, ext?: string): FileIconInfo {
  // Check MIME type first
  if (mimeType) {
    if (mimeType.startsWith('image/')) {
      return { iconId: 'file-image', color: 'blue' }
    }
    if (mimeType.startsWith('video/')) {
      return { iconId: 'file-video', color: 'purple' }
    }
    if (mimeType.startsWith('audio/')) {
      return { iconId: 'file-audio', color: 'green' }
    }
    if (mimeType.startsWith('text/') || mimeType === 'application/json') {
      return { iconId: 'file-text', color: 'gray' }
    }
    if (mimeType === 'application/pdf') {
      return { iconId: 'file-type', color: 'red' }
    }
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) {
      return { iconId: 'file-spreadsheet', color: 'green' }
    }
    if (
      mimeType.includes('zip') ||
      mimeType.includes('archive') ||
      mimeType.includes('compressed')
    ) {
      return { iconId: 'archive', color: 'orange' }
    }
  }

  // Fallback to extension
  if (ext) {
    const extension = ext.toLowerCase()

    // Images
    if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'ico'].includes(extension)) {
      return { iconId: 'file-image', color: 'blue' }
    }

    // Videos
    if (['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', '3gp'].includes(extension)) {
      return { iconId: 'file-video', color: 'purple' }
    }

    // Audio
    if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a'].includes(extension)) {
      return { iconId: 'file-audio', color: 'green' }
    }

    // Documents
    if (['txt', 'md', 'rtf', 'doc', 'docx', 'odt'].includes(extension)) {
      return { iconId: 'file-text', color: 'gray' }
    }

    // PDFs
    if (extension === 'pdf') {
      return { iconId: 'file-type', color: 'red' }
    }

    // Spreadsheets
    if (['xls', 'xlsx', 'csv', 'ods'].includes(extension)) {
      return { iconId: 'file-spreadsheet', color: 'green' }
    }

    // Code files
    if (
      [
        'js',
        'ts',
        'jsx',
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
      return { iconId: 'file-code', color: 'indigo' }
    }

    // Archives
    if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'].includes(extension)) {
      return { iconId: 'archive', color: 'orange' }
    }
  }

  // Default file icon
  return { iconId: 'file', color: 'gray' }
}

/**
 * Get appropriate icon JSX element for a file based on its MIME type or extension
 * @param mimeType File MIME type
 * @param ext File extension
 * @param className Optional className to apply to the icon
 * @returns JSX element representing the file icon
 */
export function getFileIcon(mimeType?: string, ext?: string, className?: string) {
  const { iconId } = getFileIconId(mimeType, ext)
  const iconData = getIcon(iconId)

  if (!iconData) {
    // Fallback to default file icon
    const defaultIcon = getIcon('file')
    if (!defaultIcon) return null
    const DefaultIcon = defaultIcon.icon
    return <DefaultIcon className={cn('size-3 text-muted-foreground', className)} />
  }

  const Icon = iconData.icon
  return <Icon className={cn('size-3 text-muted-foreground', className)} />
}

type FileIconProps = {
  mimeType?: string
  ext?: string
  className?: string
}
export function FileIcon({ mimeType, ext, className }: FileIconProps) {
  return getFileIcon(mimeType, ext, className)
}
