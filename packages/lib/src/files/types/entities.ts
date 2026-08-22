// packages/lib/src/files/types/entities.ts

/**
 * Shared entity types for file upload configurations
 * Safe for import by both frontend and backend - contains no server dependencies
 */

/**
 * Supported entity types for file uploads
 * Simple approach where entity type directly maps to processor
 */
export const ENTITY_TYPES = {
  FILE: 'FILE',
  DATASET: 'DATASET',
  ARTICLE: 'ARTICLE',
  USER_PROFILE: 'USER_PROFILE',
  WORKFLOW_RUN: 'WORKFLOW_RUN',
  COMMENT: 'COMMENT',
  MESSAGE: 'MESSAGE',
  KNOWLEDGE_BASE: 'KNOWLEDGE_BASE',
  CHAT_WIDGET: 'CHAT_WIDGET',
  CUSTOM_FIELD: 'CUSTOM_FIELD',
  /** A `VisitQcItem` row's photo attachments (08-worker-surface.md §5) */
  VISIT_QC_ITEM: 'visit_qc_item',
} as const

export type EntityType = (typeof ENTITY_TYPES)[keyof typeof ENTITY_TYPES]

/**
 * File visibility options
 */
export type FileVisibility =
  | 'public' // Publicly accessible
  | 'private' // Organization-only access
  | 'internal' // Internal system files

/**
 * File status in the system
 */
export type FileStatus =
  | 'PENDING' // Uploaded but not confirmed
  | 'CONFIRMED' // Attached to entity
  | 'FAILED' // Processing failed
  | 'DELETED' // Soft deleted
  | 'ARCHIVED' // Archived for long-term storage

/**
 * Stage configuration for processing pipelines
 */
export interface StageConfig {
  name: string
  displayName: string
  weight: number // Relative weight for progress calculation
  estimatedDuration?: number // Estimated duration in seconds
  optional?: boolean // Whether stage can be skipped
  parallel?: boolean // Can run in parallel with other stages
}

/**
 * File validation configuration
 */
export interface ValidationConfig {
  maxFileSize: number // Maximum file size in bytes
  allowedMimeTypes: string[] // Allowed MIME types
  allowedExtensions: string[] // Allowed file extensions
  scanForViruses?: boolean // Enable virus scanning
  requireExtension?: boolean // Require file extension
  blockExecutables?: boolean // Block executable files
}

/**
 * Entity-specific upload configuration
 */
export interface EntityUploadConfig {
  entityType: EntityType
  displayName: string
  description?: string
  stages: StageConfig[]
  validation: ValidationConfig
  defaultVisibility: FileVisibility
  maxConcurrentUploads?: number
  enableBatchUpload?: boolean
  supportedFeatures: {
    progress: boolean
    preview: boolean
    retry: boolean
    pause: boolean
    resume: boolean
  }
}

/**
 * Entity-specific metadata types
 */
export interface BaseEntityMetadata {
  entityId?: string
  organizationId: string
  userId: string
  uploadedAt: string
}

/**
 * Dataset-specific metadata
 */
export interface DatasetFileMetadata extends BaseEntityMetadata {
  datasetId: string
  documentName?: string
  processingOptions?: {
    chunkSize?: number
    chunkOverlap?: number
    chunkingStrategy?: 'FIXED_SIZE' | 'SEMANTIC' | 'HYBRID'
    embeddingModel?: string
    skipParsing?: boolean
    skipEmbedding?: boolean
  }
}

/**
 * Ticket-specific metadata
 */
export interface TicketFileMetadata extends BaseEntityMetadata {
  ticketId: string
  replyId?: string
  attachmentType?: 'evidence' | 'solution' | 'reference'
  description?: string
}

/**
 * Article-specific metadata
 */
export interface ArticleFileMetadata extends BaseEntityMetadata {
  articleId: string
  knowledgeBaseId: string
  attachmentType?: 'image' | 'document' | 'video' | 'audio'
  altText?: string
  caption?: string
}

/**
 * Knowledge base-specific metadata
 */
export interface KnowledgeBaseFileMetadata extends BaseEntityMetadata {
  knowledgeBaseId: string
  category?: string
  tags?: string[]
  featured?: boolean
}

