// packages/lib/src/kb/learned/get-learned-provenance.ts

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import type { LearnedProvenanceEntry } from './provenance'

/** One conversation a memory article was learned from. */
export interface LearnedProvenanceSource {
  threadId: string
  subject: string | null
  /** ISO timestamp of the most recent extraction that cited this thread. */
  extractedAt: string
}

/**
 * The conversations behind a memory article — "why does the AI believe this".
 *
 * `Article.learnedProvenance` has been an append-only audit column with no
 * reader since it shipped; this is that reader. Deduped by thread (a reopened
 * conversation can teach the same article twice), newest first.
 */
export async function getLearnedProvenance(
  db: Database,
  params: { organizationId: string; articleId: string }
): Promise<LearnedProvenanceSource[]> {
  const article = await db.query.Article.findFirst({
    where: and(
      eq(schema.Article.id, params.articleId),
      eq(schema.Article.organizationId, params.organizationId)
    ),
    columns: { learnedProvenance: true },
  })
  const entries = (article?.learnedProvenance as LearnedProvenanceEntry[] | null) ?? []
  if (entries.length === 0) return []

  const latestByThread = new Map<string, string>()
  for (const entry of entries) {
    if (!entry?.threadId) continue
    const seen = latestByThread.get(entry.threadId)
    if (!seen || entry.extractedAt > seen) latestByThread.set(entry.threadId, entry.extractedAt)
  }
  const threadIds = [...latestByThread.keys()]
  if (threadIds.length === 0) return []

  const threads = await db
    .select({ id: schema.Thread.id, subject: schema.Thread.subject })
    .from(schema.Thread)
    .where(
      and(
        inArray(schema.Thread.id, threadIds),
        eq(schema.Thread.organizationId, params.organizationId)
      )
    )
  const subjectById = new Map(threads.map((t) => [t.id, t.subject]))

  return (
    threadIds
      .map((threadId) => ({
        threadId,
        subject: subjectById.get(threadId) ?? null,
        extractedAt: latestByThread.get(threadId) as string,
      }))
      // A deleted thread keeps its entry: "learned from a conversation that no
      // longer exists" is still the honest answer to why the article says what
      // it says.
      .sort((a, b) => b.extractedAt.localeCompare(a.extractedAt))
  )
}
