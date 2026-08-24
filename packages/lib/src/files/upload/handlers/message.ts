// packages/lib/src/files/upload/handlers/message.ts

import { schema } from '@auxx/database'
import { UPLOAD_POLICIES } from '../../types/entities'
import { assertRowInOrg, hasTempPrefix, tempExpiry } from './shared'
import type { UploadHandler } from './types'

/** Uploads aimed at a draft that does not exist yet carry this entity-id prefix. */
const TEMP_MESSAGE_PREFIX = 'temp-message-'

/** Email attachments. 25 MB is the Gmail ceiling every provider is measured against. */
export const messageHandler: UploadHandler = {
  ...UPLOAD_POLICIES.MESSAGE,
  visibility: 'PRIVATE',
  persist: 'asset+attachment',

  /**
   * Order matters, and this order is the processors' — restated because reading
   * it off them took two methods.
   *
   * `MessageProcessor.getAssetKind` answered `INLINE_IMAGE` first for an inline
   * attachment, and then `postCreateAsset` immediately `UPDATE`d the row back to
   * `TEMP_UPLOAD` whenever the entity id carried the temp prefix. So the row
   * that was actually committed for an inline upload against a draft was
   * `TEMP_UPLOAD`, and it has to stay that way: the send path promotes through
   * `convertTempAssetToPermanent`, which only acts on `TEMP_UPLOAD` — anything
   * else keeps the 24-hour `expiresAt` this handler also stamps and gets swept
   * out from under a sent message.
   */
  assetKind: (session) => {
    if (hasTempPrefix(session, TEMP_MESSAGE_PREFIX)) return 'TEMP_UPLOAD'
    if (session.metadata?.attachmentType === 'inline') return 'INLINE_IMAGE'
    return 'EMAIL_ATTACHMENT'
  },

  assetExpiresAt: (session, now) =>
    hasTempPrefix(session, TEMP_MESSAGE_PREFIX) ? tempExpiry(now) : undefined,

  validateEntity: async (ctx, init) => {
    // The draft does not exist yet, so there is nothing to check against.
    if (init.entityId?.startsWith(TEMP_MESSAGE_PREFIX)) return
    // `Message.organizationId` is read directly rather than joined through the
    // thread: the column is there, and the join was a second way to be wrong.
    await assertRowInOrg(ctx, schema.Message, init.entityId as string, 'Message')
  },
}
