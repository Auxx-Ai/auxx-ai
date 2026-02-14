// packages/lib/src/workflow-engine/types/file-variable.ts
import { formatBytes } from '@auxx/utils/file'

// Define these types locally for now since the paths don't exist in the lib package
interface UnifiedVariable {
  id: string
  nodeId: string
  path: string
  fullPath: string
  label: string
  description: string
  type: string
  category: string
  properties?: any
  items?: any
  example?: any
}

enum BaseType {
  FILE = 'file',
  ARRAY = 'array',
  STRING = 'string',
  NUMBER = 'number',
  DATETIME = 'datetime',
  URL = 'url',
}

export interface WorkflowFileData {
  id: string // Unique ID within workflow context
  fileId: string // Legacy: File ID (use assetId for new code)
  assetId: string // MediaAsset ID (for version locking)
  versionId: string // MediaAssetVersion ID (locked at upload time)
  filename: string
  mimeType: string
  size: number
  url: string
  nodeId: string
  uploadedAt: Date
  expiresAt?: Date
}

/**
 * Create a structured file variable with navigable properties
 */
export function createFileVariable(
  nodeId: string,
  path: string,
  fileData: WorkflowFileData
): UnifiedVariable {
  const baseId = `${nodeId}.${path}`

  const properties = {
    filename: {
      id: `${baseId}.filename`,
      nodeId,
      path: 'filename',
      fullPath: `${baseId}.filename`,
      label: 'filename',
      description: 'Name of the file',
      type: BaseType.STRING,
      category: 'node',
    },
    size: {
      id: `${baseId}.size`,
      nodeId,
      path: 'size',
      fullPath: `${baseId}.size`,
      label: 'size',
      description: 'File size in bytes',
      type: BaseType.NUMBER,
      category: 'node',
    },
    mimeType: {
      id: `${baseId}.mimeType`,
      nodeId,
      path: 'mimeType',
      fullPath: `${baseId}.mimeType`,
      label: 'mimeType',
      description: 'MIME type of the file',
      type: BaseType.STRING,
      category: 'node',
    },
    uploadedAt: {
      id: `${baseId}.uploadedAt`,
      nodeId,
      path: 'uploadedAt',
      fullPath: `${baseId}.uploadedAt`,
      label: 'uploadedAt',
      description: 'When the file was uploaded',
      type: BaseType.DATETIME,
      category: 'node',
    },
    expiresAt: {
      id: `${baseId}.expiresAt`,
      nodeId,
      path: 'expiresAt',
      fullPath: `${baseId}.expiresAt`,
      label: 'expiresAt',
      description: 'When the file expires (if applicable)',
      type: BaseType.DATETIME,
      category: 'node',
    },
    url: {
      id: `${baseId}.url`,
      nodeId,
      path: 'url',
      fullPath: `${baseId}.url`,
      label: 'url',
      description: 'Download URL for the file',
      type: BaseType.URL,
      category: 'node',
    },
  }

  // Generate children array from properties for variable picker navigation
  const children = Object.entries(properties).map(([key, prop]) => ({
    ...prop,
    path: key,
    fullPath: `${baseId}.${key}`,
    id: `${baseId}.${key}`,
  }))

  return {
    id: baseId,
    nodeId,
    path,
    fullPath: baseId,
    label: fileData.filename,
    description: `File: ${fileData.filename} (${formatBytes(fileData.size)})`,
    type: BaseType.FILE,
    category: 'node',

    // Create navigable properties for the file
    properties,

    // Generate children array for variable picker navigation
    children,

    // Store the raw file data for backend access
    example: fileData,
  }
}

/**
 * Create multiple files variable with structured array items
 */
