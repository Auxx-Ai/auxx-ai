// packages/lib/src/files/types/entities.ts

/**
 * The per-entity upload facts, and nothing that needs a server to state them.
 *
 * This module is imported by BOTH sides and must stay free of server
 * dependencies: `packages/lib/src/files/upload/handlers/*` spread
 * {@link UPLOAD_POLICIES} into their handler records, and the browser reads
 * {@link ENTITY_CONFIGS} to reject a file before a byte is uploaded.
 *
 * That sharing is the point. The client table used to restate the limits by
 * hand and drifted from the handlers it was mirroring — `WORKFLOW_RUN` refused
 * at 15 MB what the server took to 50 MB, `USER_PROFILE` offered `image/*`
 * where the server allows four explicit types, `ARTICLE` admitted video and
 * audio the server rejects. Every one of those was a user being told "no" by a
 * table with no authority. There is now exactly one table, here, and the
 * handlers spread it rather than repeating it.
 */

/**
 * Supported entity types for file uploads
 * Simple approach where entity type directly maps to handler
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

const MB = 1024 * 1024

/** Every asset-backed entity signs for at most ten minutes. `FILE` is the exception. */
const ASSET_MAX_TTL_SEC = 10 * 60

/**
 * MIME types accepted for dataset documents.
 *
 * The empty string and `application/octet-stream` are both here on purpose:
 * a browser that cannot type a file by extension sends one or the other, and
 * dataset ingestion sniffs the content itself downstream.
 */
const DATASET_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'application/x-markdown',
  'text/x-web-markdown',
  'text/csv',
  'text/tab-separated-values',
  'text/tsv',
  'application/json',
  'application/x-ndjson',
  'application/jsonl',
  'text/json',
  'application/xml',
  'text/xml',
  'application/x-yaml',
  'text/yaml',
  'text/x-yaml',
  'application/yaml',
  'text/css',
  'text/javascript',
  'application/javascript',
  'text/x-python',
  'text/x-sql',
  'text/x-log',
  'text/log',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/pdf',
  'text/html',
  'application/xhtml+xml',
  'application/zip',
  'application/x-zip-compressed',
  'message/rfc822',
  'application/vnd.ms-outlook',
  'application/epub+zip',
  'application/rtf',
  '',
  'application/octet-stream',
] as const

/**
 * Raster images only, and never an `image/*` wildcard: that would admit
 * `image/svg+xml`, and an uploaded SVG can carry `<script>` that runs in our
 * origin when the object is opened directly.
 */
const LOGO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

/**
 * The declarative half of an upload handler: what an entity type's uploads are
 * allowed to be, stated as data with no I/O behind it.
 *
 * These five fields are exactly the ones `buildUploadConfig` reads to build the
 * presigned policy, which is why they are also the only ones the browser can
 * usefully pre-check. Everything else a handler declares — visibility, persist
 * strategy, asset kind, hooks — is behaviour the client cannot mirror and must
 * not try to.
 */
export interface EntityUploadPolicy {
  entityType: EntityType
  /** Hard ceiling, in bytes. Becomes the policy's `contentLengthRange` upper bound. */
  maxFileSize: number
  /** `type/subtype`, `type/*` and `*​/*` are all honoured — see `enforceUploadPolicy`. */
  allowedMimeTypes: readonly string[]
  /** Ceiling on the presigned signature's lifetime, in seconds. */
  maxTtlSec: number
  /** Size at or above which the upload is planned as multipart. */
  multipartThresholdBytes?: number
}

/**
 * The single source of truth for what each entity type's uploads may be.
 *
 * Read on the server by the handler records in `files/upload/handlers/`, which
 * spread the matching entry, and on the client by {@link ENTITY_CONFIGS}. A
 * limit stated anywhere else is a limit that can disagree with the one the
 * server enforces.
 */
