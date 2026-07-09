// packages/lib/scripts/backfill-kb-segment-links.ts
//
// One-off backfill: populate `metadata.links[]` on existing KB-article
// Documents and their DocumentSegments. Segments written before the
// collect-references fix carry `links: []` (initialized but never populated),
// and the sync pipeline's hash-skip means re-enqueueing sync jobs won't
// rewrite them for unchanged content. This derives links from each article's
// current content and jsonb-merges them in place — no re-embed.
//   npx dotenv -- node --conditions source --import tsx/esm packages/lib/scripts/backfill-kb-segment-links.ts
//
// Idempotent; safe to re-run.

import { database as db, schema } from '@auxx/database'
import { and, eq, sql } from 'drizzle-orm'
import { collectRecordLinks } from '../src/kb/markdown/collect-references'
import type { ArticleNodeJSON } from '../src/kb/markdown/types'

async function main() {
  const docs = (
    await db.execute(sql`
      SELECT id, "organizationId", metadata->'kb'->>'articleId' AS "articleId"
      FROM "Document"
      WHERE metadata->>'contentSource' = 'kb-article'
        AND metadata->'kb'->>'articleId' IS NOT NULL
    `)
  ).rows as Array<{ id: string; organizationId: string; articleId: string }>

  console.log(`Found ${docs.length} KB-article documents`)

  let updated = 0
  let skippedNoLinks = 0
  let skippedNoArticle = 0

  for (const doc of docs) {
    const article = await db.query.Article.findFirst({
      where: and(
        eq(schema.Article.id, doc.articleId),
        eq(schema.Article.organizationId, doc.organizationId)
      ),
      with: { draftRevision: true },
    })
    if (!article) {
      skippedNoArticle++
      continue
    }

    // Mirror the sync pipeline's revision choice: managed (source-owned)
    // articles embed their draft; standard articles embed the home
    // placement's published revision, falling back to the draft.
    let revision = article.draftRevision
    if (!article.managed) {
      const homePlacement = await db.query.ArticlePlacement.findFirst({
        where: and(
          eq(schema.ArticlePlacement.articleId, article.id),
          eq(schema.ArticlePlacement.knowledgeBaseId, article.homeKnowledgeBaseId)
        ),
        with: { publishedRevision: true },
      })
      revision = homePlacement?.publishedRevision ?? article.draftRevision
    }
    if (!revision) {
      skippedNoArticle++
      continue
    }

    const links = collectRecordLinks(revision.contentJson as ArticleNodeJSON[] | null)
    if (links.length === 0) {
      skippedNoLinks++
      continue
    }

    const linksJson = JSON.stringify(links)
    await Promise.all([
      db
        .update(schema.DocumentSegment)
        .set({
          metadata: sql`
            COALESCE(${schema.DocumentSegment.metadata}, '{}'::jsonb) ||
            jsonb_build_object('links', ${linksJson}::jsonb)
          `,
          updatedAt: new Date(),
        })
        .where(eq(schema.DocumentSegment.documentId, doc.id)),
      db
        .update(schema.Document)
        .set({
          metadata: sql`
            jsonb_set(
              COALESCE(${schema.Document.metadata}, '{}'::jsonb),
              '{kb,links}',
              ${linksJson}::jsonb
            )
          `,
          updatedAt: new Date(),
        })
        .where(eq(schema.Document.id, doc.id)),
    ])
    updated++
  }

  console.log(
    `Done. Updated ${updated} documents, ${skippedNoLinks} had no record references, ${skippedNoArticle} had no resolvable article/revision.`
  )
  process.exit(0)
}

void main()
