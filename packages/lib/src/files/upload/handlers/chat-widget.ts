// packages/lib/src/files/upload/handlers/chat-widget.ts

import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { UPLOAD_POLICIES } from '../../types/entities'
import { assertRowInOrg, logoColumnUpdate } from './shared'
import type { UploadHandler } from './types'

const logger = createScopedLogger('upload-handler-chat-widget')

/** Embedded chat-widget branding. Rendered at one fixed size, so no presets. */
export const chatWidgetHandler: UploadHandler = {
  ...UPLOAD_POLICIES.CHAT_WIDGET,
  visibility: 'PUBLIC',
  assetKind: 'THUMBNAIL',
  persist: 'asset+attachment',

  validateEntity: (ctx, init) =>
    assertRowInOrg(ctx, schema.ChatWidget, init.entityId as string, 'Chat widget'),

  /** The widget renders the original URL directly — one fixed size, no presets. */
  async onPersist(tx, _ctx, _deps, result, session) {
    if (!session.entityId || !result.externalUrl) return

    await tx
      .update(schema.ChatWidget)
      .set(logoColumnUpdate(session.metadata?.variant, result.externalUrl))
      .where(eq(schema.ChatWidget.id, session.entityId))
  },

  /**
   * The logo lives on the cached `ChatWidget` row inside the `channels` key, so
   * the next read has to be made to go and fetch it.
   *
   * **Behaviour change:** `ChatWidgetProcessor` fired this the moment its own
   * savepoint released, which was still inside the route's open transaction — a
   * reader that lost the race repopulated the cache from pre-commit state and
   * kept serving the old logo. It runs after `COMMIT` now.
   *
   * And since PR 6c it runs through `deps.cache`, so the ordering test can see
   * it. This exact call is the one the guide names as having broken the rule, and
   * a lazy `await import('../../../cache')` left it outside the journal that
   * proves the rule holds.
   */
  async afterCommit(ctx, deps, result, session) {
    if (!session.entityId || !result.externalUrl) return

    try {
      await deps.cache.bust('channel.settings_updated', { orgId: ctx.organizationId })
    } catch (error) {
      logger.error('Failed to bust the channels cache after a widget logo upload', {
        sessionId: session.id,
        organizationId: ctx.organizationId,
        error,
      })
    }
  },
}
