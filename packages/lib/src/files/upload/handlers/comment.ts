// packages/lib/src/files/upload/handlers/comment.ts

import { schema } from '@auxx/database'
import { ENTITY_TYPES } from '../../types/entities'
import { ASSET_MAX_TTL_SEC, assertRowInOrg, hasTempPrefix, MB, tempExpiry } from './shared'
import type { UploadHandler } from './types'

/** Uploads aimed at a comment that does not exist yet carry this entity-id prefix. */
const TEMP_COMMENT_PREFIX = 'temp-comment-'

/** Attachments on a comment, including ones uploaded before the comment exists. */
export const commentHandler: UploadHandler = {
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

  assetExpiresAt: (session, now) =>
    hasTempPrefix(session, TEMP_COMMENT_PREFIX) ? tempExpiry(now) : undefined,

  validateEntity: async (ctx, init) => {
    // The comment does not exist yet, so there is nothing to check against.
    if (init.entityId?.startsWith(TEMP_COMMENT_PREFIX)) return
    await assertRowInOrg(ctx, schema.Comment, init.entityId as string, 'Comment')
  },
}
