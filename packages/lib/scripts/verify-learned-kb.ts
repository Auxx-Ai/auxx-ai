// packages/lib/scripts/verify-learned-kb.ts
//
// One-off live verify for learned-KB Phases 1+2 (ensureLearnedKb +
// upsert_learned_article). Drives the real dev DB:
//   1. provisions the learned KB (twice — idempotency check)
//   2. creates a policies article through the tool executor
//   3. updates the same article through the tool executor
//   4. checks the KB catalog includes the learned KB + article
//   npx dotenv -- node --conditions source --import tsx/esm packages/lib/scripts/verify-learned-kb.ts

import { database as db, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { createUpsertLearnedArticleTool } from '../src/ai/kopilot/capabilities/learned/tools/upsert-learned-article'
import { deleteArticle } from '../src/kb/articles/delete-article'
import { computeKbCatalog } from '../src/kb/catalog/kb-catalog'
import { ensureLearnedKb } from '../src/kb/learned/ensure-learned-kb'

async function main() {
  // Pick the org that owns standard KBs (the main dev org).
  const anyKb = await db.query.KnowledgeBase.findFirst({
    where: eq(schema.KnowledgeBase.kind, 'standard'),
    columns: { organizationId: true },
  })
  if (!anyKb) throw new Error('No standard KB found — no dev org to verify against')
  const organizationId = anyKb.organizationId
  const ctx = { db, organizationId }
  console.log(`org: ${organizationId}`)

  // 1. Provision + idempotency
  const first = await ensureLearnedKb(ctx)
  console.log(`learned KB: ${first.kb.id} slug=${first.kb.slug} kind=${first.kb.kind}`)
  console.log(`categories:`, first.categoryIds)
  const second = await ensureLearnedKb(ctx)
  if (second.kb.id !== first.kb.id) throw new Error('NOT IDEMPOTENT: second call made a new KB')
  if (JSON.stringify(second.categoryIds) !== JSON.stringify(first.categoryIds)) {
    throw new Error('NOT IDEMPOTENT: category ids changed')
  }
  console.log('idempotency: OK')

  // 2. Create via tool executor
  const tool = createUpsertLearnedArticleTool(() => ({ db }) as never)
  const agentDeps = { organizationId, userId: first.kb.createdById } as never
  const createRes = await tool.execute(
    {
      category: 'policies',
      title: 'Verify Learned KB Test',
      description: 'Throwaway verify article — safe to delete.',
      markdown: '# Verify Learned KB Test\n\nInitial content from the verify script.',
    },
    agentDeps
  )
  console.log('create:', JSON.stringify(createRes))
  if (!createRes.success) throw new Error('create failed')
  const articleId = (createRes.output as { articleId: string }).articleId

  // 3. Update via tool executor (merged full markdown)
  const updateRes = await tool.execute(
    {
      articleId,
      title: 'Verify Learned KB Test',
      description: 'Throwaway verify article — safe to delete (updated).',
      markdown:
        '# Verify Learned KB Test\n\nInitial content from the verify script.\n\n## Update pass\n\nMerged content preserved.',
    },
    agentDeps
  )
  console.log('update:', JSON.stringify(updateRes))
  if (!updateRes.success) throw new Error('update failed')

  // Published revision should exist and carry the updated description.
  const placement = await db.query.ArticlePlacement.findFirst({
    where: eq(schema.ArticlePlacement.articleId, articleId),
    with: { publishedRevision: true },
  })
  const pub = placement?.publishedRevision
  console.log(
    `published revision: v${pub?.versionNumber} description="${pub?.description}" hasUnpublished=${placement?.hasUnpublishedChanges}`
  )
  if (!pub || pub.description !== 'Throwaway verify article — safe to delete (updated).') {
    throw new Error('published revision does not reflect the update')
  }

  // 4. Catalog includes the learned KB, its categories, and the article
  const catalog = await computeKbCatalog(organizationId, db)
  const learnedEntry = catalog.find((kb) => kb.id === first.kb.id)
  if (!learnedEntry) throw new Error('learned KB missing from catalog')
  console.log(
    'catalog articles:',
    learnedEntry.articles.map((a) => `${'  '.repeat(a.depth)}${a.title} — ${a.description ?? ''}`)
  )
  const inCatalog = learnedEntry.articles.some((a) => a.id === articleId)
  if (!inCatalog) throw new Error('verify article missing from catalog')

  // Clean up: the learned KB + categories stay (real provisioning), the
  // throwaway article goes so it never pollutes the injected catalog.
  await deleteArticle(ctx, articleId)
  console.log(`cleaned up verify article ${articleId}`)

  console.log('ALL CHECKS PASSED')
  process.exit(0)
}

void main().catch((err) => {
  console.error(err)
  process.exit(1)
})
