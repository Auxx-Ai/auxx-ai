// apps/web/src/components/workflow/nodes/core/if-else/constants.ts

import { OPERATOR_DEFINITIONS, type Operator } from '@auxx/lib/workflow-engine/client'

/**
 * Operator labels for UI display
 * Generated from OPERATOR_DEFINITIONS for consistency
 */
export const OPERATOR_LABELS: Record<Operator, string> = Object.entries(
  OPERATOR_DEFINITIONS
).reduce(
  (acc, [key, def]) => {
    acc[key as Operator] = def.label
    return acc
  },
  {} as Record<Operator, string>
)

// Note: Sub-variables are now handled through the structured variable system
// File properties are navigable through the variable picker instead of hardcoded SUB_VARIABLES

// File type options (simplified, no i18n)
export const FILE_TYPE_OPTIONS = [
  { value: 'document', label: 'Document' },
  { value: 'image', label: 'Image' },
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio' },
  { value: 'text', label: 'Text' },
  { value: 'json', label: 'JSON' },
]

// Transfer method options
export const TRANSFER_METHOD = [
  { value: 'local_file', label: 'Local File' },
  { value: 'remote_url', label: 'Remote URL' },
  { value: 'all', label: 'All' },
]

// Extension categories for enhanced file type detection
export const EXTENSION_CATEGORIES = {
  office_document: ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.pdf'],
  image_format: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp'],
  text_format: ['.txt', '.csv', '.json', '.xml', '.yaml', '.yml', '.md'],
  compressed: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2'],
  executable: ['.exe', '.msi', '.app', '.deb', '.rpm', '.dmg'],
} as const

// File validation rules
export const FILE_VALIDATION_RULES = {
  max_size_mb: 100,
  allowed_extensions: [...Object.values(EXTENSION_CATEGORIES).flat()],
  blocked_extensions: ['.exe', '.bat', '.cmd', '.scr', '.vbs'],
} as const