export function createMultipleFilesVariable(
  nodeId: string,
  path: string,
  filesData: WorkflowFileData[]
): UnifiedVariable {
  const totalSize = filesData.reduce((sum, file) => sum + file.size, 0)
  const baseId = `${nodeId}.${path}`

  const itemProperties = {
    filename: {
      id: `${baseId}[*].filename`,
      nodeId,
      path: 'filename',
      fullPath: `${baseId}[*].filename`,
      label: 'filename',
      description: 'Name of the file',
      type: BaseType.STRING,
      category: 'node',
    },
    size: {
      id: `${baseId}[*].size`,
      nodeId,
      path: 'size',
      fullPath: `${baseId}[*].size`,
      label: 'size',
      description: 'File size in bytes',
      type: BaseType.NUMBER,
      category: 'node',
    },
    mimeType: {
      id: `${baseId}[*].mimeType`,
      nodeId,
      path: 'mimeType',
      fullPath: `${baseId}[*].mimeType`,
      label: 'mimeType',
      description: 'MIME type of the file',
      type: BaseType.STRING,
      category: 'node',
    },
    uploadedAt: {
      id: `${baseId}[*].uploadedAt`,
      nodeId,
      path: 'uploadedAt',
      fullPath: `${baseId}[*].uploadedAt`,
      label: 'uploadedAt',
      description: 'When the file was uploaded',
      type: BaseType.DATETIME,
      category: 'node',
    },
    expiresAt: {
      id: `${baseId}[*].expiresAt`,
      nodeId,
      path: 'expiresAt',
      fullPath: `${baseId}[*].expiresAt`,
      label: 'expiresAt',
      description: 'When the file expires (if applicable)',
      type: BaseType.DATETIME,
      category: 'node',
    },
    url: {
      id: `${baseId}[*].url`,
      nodeId,
      path: 'url',
      fullPath: `${baseId}[*].url`,
      label: 'url',
      description: 'Download URL for the file',
      type: BaseType.URL,
      category: 'node',
    },
  }

  const arrayProperties = {
    count: {
      id: `${baseId}.count`,
      nodeId,
      path: 'count',
      fullPath: `${baseId}.count`,
      label: 'count',
      description: 'Number of files',
      type: BaseType.NUMBER,
      category: 'node',
    },
    totalSize: {
      id: `${baseId}.totalSize`,
      nodeId,
      path: 'totalSize',
      fullPath: `${baseId}.totalSize`,
      label: 'totalSize',
      description: 'Total size of all files in bytes',
      type: BaseType.NUMBER,
      category: 'node',
    },
  }

  // Generate item children
  const itemChildren = Object.entries(itemProperties).map(([key, prop]) => ({
    ...prop,
    path: key,
    fullPath: `${baseId}[*].${key}`,
    id: `${baseId}[*].${key}`,
  }))

  // Generate array-level children (summary properties + item access)
  const arrayChildren = [
    ...Object.entries(arrayProperties).map(([key, prop]) => ({
      ...prop,
      path: key,
      fullPath: `${baseId}.${key}`,
      id: `${baseId}.${key}`,
    })),
    {
      id: `${baseId}[*]`,
      nodeId,
      path: '[*]',
      fullPath: `${baseId}[*]`,
      label: 'File Item',
      description: 'Individual file in the array',
      type: BaseType.FILE,
      category: 'node',
      properties: itemProperties,
      children: itemChildren,
    },
  ]

  return {
    id: baseId,
    nodeId,
    path,
    fullPath: baseId,
    label: `Files (${filesData.length})`,
    description: `${filesData.length} files (${formatBytes(totalSize)})`,
    type: BaseType.ARRAY,
    category: 'node',

    // Each array item is a structured file variable
    items: {
      id: `${baseId}[*]`,
      nodeId,
      path: '[*]',
      fullPath: `${baseId}[*]`,
      label: 'File',
      description: 'Individual file',
      type: BaseType.FILE,
      category: 'node',
      properties: itemProperties,
      children: itemChildren,
    },

    // Array-level properties for summary info
    properties: arrayProperties,

    // Children array for variable picker navigation
    children: arrayChildren,

    // Store the raw files data for backend access
    example: filesData,
  }
}

