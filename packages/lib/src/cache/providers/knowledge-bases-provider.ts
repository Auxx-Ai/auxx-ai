// packages/lib/src/cache/providers/knowledge-bases-provider.ts

import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import type { CachedKnowledgeBase } from '../org-cache-keys'
import type { CacheProvider } from '../org-cache-provider'

/**
 * Every knowledge base in the org, as `{ id, kind }` — the input to
 * `viewableKnowledgeBaseIds` (plan v3/06 §5.3).
 *
 * ALL kinds are returned, `source` and `learned` included. The `kind` policy is
 * the reader's (`HIDDEN_KB_KINDS` in
 * `permissions/capabilities/article-visibility-scope.ts`), not this provider's:
 * filtering here would make the blob mean different things to a future
 * non-permission consumer, and `source` KBs still need to be *identifiable*
 * rather than absent.
 *
 * `KnowledgeBase` has no soft-delete column, so there is nothing to exclude.
 */
export const knowledgeBasesProvider: CacheProvider<CachedKnowledgeBase[]> = {
  async compute(orgId, db) {
    return db
      .select({ id: schema.KnowledgeBase.id, kind: schema.KnowledgeBase.kind })
      .from(schema.KnowledgeBase)
      .where(eq(schema.KnowledgeBase.organizationId, orgId))
  },
}
