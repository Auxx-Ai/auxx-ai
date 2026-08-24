// packages/lib/src/files/upload/handlers/article.ts

import { schema } from '@auxx/database'
import { ENTITY_TYPES } from '../../types/entities'
import { ASSET_MAX_TTL_SEC, assertRowInOrg, MB } from './shared'
import type { UploadHandler } from './types'

/** Knowledge-base article bodies: inline images, covers, attached documents. */
export const articleHandler: UploadHandler = {
  entityType: ENTITY_TYPES.ARTICLE,
  // A cover is forced PUBLIC so its URL is durable: OG image crawlers cache for
  // hours or days, by which point a presigned URL answers 403.
  visibility: (init) => (init.metadata?.role === 'COVER' ? 'PUBLIC' : 'PRIVATE'),
  maxFileSize: 10 * MB,
  // No `image/*` wildcard — that would match `image/svg+xml`, and SVGs can carry
  // <script> that runs in our origin when opened directly.
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
  // A cover or an explicit thumbnail is a rendition, not body content.
  assetKind: (session) =>
    session.metadata?.role === 'COVER' || session.metadata?.role === 'THUMBNAIL'
      ? 'THUMBNAIL'
      : 'INLINE_IMAGE',
  persist: 'asset+attachment',

  validateEntity: (ctx, init) =>
    assertRowInOrg(ctx, schema.Article, init.entityId as string, 'Article'),
}
