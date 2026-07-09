// packages/lib/src/kb/learned/provenance.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'

const logger = createScopedLogger('learned-provenance')

/** Newest entries win; older evidence rolls off. Audit trail, not dedupe. */
const PROVENANCE_CAP = 50

/**
 * One "why does the AI believe this" evidence pointer on a learned article:
 * the thread that taught it and the approved suggestion bundle that wrote it.
 */
export interface LearnedProvenanceEntry {
  threadId: string
  /** ISO timestamp of when the extraction ran (bundle creation time). */
  extractedAt: string
  suggestionId: string
}

/**
 * Append a provenance entry to a learned article's `learnedProvenance` list,
 * capped to the newest {@link PROVENANCE_CAP}. Called from the bundle apply
 * path after a successful `upsert_learned_article` execution. Never throws —
 * a missed audit entry must not fail an otherwise-applied bundle.
 */
export async function appendLearnedProvenance(
  db: Database | Transaction,
  args: { organizationId: string; articleId: string; entry: LearnedProvenanceEntry }
): Promise<void> {
  try {
    const row = await db.query.Article.findFirst({
      where: and(
        eq(schema.Article.id, args.articleId),
        eq(schema.Article.organizationId, args.organizationId)
      ),
      columns: { learnedProvenance: true },
    })
    if (!row) {
      logger.warn('Article not found for provenance stamp', { articleId: args.articleId })
      return
    }
    const existing = Array.isArray(row.learnedProvenance)
      ? (row.learnedProvenance as LearnedProvenanceEntry[])
      : []
    const next = [...existing, args.entry].slice(-PROVENANCE_CAP)
    await db
      .update(schema.Article)
      .set({ learnedProvenance: next })
      .where(eq(schema.Article.id, args.articleId))
  } catch (error) {
    logger.warn('Failed to stamp learned provenance', {
      articleId: args.articleId,
      error: (error as Error).message,
    })
  }
}