export const UPLOAD_POLICIES = {
  [ENTITY_TYPES.FILE]: {
    entityType: ENTITY_TYPES.FILE,
    // The file library takes anything; the ceiling that actually binds is the
    // organization's storage quota, answered as a 403 at session creation.
    maxFileSize: Number.MAX_SAFE_INTEGER,
    allowedMimeTypes: ['*/*'],
    maxTtlSec: 60 * 60,
    multipartThresholdBytes: 100 * MB,
  },

  [ENTITY_TYPES.DATASET]: {
    entityType: ENTITY_TYPES.DATASET,
    maxFileSize: 50 * MB,
    allowedMimeTypes: DATASET_MIME_TYPES,
    maxTtlSec: ASSET_MAX_TTL_SEC,
  },

  [ENTITY_TYPES.ARTICLE]: {
    entityType: ENTITY_TYPES.ARTICLE,
    maxFileSize: 10 * MB,
    // No `image/*` wildcard — that would match `image/svg+xml`, and SVGs can
    // carry <script> that runs in our origin when opened directly.
    allowedMimeTypes: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'application/pdf',
      'text/plain',
      'text/markdown',
      'text/html',
    ],
    maxTtlSec: ASSET_MAX_TTL_SEC,
  },

  [ENTITY_TYPES.USER_PROFILE]: {
    entityType: ENTITY_TYPES.USER_PROFILE,
    maxFileSize: 5 * MB,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    maxTtlSec: ASSET_MAX_TTL_SEC,
  },

  [ENTITY_TYPES.WORKFLOW_RUN]: {
    entityType: ENTITY_TYPES.WORKFLOW_RUN,
    maxFileSize: 50 * MB,
    allowedMimeTypes: ['*/*'],
    maxTtlSec: ASSET_MAX_TTL_SEC,
    multipartThresholdBytes: 25 * MB,
  },

  [ENTITY_TYPES.COMMENT]: {
    entityType: ENTITY_TYPES.COMMENT,
    maxFileSize: 25 * MB,
    allowedMimeTypes: [
      'image/*',
      'text/*',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    maxTtlSec: ASSET_MAX_TTL_SEC,
  },

  [ENTITY_TYPES.MESSAGE]: {
    entityType: ENTITY_TYPES.MESSAGE,
    // 25 MB is the Gmail ceiling every provider is measured against.
    maxFileSize: 25 * MB,
    allowedMimeTypes: ['*/*'],
    maxTtlSec: ASSET_MAX_TTL_SEC,
  },

  [ENTITY_TYPES.KNOWLEDGE_BASE]: {
    entityType: ENTITY_TYPES.KNOWLEDGE_BASE,
    maxFileSize: 10 * MB,
    allowedMimeTypes: LOGO_MIME_TYPES,
    maxTtlSec: ASSET_MAX_TTL_SEC,
  },

  [ENTITY_TYPES.CHAT_WIDGET]: {
    entityType: ENTITY_TYPES.CHAT_WIDGET,
    maxFileSize: 10 * MB,
    allowedMimeTypes: LOGO_MIME_TYPES,
    maxTtlSec: ASSET_MAX_TTL_SEC,
  },

  [ENTITY_TYPES.CUSTOM_FIELD]: {
    entityType: ENTITY_TYPES.CUSTOM_FIELD,
    // `*​/*` and 25 MB are the outer bounds only. The field's own `options.file`
    // narrows both at prepare time, in `narrowPolicyToFieldOptions`.
    maxFileSize: 25 * MB,
    allowedMimeTypes: ['*/*'],
    maxTtlSec: ASSET_MAX_TTL_SEC,
  },

  [ENTITY_TYPES.VISIT_QC_ITEM]: {
    entityType: ENTITY_TYPES.VISIT_QC_ITEM,
    maxFileSize: 25 * MB,
    // HEIC/HEIF are accepted because the photo strip captures straight off an
    // iPhone and `convertHeicToJpeg` only decodes in Safari — everywhere else it
    // hands back the original file, so a `.heic` capture reaches the server
    // as-is. SVG is excluded: XSS vector when served from our origin.
    allowedMimeTypes: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/heic',
      'image/heif',
    ],
    maxTtlSec: ASSET_MAX_TTL_SEC,
  },
} as const satisfies Record<EntityType, EntityUploadPolicy>

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
 * The client-side pre-flight rules, derived from {@link UPLOAD_POLICIES}.
 *
 * Deliberately only the two rules the server actually enforces
 * (`enforceUploadPolicy` checks size and MIME and nothing else). An extension
 * allow-list used to live here too; it had no server counterpart, so it could
 * only ever refuse a file the server would have taken.
 */
