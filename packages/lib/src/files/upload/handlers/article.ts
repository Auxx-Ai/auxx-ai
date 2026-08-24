// packages/lib/src/files/upload/handlers/article.ts

import { schema } from '@auxx/database'
import { UPLOAD_POLICIES } from '../../types/entities'
import { assertRowInOrg } from './shared'
import type { UploadHandler } from './types'

/** Knowledge-base article bodies: inline images, covers, attached documents. */
export const articleHandler: UploadHandler = {
  ...UPLOAD_POLICIES.ARTICLE,
  // A cover is forced PUBLIC so its URL is durable: OG image crawlers cache for
  // hours or days, by which point a presigned URL answers 403.
  visibility: (init) => (init.metadata?.role === 'COVER' ? 'PUBLIC' : 'PRIVATE'),
  // A cover or an explicit thumbnail is a rendition, not body content.
  assetKind: (session) =>
    session.metadata?.role === 'COVER' || session.metadata?.role === 'THUMBNAIL'
      ? 'THUMBNAIL'
      : 'INLINE_IMAGE',
  persist: 'asset+attachment',

  validateEntity: (ctx, init) =>
    assertRowInOrg(ctx, schema.Article, init.entityId as string, 'Article'),
}