/**
 * Chat widget-specific metadata (light/dark logo variants)
 */
export interface ChatWidgetFileMetadata extends BaseEntityMetadata {
  chatWidgetId: string
  variant: 'light' | 'dark'
}

/**
 * Workflow-specific metadata
 */
export interface WorkflowFileMetadata extends BaseEntityMetadata {
  workflowId: string
  nodeId?: string
  attachmentType?: 'template' | 'example' | 'documentation'
  version?: string
}

/**
 * Comment-specific metadata
 */
export interface CommentFileMetadata extends BaseEntityMetadata {
  commentId: string
  attachmentType?: 'reference' | 'screenshot' | 'document'
  description?: string
}

/**
 * Custom field-specific metadata
 */
export interface CustomFieldFileMetadata extends BaseEntityMetadata {
  fieldId?: string
  fieldValueId?: string
}

/**
 * Message-specific metadata (for email attachments)
 */
export interface MessageFileMetadata extends BaseEntityMetadata {
  messageId?: string // Optional as temp uploads won't have this initially
  threadId?: string
  attachmentType?: 'inline' | 'attachment'
  contentId?: string // For inline attachments
  isTemporary?: boolean
  expiresAt?: string // ISO date for temp file expiration
}

/**
 * Union type for all entity metadata
 */
export type EntityFileMetadata =
  | DatasetFileMetadata
  | TicketFileMetadata
  | ArticleFileMetadata
  | KnowledgeBaseFileMetadata
  | ChatWidgetFileMetadata
  | WorkflowFileMetadata
  | CommentFileMetadata
  | CustomFieldFileMetadata
  | MessageFileMetadata

/**
 * Entity processing capabilities
 */
export interface EntityCapabilities {
  supportsBatchUpload: boolean
  supportsPreview: boolean
  supportsVersioning: boolean
  supportsMetadataEditing: boolean
  maxFileSize: number
  recommendedFormats: string[]
}

/**
 * Pre-defined entity configurations
 */