export interface ValidationConfig {
  /** Maximum file size in bytes */
  maxFileSize: number
  /** Allowed MIME types. `type/subtype`, `type/*` and `*​/*` are all honoured. */
  allowedMimeTypes: readonly string[]
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

/** The half of an entity's upload config that only the UI cares about. */
type EntityPresentation = Omit<EntityUploadConfig, 'entityType' | 'validation'>

/**
 * Labels, progress stages and per-surface UI switches.
 *
 * None of this has a server counterpart — stages are a progress bar, not a
 * pipeline — so it is stated by hand here and nowhere else. The limits are NOT
 * here; they come from {@link UPLOAD_POLICIES}.
 */
const ENTITY_PRESENTATION: Record<EntityType, EntityPresentation> = {
  [ENTITY_TYPES.FILE]: {
    displayName: 'Generic File',
    description: 'Upload files for general use',
    stages: [
      { name: 'validation', displayName: 'Validation', weight: 50, estimatedDuration: 1 },
      { name: 'storage', displayName: 'File Storage', weight: 50, estimatedDuration: 2 },
    ],
    defaultVisibility: 'private',
    maxConcurrentUploads: 3,
    enableBatchUpload: true,
    supportedFeatures: { progress: true, preview: false, retry: true, pause: false, resume: false },
  },

  [ENTITY_TYPES.DATASET]: {
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
    defaultVisibility: 'private',
    maxConcurrentUploads: 5,
    enableBatchUpload: true,
    supportedFeatures: { progress: true, preview: true, retry: true, pause: true, resume: true },
  },

  [ENTITY_TYPES.ARTICLE]: {
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
    defaultVisibility: 'public',
    maxConcurrentUploads: 5,
    enableBatchUpload: true,
    supportedFeatures: { progress: true, preview: true, retry: true, pause: false, resume: false },
  },

  [ENTITY_TYPES.USER_PROFILE]: {
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
    defaultVisibility: 'public',
    maxConcurrentUploads: 1,
    enableBatchUpload: false,
    supportedFeatures: { progress: true, preview: true, retry: true, pause: false, resume: false },
  },

  [ENTITY_TYPES.WORKFLOW_RUN]: {
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
    defaultVisibility: 'private',
    maxConcurrentUploads: 2,
    enableBatchUpload: false,
    supportedFeatures: { progress: true, preview: false, retry: true, pause: false, resume: false },
  },

  [ENTITY_TYPES.COMMENT]: {
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
    defaultVisibility: 'private',
    maxConcurrentUploads: 3,
    enableBatchUpload: true,
    supportedFeatures: { progress: true, preview: true, retry: true, pause: false, resume: false },
  },

  [ENTITY_TYPES.MESSAGE]: {
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
    defaultVisibility: 'private',
    maxConcurrentUploads: 5,
    enableBatchUpload: true,
    supportedFeatures: { progress: true, preview: true, retry: true, pause: false, resume: false },
  },

  [ENTITY_TYPES.KNOWLEDGE_BASE]: {
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
    defaultVisibility: 'public',
    maxConcurrentUploads: 1,
    enableBatchUpload: false,
    supportedFeatures: { progress: true, preview: true, retry: true, pause: false, resume: false },
  },

  [ENTITY_TYPES.CHAT_WIDGET]: {
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
    defaultVisibility: 'public',
    maxConcurrentUploads: 1,
    enableBatchUpload: false,
    supportedFeatures: { progress: true, preview: true, retry: true, pause: false, resume: false },
  },

  [ENTITY_TYPES.CUSTOM_FIELD]: {
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
    defaultVisibility: 'private',
    maxConcurrentUploads: 3,
    enableBatchUpload: true,
    supportedFeatures: { progress: true, preview: true, retry: true, pause: false, resume: false },
  },

  [ENTITY_TYPES.VISIT_QC_ITEM]: {
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
    defaultVisibility: 'private',
    maxConcurrentUploads: 3,
    enableBatchUpload: true,
    supportedFeatures: { progress: true, preview: true, retry: true, pause: false, resume: false },
  },
}

/**
 * Per-entity upload configuration for the browser.
 *
 * Built, not written: the `validation` half is projected straight out of
 * {@link UPLOAD_POLICIES}, so the client cannot refuse a file the server would
 * accept. Only {@link ENTITY_PRESENTATION} is hand-maintained, and none of it
 * decides whether a file is allowed.
 */
export const ENTITY_CONFIGS: Record<EntityType, EntityUploadConfig> = (() => {
  const configs = {} as Record<EntityType, EntityUploadConfig>

  for (const entityType of Object.values(ENTITY_TYPES)) {
    const policy = UPLOAD_POLICIES[entityType]
    configs[entityType] = {
      entityType,
      ...ENTITY_PRESENTATION[entityType],
      validation: {
        maxFileSize: policy.maxFileSize,
        allowedMimeTypes: policy.allowedMimeTypes,
      },
    }
  }

  return configs
})()

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
