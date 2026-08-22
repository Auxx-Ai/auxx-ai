// packages/lib/src/files/upload/handlers/index.ts

/**
 * One record per `EntityType`, stating what that entity's uploads are allowed
 * to be.
 *
 * These are the numbers the processor classes carry today, lifted verbatim.
 * Nothing dispatches on them yet — the processors are still the live path — so
 * until PR 4d converts them there are two statements of the same facts, and
 * `__tests__/handler-parity.test.ts` fails the moment they disagree.
 *
 * `satisfies Record<EntityType, UploadHandler>` is the point of the record
 * literal: adding an `EntityType` without a handler becomes a compile error
 * instead of a silent fallback. `visit_qc_item` shipped with no registration at
 * all, fell through to the default `FileProcessor`, and produced a `FolderFile`
 * with no `assetId` for a surface that needed a `MediaAsset` + `Attachment`
 * (`docs/files-upload-architecture-guide.md` §11.3).
 */

import { BadRequestError } from '../../../errors'
import { ENTITY_TYPES, type EntityType } from '../../types/entities'
import type { UploadHandler } from './types'

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

/** Generic user files. No `MediaAsset`, no entity, no MIME opinion. */
const fileHandler: UploadHandler = {
  entityType: ENTITY_TYPES.FILE,
  visibility: 'PRIVATE',
  // `FileProcessor` never clamped the base policy's permissive range, so a user
  // file has no server-side ceiling here. The org's storage quota is the real
  // limit and the route checks it before this runs.
  maxFileSize: Number.MAX_SAFE_INTEGER,
  allowedMimeTypes: ['*/*'],
  maxTtlSec: 60 * 60,
  multipartThresholdBytes: 100 * MB,
  persist: 'folder-file',
}

/** Dataset documents: parsed, chunked and embedded after upload. */
const datasetHandler: UploadHandler = {
  entityType: ENTITY_TYPES.DATASET,
  // `entityId` IS the dataset id for this entity type; the document writer reads
  // it out of metadata, so it is copied across before the config is built.
  normalizeInit: (init) => ({
    ...init,
    metadata: { ...init.metadata, datasetId: init.entityId },
  }),
  visibility: 'PRIVATE',
  maxFileSize: 50 * MB,
  allowedMimeTypes: DATASET_MIME_TYPES,
  maxTtlSec: ASSET_MAX_TTL_SEC,
  assetKind: 'DOCUMENT',
  persist: 'asset',
}

/** Knowledge-base article bodies: inline images, covers, attached documents. */
const articleHandler: UploadHandler = {
  entityType: ENTITY_TYPES.ARTICLE,
  // A cover is forced PUBLIC so its URL is durable: OG image crawlers cache for
  // hours or days, by which point a presigned URL answers 403.
  visibility: (init) => (init.metadata?.role === 'COVER' ? 'PUBLIC' : 'PRIVATE'),
  maxFileSize: 10 * MB,
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
  assetKind: 'INLINE_IMAGE',
  persist: 'asset+attachment',
}

/** Avatars for real users and for the synthetic users backing agents. */
const userProfileHandler: UploadHandler = {
  entityType: ENTITY_TYPES.USER_PROFILE,
  // The avatar's owner is the entity. A client that omits `entityId` means
  // "mine", and the storage key has to say so before it is derived.
  normalizeInit: (init) => ({ ...init, entityId: init.entityId || init.userId }),
  visibility: 'PUBLIC',
  maxFileSize: 5 * MB,
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  maxTtlSec: ASSET_MAX_TTL_SEC,
  assetKind: 'USER_AVATAR',
  persist: 'versioned-asset',
}

/** Files handed to, or produced by, a workflow run. Temporary by nature. */
const workflowRunHandler: UploadHandler = {
  entityType: ENTITY_TYPES.WORKFLOW_RUN,
  visibility: 'PRIVATE',
  maxFileSize: 50 * MB,
  allowedMimeTypes: ['*/*'],
  maxTtlSec: ASSET_MAX_TTL_SEC,
  multipartThresholdBytes: 25 * MB,
  assetKind: 'TEMP_UPLOAD',
  persist: 'asset+attachment',
}

