// @auxx/lib/kb/internal/load-article-tags.ts
import type { Database, Transaction } from '@auxx/database'
import type { RecordId } from '@auxx/types/resource'
import { batchGetArticleTagIds } from '../../field-values/relationship-queries'

type Db = Database | Transaction

/**
 * Load article tag RecordIds (`tag:tagId`) for hydrating article reads.
 * Returns `[]` if the org doesn't yet have the tag entity definition seeded
 * (migration 018 hasn't run for this org).
 */
export async function loadArticleTagRecordIds(
  db: Db,
  organizationId: string,
  articleId: string
): Promise<RecordId[]> {
  const map = await batchGetArticleTagIds(db, [articleId], organizationId)
  return (map.get(articleId) ?? []) as RecordId[]
}