// Extension categories for file type detection
const EXTENSION_CATEGORIES = {
  office_document: ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.pdf'],
  image_format: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp'],
  text_format: ['.txt', '.csv', '.json', '.xml', '.yaml', '.yml', '.md'],
  compressed: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2'],
  executable: ['.exe', '.msi', '.app', '.deb', '.rpm', '.dmg'],
} as const

/**
 * Analyze filename for patterns and content
 */
export function analyzeFileName(filename: string) {
  return {
    hasNumbers: /\d/.test(filename),
    hasDate: /\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}|\d{2}-\d{2}-\d{4}/.test(filename),
    hasVersion: /v\d+|\d+\.\d+/i.test(filename),
  }
}

/**
 * Check if file extension is in a specific category
 */
export function isExtensionInCategory(
  filename: string,
  category: keyof typeof EXTENSION_CATEGORIES
): boolean {
  const extension = '.' + (filename.split('.').pop()?.toLowerCase() || '')
  const categoryExtensions = (EXTENSION_CATEGORIES[category] as readonly string[]) || []
  return categoryExtensions.includes(extension)
}

/**
 * Categorize file based on MIME type and extension
 */
export function categorizeFile(mimeType: string, filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase() || ''

  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) return 'media'
  if (mimeType.includes('text') || ['txt', 'csv', 'json', 'xml', 'md'].includes(extension))
    return 'text'
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(extension)) return 'document'
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(extension)) return 'compressed'

  return 'other'
}

/**
 * Validate file based on basic criteria
 */
export function isFileValid(fileData: WorkflowFileData): boolean {
  return !!(
    fileData &&
    fileData.filename &&
    fileData.filename.trim().length > 0 &&
    fileData.size >= 0 &&
    fileData.url &&
    fileData.url.trim().length > 0
  )
}

/**
 * Check if file is expired
 */
export function isFileExpired(fileData: WorkflowFileData): boolean {
  return fileData.expiresAt ? new Date() > fileData.expiresAt : false
}

/**
 * Check if file was uploaded today
 */
export function isUploadedToday(fileData: WorkflowFileData): boolean {
  const today = new Date()
  const uploaded = new Date(fileData.uploadedAt)
  return today.toDateString() === uploaded.toDateString()
}

/**
 * Check if file was uploaded within specified number of days
 */
export function isUploadedWithinDays(fileData: WorkflowFileData, days: number): boolean {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  return fileData.uploadedAt >= cutoff
}

/**
 * Check if file size is within limit (in MB)
 */
export function isWithinSizeLimit(fileData: WorkflowFileData, limitMB: number): boolean {
  const limitBytes = limitMB * 1024 * 1024
  return fileData.size <= limitBytes
}

/**
 * Check date conditions for files
 */
export function checkDateCondition(date: Date, operator: string, value?: any): boolean {
  const now = new Date()

  switch (operator) {
    case 'before':
      return date < new Date(value)
    case 'after':
      return date > new Date(value)
    case 'is': {
      const targetDate = new Date(value)
      return date.toDateString() === targetDate.toDateString()
    }
    case 'is not': {
      const targetDate = new Date(value)
      return date.toDateString() !== targetDate.toDateString()
    }
    case 'within_days': {
      const daysAgo = new Date()
      daysAgo.setDate(daysAgo.getDate() - value)
      return date >= daysAgo
    }
    case 'older_than_days': {
      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - value)
      return date < cutoffDate
    }
    case 'today':
      return date.toDateString() === now.toDateString()
    case 'yesterday': {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      return date.toDateString() === yesterday.toDateString()
    }
    case 'this_week': {
      const weekStart = new Date(now)
      weekStart.setDate(now.getDate() - now.getDay())
      return date >= weekStart
    }
    case 'this_month': {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      return date >= monthStart
    }
    default:
      return false
  }
}
