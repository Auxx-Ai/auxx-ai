// scripts/migrate-articles-to-array-shape.ts
//
// One-shot migration: convert `ArticleRevision.contentJson` from the legacy
// Tiptap `{ type: 'doc', content: [...] }` wrapper to a bare `ArticleNodeJSON[]`.
// See plans/kb/format/contentjson-shape.md.
//
// Run with: pnpm dotenv -- npx tsx scripts/migrate-articles-to-array-shape.ts

import { closePools, database as db, schema } from '@auxx/database'
import { and, eq, isNotNull, sql } from 'drizzle-orm'

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set')
    process.exit(1)
  }

  const rows = await db
    .select({
      id: schema.ArticleRevision.id,
      contentJson: schema.ArticleRevision.contentJson,
    })
    .from(schema.ArticleRevision)
    .where(
      and(
        isNotNull(schema.ArticleRevision.contentJson),
        sql`jsonb_typeof(${schema.ArticleRevision.contentJson}) = 'object'`
      )
    )

  let converted = 0
  let skipped = 0
  const skippedIds: string[] = []

  for (const row of rows) {
    const value = row.contentJson as { type?: unknown; content?: unknown } | null
    if (value?.type === 'doc' && Array.isArray(value.content)) {
      await db
        .update(schema.ArticleRevision)
        .set({ contentJson: value.content })
        .where(eq(schema.ArticleRevision.id, row.id))
      converted += 1
    } else {
      skipped += 1
      skippedIds.push(row.id)
    }
  }

  console.log(`Scanned ${rows.length} doc-shaped revisions`)
  console.log(`  converted: ${converted}`)
  console.log(`  skipped:   ${skipped}`)
  if (skippedIds.length > 0) {
    console.log(
      `  skipped ids: ${skippedIds.slice(0, 20).join(', ')}${skippedIds.length > 20 ? ' …' : ''}`
    )
  }

  await closePools()
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
