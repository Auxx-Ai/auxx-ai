// packages/lib/src/files/upload/handlers/comment.ts

import { schema } from '@auxx/database'
import { UPLOAD_POLICIES } from '../../types/entities'
import { assertRowInOrg, hasTempPrefix, tempExpiry } from './shared'
import type { UploadHandler } from './types'

/** Uploads aimed at a comment that does not exist yet carry this entity-id prefix. */
const TEMP_COMMENT_PREFIX = 'temp-comment-'

/** Attachments on a comment, including ones uploaded before the comment exists. */
export const commentHandler: UploadHandler = {
  ...UPLOAD_POLICIES.COMMENT,
  visibility: 'PRIVATE',
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