/** Attachments on a comment, including ones uploaded before the comment exists. */
const commentHandler: UploadHandler = {
  entityType: ENTITY_TYPES.COMMENT,
  visibility: 'PRIVATE',
  maxFileSize: 25 * MB,
  allowedMimeTypes: [
    'image/*',
    'text/*',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  maxTtlSec: ASSET_MAX_TTL_SEC,
  assetKind: 'TEMP_UPLOAD',
  persist: 'asset+attachment',
}

/** Email attachments. 25 MB is the Gmail ceiling every provider is measured against. */
const messageHandler: UploadHandler = {
  entityType: ENTITY_TYPES.MESSAGE,
  visibility: 'PRIVATE',
  maxFileSize: 25 * MB,
  allowedMimeTypes: ['*/*'],
  maxTtlSec: ASSET_MAX_TTL_SEC,
  assetKind: 'EMAIL_ATTACHMENT',
  persist: 'asset+attachment',
}

/** Knowledge-base branding: the light and dark logo variants. */
const knowledgeBaseHandler: UploadHandler = {
  entityType: ENTITY_TYPES.KNOWLEDGE_BASE,
  visibility: 'PUBLIC',
  maxFileSize: 10 * MB,
  allowedMimeTypes: LOGO_MIME_TYPES,
  maxTtlSec: ASSET_MAX_TTL_SEC,
  assetKind: 'THUMBNAIL',
  persist: 'asset+attachment',
}

/** Embedded chat-widget branding. Rendered at one fixed size, so no presets. */
const chatWidgetHandler: UploadHandler = {
  entityType: ENTITY_TYPES.CHAT_WIDGET,
  visibility: 'PUBLIC',
  maxFileSize: 10 * MB,
  allowedMimeTypes: LOGO_MIME_TYPES,
  maxTtlSec: ASSET_MAX_TTL_SEC,
  assetKind: 'THUMBNAIL',
  persist: 'asset+attachment',
}

/**
 * Files stored in a custom field of type `FILE`.
 *
 * `*​/*` is the outer bound only. The field's own `options.file` narrows it per
 * field, which needs the org cache and therefore arrives through
 * `refineConfig` rather than this record.
 */
const customFieldHandler: UploadHandler = {
  entityType: ENTITY_TYPES.CUSTOM_FIELD,
  visibility: 'PRIVATE',
  maxFileSize: 25 * MB,
  allowedMimeTypes: ['*/*'],
  maxTtlSec: ASSET_MAX_TTL_SEC,
  assetKind: 'TEMP_UPLOAD',
  persist: 'asset+attachment',
}

/**
 * Worker-captured job-site photos on a visit quality-check item.
 *
 * HEIC and HEIF are accepted because the capture strip's input is
 * `accept='image/*' capture='environment'` and does not convert: `convertHeicToJpeg`
 * only decodes in Safari and hands back the original file everywhere else, so an
 * iPhone capture reaches us as HEIC or not at all.
 */
const visitQcItemHandler: UploadHandler = {
  entityType: ENTITY_TYPES.VISIT_QC_ITEM,
  visibility: 'PRIVATE',
  maxFileSize: 25 * MB,
  allowedMimeTypes: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
  ],
  maxTtlSec: ASSET_MAX_TTL_SEC,
  assetKind: 'INLINE_IMAGE',
  persist: 'asset+attachment',
}

/** Every entity type's upload handler. Exhaustive, and the compiler enforces it. */
export const UPLOAD_HANDLERS = {
  FILE: fileHandler,
  DATASET: datasetHandler,
  ARTICLE: articleHandler,
  USER_PROFILE: userProfileHandler,
  WORKFLOW_RUN: workflowRunHandler,
  COMMENT: commentHandler,
  MESSAGE: messageHandler,
  KNOWLEDGE_BASE: knowledgeBaseHandler,
  CHAT_WIDGET: chatWidgetHandler,
  CUSTOM_FIELD: customFieldHandler,
  visit_qc_item: visitQcItemHandler,
} as const satisfies Record<EntityType, UploadHandler>

/**
 * The handler for an entity type.
 *
 * Takes a `string` rather than an `EntityType` because the caller is a route
 * holding parsed JSON: an unknown value has to fail here, loudly, not be cast
 * into the type and then dispatched on.
 *
 * @throws {BadRequestError} when no handler is registered for the type.
 */
export function getUploadHandler(entityType: string): UploadHandler {
  const handler = (UPLOAD_HANDLERS as Record<string, UploadHandler | undefined>)[entityType]
  if (!handler) {
    throw new BadRequestError(`No upload handler for entity type: ${entityType}`)
  }
  return handler
}

export type { PersistStrategy, UploadHandler } from './types'