export const ENTITY_CONFIGS: Record<EntityType, EntityUploadConfig> = {
  [ENTITY_TYPES.FILE]: {
    entityType: ENTITY_TYPES.FILE,
    displayName: 'Generic File',
    description: 'Upload files for general use',
    stages: [
      { name: 'validation', displayName: 'Validation', weight: 50, estimatedDuration: 1 },
      { name: 'storage', displayName: 'File Storage', weight: 50, estimatedDuration: 2 },
    ],
    validation: {
      maxFileSize: 100 * 1024 * 1024, // 100MB
      allowedMimeTypes: ['*/*'], // Allow all file types for generic
      allowedExtensions: [], // No restrictions for generic
      scanForViruses: true,
      requireExtension: false,
      blockExecutables: true,
    },
    defaultVisibility: 'private',
    maxConcurrentUploads: 3,
    enableBatchUpload: true,
    supportedFeatures: { progress: true, preview: false, retry: true, pause: false, resume: false },
  },

  [ENTITY_TYPES.DATASET]: {
    entityType: ENTITY_TYPES.DATASET,
    displayName: 'Dataset Document',
    description: 'Upload documents to be processed and indexed for AI training',
    stages: [
      { name: 'validation', displayName: 'Validation', weight: 10, estimatedDuration: 2 },
      { name: 'storage', displayName: 'File Storage', weight: 20, estimatedDuration: 5 },
      {
        name: 'document-creation',
        displayName: 'Document Creation',
        weight: 15,
        estimatedDuration: 3,
      },
      {
        name: 'content-extraction',
        displayName: 'Content Extraction',
        weight: 20,
        estimatedDuration: 15,
      },
      { name: 'text-chunking', displayName: 'Text Chunking', weight: 15, estimatedDuration: 10 },
      {
        name: 'embedding-generation',
        displayName: 'Embedding Generation',
        weight: 20,
        estimatedDuration: 30,
      },
    ],
    validation: {
      maxFileSize: 50 * 1024 * 1024, // 50MB
      allowedMimeTypes: [
        'text/*',
        // 'text/markdown',
        // 'text/x-markdown',
        'application/x-markdown',
        // 'text/x-web-markdown',
        // 'text/csv',
        // 'text/tab-separated-values',
        // 'text/tsv',
        'application/json',
        'application/x-ndjson',
        'application/jsonl',
        // 'text/json',
        'application/xml',
        // 'text/xml',
        'application/x-yaml',
        // 'text/yaml',
        // 'text/x-yaml',
        'application/yaml',
        // 'text/css',
        // 'text/javascript',
        'application/javascript',
        // 'text/x-python',
        // 'text/x-sql',
        // 'text/x-log',
        // 'text/log',
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword',
        // 'text/html',
        'application/xhtml+xml',
        // Add empty MIME type support for files without extension detection
        '',
        'application/octet-stream',
      ],
      allowedExtensions: [
        '.txt',
        '.md',
        '.markdown',
        '.csv',
        '.tsv',
        '.json',
        '.jsonl',
        '.ndjson',
        '.xml',
        '.yaml',
        '.yml',
        '.css',
        '.js',
        '.py',
        '.sql',
        '.log',
        '.pdf',
        '.docx',
        '.doc',
        '.html',
        '.htm',
      ],
      scanForViruses: true,
      requireExtension: true,
      blockExecutables: true,
    },
    defaultVisibility: 'private',
    maxConcurrentUploads: 5,
    enableBatchUpload: true,
    supportedFeatures: { progress: true, preview: true, retry: true, pause: true, resume: true },
  },

  [ENTITY_TYPES.ARTICLE]: {
    entityType: ENTITY_TYPES.ARTICLE,
    displayName: 'Article Asset',
    description: 'Upload images and documents for knowledge base articles',
    stages: [
      { name: 'validation', displayName: 'Validation', weight: 40, estimatedDuration: 1 },
      {
        name: 'content-processing',
        displayName: 'Content Processing',
        weight: 60,
        estimatedDuration: 5,
      },
    ],
    validation: {
      maxFileSize: 10 * 1024 * 1024, // 10MB
      // Avoid `image/*` wildcard — it would admit `image/svg+xml`, which is
      // an XSS vector when uploaded files are served from our origin.
      allowedMimeTypes: [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'text/*',
        'video/*',
        'audio/*',
        'application/pdf',
      ],
      allowedExtensions: [
        '.jpg',
        '.jpeg',
        '.png',
        '.gif',
        '.webp',
        '.pdf',
        '.txt',
        '.md',
        '.mp4',
        '.webm',
        '.mp3',
        '.wav',
      ],
      scanForViruses: true,
      requireExtension: true,
      blockExecutables: true,
    },
    defaultVisibility: 'public',
    maxConcurrentUploads: 5,
    enableBatchUpload: true,
    supportedFeatures: { progress: true, preview: true, retry: true, pause: false, resume: false },
  },

  [ENTITY_TYPES.USER_PROFILE]: {
    entityType: ENTITY_TYPES.USER_PROFILE,
    displayName: 'User Avatar',
    description: 'Upload profile pictures and user avatars',
    stages: [
      { name: 'validation', displayName: 'Validation', weight: 30, estimatedDuration: 1 },
      {
        name: 'user-profile-attachment',
        displayName: 'Avatar Processing',
        weight: 70,
        estimatedDuration: 2,
      },
    ],
    validation: {
      maxFileSize: 5 * 1024 * 1024, // 5MB
      allowedMimeTypes: [
        'image/*',
        // 'image/png',
        // 'image/webp',
        // 'image/gif',
      ],
      allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.gif'],
      scanForViruses: true,
      requireExtension: true,
      blockExecutables: true,
    },
    defaultVisibility: 'public',
    maxConcurrentUploads: 1,
    enableBatchUpload: false,
    supportedFeatures: { progress: true, preview: true, retry: true, pause: false, resume: false },
  },

  [ENTITY_TYPES.WORKFLOW_RUN]: {
    entityType: ENTITY_TYPES.WORKFLOW_RUN,
    displayName: 'Workflow Asset',
    description: 'Upload files for workflow templates and examples',
    stages: [
      { name: 'validation', displayName: 'Validation', weight: 40, estimatedDuration: 1 },
      {
        name: 'workflow-attachment',
        displayName: 'Workflow Attachment',
        weight: 60,
        estimatedDuration: 2,
      },
    ],
    validation: {
      maxFileSize: 15 * 1024 * 1024, // 15MB
      allowedMimeTypes: [
        'text/*',
        'image/*',
        'application/json',
        'application/xml',
        'application/pdf',
      ],
      allowedExtensions: ['.txt', '.json', '.xml', '.yaml', '.yml', '.jpg', '.png', '.pdf', '.md'],
      scanForViruses: true,
      requireExtension: true,
      blockExecutables: true,
    },
    defaultVisibility: 'private',
    maxConcurrentUploads: 2,
    enableBatchUpload: false,
    supportedFeatures: { progress: true, preview: false, retry: true, pause: false, resume: false },
  },

  [ENTITY_TYPES.COMMENT]: {
    entityType: ENTITY_TYPES.COMMENT,
    displayName: 'Comment Attachment',
    description: 'Attach files to comments',
    stages: [
      { name: 'validation', displayName: 'Validation', weight: 50, estimatedDuration: 1 },
      {
        name: 'attachment-creation',
        displayName: 'Attachment Creation',
        weight: 50,
        estimatedDuration: 2,
      },
    ],
    validation: {
      maxFileSize: 25 * 1024 * 1024, // 25MB
      allowedMimeTypes: [
        'image/*',
        'text/*',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ],
      allowedExtensions: ['.jpg', '.jpeg', '.png', '.gif', '.pdf', '.txt', '.doc', '.docx'],
      scanForViruses: true,
      requireExtension: true,
      blockExecutables: true,
    },
    defaultVisibility: 'private',
    maxConcurrentUploads: 3,
    enableBatchUpload: true,
    supportedFeatures: { progress: true, preview: true, retry: true, pause: false, resume: false },
  },

  [ENTITY_TYPES.CUSTOM_FIELD]: {
    entityType: ENTITY_TYPES.CUSTOM_FIELD,
    displayName: 'Custom Field Attachment',
    description: 'Attach files to custom field values',
    stages: [
      { name: 'validation', displayName: 'Validation', weight: 50, estimatedDuration: 1 },
      {
        name: 'attachment-creation',
        displayName: 'Attachment Creation',
        weight: 50,
        estimatedDuration: 2,
      },
    ],
    validation: {
      maxFileSize: 25 * 1024 * 1024, // 25MB
      allowedMimeTypes: ['*/*'],
      allowedExtensions: [],
      scanForViruses: true,
      requireExtension: false,
      blockExecutables: true,
    },
    defaultVisibility: 'private',
    maxConcurrentUploads: 3,
    enableBatchUpload: true,
    supportedFeatures: { progress: true, preview: true, retry: true, pause: false, resume: false },
  },

  [ENTITY_TYPES.MESSAGE]: {
    entityType: ENTITY_TYPES.MESSAGE,
    displayName: 'Email Attachment',
    description: 'Attach files to email messages',
    stages: [
      { name: 'validation', displayName: 'Validation', weight: 30, estimatedDuration: 1 },
      { name: 'virus-scan', displayName: 'Security Scan', weight: 20, estimatedDuration: 2 },
      {
        name: 'attachment-creation',
        displayName: 'Attachment Creation',
        weight: 50,
        estimatedDuration: 2,
      },
    ],
    validation: {
      maxFileSize: 25 * 1024 * 1024, // 25MB (Gmail standard)
      allowedMimeTypes: ['image/*', 'text/*', 'application/*', 'audio/*', 'video/*'],
      allowedExtensions: [], // Allow all extensions for email
      scanForViruses: true,
      requireExtension: false,
      blockExecutables: true,
    },
    defaultVisibility: 'private',
    maxConcurrentUploads: 5,
    enableBatchUpload: true,
    supportedFeatures: {
      progress: true,
      preview: true,
      retry: true,
      pause: false,
      resume: false,
    },
  },

  [ENTITY_TYPES.KNOWLEDGE_BASE]: {
    entityType: ENTITY_TYPES.KNOWLEDGE_BASE,
    displayName: 'Knowledge Base Branding',
    description: 'Logos and branding assets for Knowledge Base',
    stages: [
      { name: 'validation', displayName: 'Validation', weight: 50, estimatedDuration: 1 },
      {
        name: 'attachment-creation',
        displayName: 'Attachment Creation',
        weight: 50,
        estimatedDuration: 2,
      },
    ],
    validation: {
      maxFileSize: 10 * 1024 * 1024, // 10MB
      // SVG is intentionally excluded — XSS risk (script execution in our origin).
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
      scanForViruses: true,
      requireExtension: true,
      blockExecutables: true,
    },
    defaultVisibility: 'public',
    maxConcurrentUploads: 1,
    enableBatchUpload: false,
    supportedFeatures: { progress: true, preview: true, retry: true, pause: false, resume: false },
  },

  [ENTITY_TYPES.CHAT_WIDGET]: {
    entityType: ENTITY_TYPES.CHAT_WIDGET,
    displayName: 'Chat Widget Branding',
    description: 'Logos and branding assets for the embedded Chat Widget',
    stages: [
      { name: 'validation', displayName: 'Validation', weight: 50, estimatedDuration: 1 },
      {
        name: 'attachment-creation',
        displayName: 'Attachment Creation',
        weight: 50,
        estimatedDuration: 2,
      },
    ],
    validation: {
      maxFileSize: 10 * 1024 * 1024, // 10MB
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
      scanForViruses: true,
      requireExtension: true,
      blockExecutables: true,
    },
    defaultVisibility: 'public',
    maxConcurrentUploads: 1,
    enableBatchUpload: false,
    supportedFeatures: { progress: true, preview: true, retry: true, pause: false, resume: false },
  },

  [ENTITY_TYPES.VISIT_QC_ITEM]: {
    entityType: ENTITY_TYPES.VISIT_QC_ITEM,
    displayName: 'Quality Check Photo',
    description: 'Attach photos to a visit quality-check item',
    stages: [
      { name: 'validation', displayName: 'Validation', weight: 40, estimatedDuration: 1 },
      {
        name: 'attachment-creation',
        displayName: 'Attachment Creation',
        weight: 60,
        estimatedDuration: 2,
      },
    ],
    // Mirrors `VisitQcItemProcessor` (upload/processors/visit-qc-processor.ts), which is the
    // authority — this config is only the client-side pre-flight. HEIC/HEIF are accepted because
    // the strip captures straight off an iPhone and does not run `convertHeicToJpeg` (which is
    // Safari-only and hands back the original file everywhere else), so a `.heic` capture reaches
    // the server as-is and the server takes it.
    validation: {
      maxFileSize: 25 * 1024 * 1024, // 25MB — matches VisitQcItemProcessor.maxFileSize
      // SVG excluded — XSS vector when served from our origin.
      allowedMimeTypes: [
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
        'image/heic',
        'image/heif',
      ],
      allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif'],
      scanForViruses: true,
      requireExtension: true,
      blockExecutables: true,
    },
    defaultVisibility: 'private',
    maxConcurrentUploads: 3,
    enableBatchUpload: true,
    supportedFeatures: { progress: true, preview: true, retry: true, pause: false, resume: false },
  },
} as const

/**
 * Get configuration for specific entity type
 */
export function getEntityConfig(entityType: EntityType): EntityUploadConfig {
  const config = ENTITY_CONFIGS[entityType]
  if (!config) {
    throw new Error(
      `Invalid entity type: ${entityType}. Valid types are: ${Object.keys(ENTITY_CONFIGS).join(', ')}`
    )
  }
  return config
}

/**
 * Get capabilities for specific entity type
 */
export function getEntityCapabilities(entityType: EntityType): EntityCapabilities {
  const config = getEntityConfig(entityType)
  return {
    supportsBatchUpload: config.enableBatchUpload ?? false,
    supportsPreview: config.supportedFeatures.preview,
    supportsVersioning: false, // Not implemented yet
    supportsMetadataEditing: true,
    maxFileSize: config.validation.maxFileSize,
    recommendedFormats: config.validation.allowedExtensions,
  }
}
