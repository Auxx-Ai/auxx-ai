// packages/lib/src/files/upload/handlers/knowledge-base.ts

import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { UPLOAD_POLICIES } from '../../types/entities'
import { assertRowInOrg, logoColumnUpdate } from './shared'
import type { UploadHandler } from './types'

/** Knowledge-base branding: the light and dark logo variants. */
export const knowledgeBaseHandler: UploadHandler = {
  ...UPLOAD_POLICIES.KNOWLEDGE_BASE,
  visibility: 'PUBLIC',
  assetKind: 'THUMBNAIL',
  persist: 'asset+attachment',

  validateEntity: (ctx, init) =>
    assertRowInOrg(ctx, schema.KnowledgeBase, init.entityId as string, 'Knowledge base'),

  /**
   * Point the KB at the original object immediately, so the logo renders before
   * the `kb-logo-*` presets land.
   *
   * Guarded on `externalUrl` because a PUBLIC upload whose CDN URL could not be
   * built carries `''`, and writing that would blank an existing logo.
   */
  async onPersist(tx, _ctx, _deps, result, session) {
    if (!session.entityId || !result.externalUrl) return

    await tx
      .update(schema.KnowledgeBase)
      .set(logoColumnUpdate(session.metadata?.variant, result.externalUrl))
      .where(eq(schema.KnowledgeBase.id, session.entityId))
  },

  thumbnails: { presets: ['kb-logo-sm', 'kb-logo-lg'] },
}
