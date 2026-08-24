// packages/lib/src/files/upload/handlers/index.ts

/**
 * One record per `EntityType`, stating what that entity's uploads are allowed
 * to be and what rows they turn into.
 *
 * This replaced `ProcessorRegistry` — a class with a `Map`, a `markInitialized`
 * flag, a module-level `processorsInitialized` boolean shadowing it, an
 * `ensureProcessorsInitialized()` every caller had to remember, and five query
 * methods (`hasProcessor`, `getRegisteredTypes`, `getProcessorCount`,
 * `unregisterProcessor`, `clear`) with no production caller between them. A
 * frozen record needs none of it: nothing has to be initialised, so nothing can
 * be used before it is.
 *
 * `satisfies Record<EntityType, UploadHandler>` is the point of the record
 * literal: adding an `EntityType` without a handler becomes a compile error
 * instead of a silent fallback. `visit_qc_item` shipped with no registration at
 * all, fell through to the default `FileProcessor`, and produced a `FolderFile`
 * with no `assetId` for a surface that needed a `MediaAsset` + `Attachment`
 * (`docs/files-upload-architecture-guide.md` §11.3).
 */

import { BadRequestError } from '../../../errors'
import type { EntityType } from '../../types/entities'
import { articleHandler } from './article'
import { chatWidgetHandler } from './chat-widget'
import { commentHandler } from './comment'
import { customFieldHandler } from './custom-field'
import { datasetHandler } from './dataset'
import { fileHandler } from './file'
import { knowledgeBaseHandler } from './knowledge-base'
import { messageHandler } from './message'
import type { UploadHandler } from './types'
import { userProfileHandler } from './user-profile'
import { visitQcItemHandler } from './visit-qc-item'
import { workflowRunHandler } from './workflow-run'

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
 * into the type and then dispatched on. This is the rule `#1816` added to
 * `ProcessorRegistry.getForEntityType` and it is carried over verbatim — an
 * unregistered type must never fall back to the file-library handler.
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

/**
 * Whether this entity type's uploads must name the entity they attach to.
 *
 * Derived rather than declared: an `Attachment` row has a `NOT NULL` `entityId`,
 * so `asset+attachment` is exactly the set of handlers that cannot work without
 * one. `BaseAttachmentProcessor` stated the same rule imperatively
 * (`if (!init.entityId) throw`) and its subclasses were exactly these handlers.
 */
export function requiresEntityId(handler: UploadHandler): boolean {
  return handler.persist === 'asset+attachment'
}

export type {
  PersistResult,
  PersistStrategy,
  UploadAfterCommitDeps,
  UploadHandler,
  UploadPersistDeps,
  UploadThumbnailSpec,
} from './types'
