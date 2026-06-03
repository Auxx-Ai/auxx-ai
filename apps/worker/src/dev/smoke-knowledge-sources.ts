// apps/worker/src/dev/smoke-knowledge-sources.ts
//
// Smoke-test the Phase-1 knowledge-source spine end to end against the dev DB,
// asserting Article/ArticlePlacement rows directly (embedding rides the worker
// `sync-managed` queue, which we don't run here).
//
// Proves: materialize → tree (root folder + home placements with
// linkedFromSourceId) → re-sync diff (hash bump on change, skip unchanged) →
// orphan archive → detach survives re-sync → delete keeps detached.
//
// Lives under the worker so it resolves @auxx/* via the worker's node_modules and
// runs on the worker's ESM/tsx runtime (file-type is ESM-only — a plain CJS `tsx`
// from scripts/ can't require() it). No `drizzle-orm` import: reads use the
// relational-query callback form, writes go through lib functions. Run from root:
//   pnpm dotenv -- node --conditions source --import tsx/esm \
//     apps/worker/src/dev/smoke-knowledge-sources.ts [--kb <id>]
//
// With no --kb it auto-picks the most recently created KnowledgeBase.

import { closePools, database as db } from '@auxx/database'
import { deleteArticle, detachArticleFromSource } from '@auxx/lib/kb'
import {
  createSource,
  deleteSource,
  getSource,
  runSourceSync,
  updateSource,
} from '@auxx/lib/knowledge-sources'

const arg = (flag: string) => {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

let failures = 0
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ✅ ${label}`)
  } else {
    failures++
    console.log(`  ❌ ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
  }
}

function section(title: string) {
  console.log(`\n— ${title}`)
}

async function articlesForSource(sourceId: string) {
  return db.query.Article.findMany({
    where: (a, { eq }) => eq(a.sourceId, sourceId),
    columns: {
      id: true,
      title: true,
      articleKind: true,
      status: true,
      managed: true,
      sourceExternalId: true,
      sourceContentHash: true,
    },
  })
}

async function placementsForArticles(articleIds: string[]) {
  if (articleIds.length === 0) return []
  return db.query.ArticlePlacement.findMany({
    where: (p, { inArray }) => inArray(p.articleId, articleIds),
    columns: {
      id: true,
      articleId: true,
      parentId: true,
      isPublished: true,
      linkedFromSourceId: true,
    },
  })
}

async function main() {
  // ── Setup: pick a target KB + its org ────────────────────────────────────
  const kbId = arg('--kb')
  const kb = kbId
    ? await db.query.KnowledgeBase.findFirst({ where: (k, { eq }) => eq(k.id, kbId) })
    : await db.query.KnowledgeBase.findFirst({ orderBy: (k, { desc }) => [desc(k.createdAt)] })
  if (!kb) {
    console.error('No KnowledgeBase found. Pass --kb <id> or seed a KB first.')
    process.exit(1)
  }
  const orgId = kb.organizationId
  console.log(`Target KB: ${kb.name ?? kb.id} (${kb.id}) — org ${orgId}`)

  const ITEM_A = {
    externalId: 'smoke-a',
    title: 'Smoke Article A',
    markdown: '# Smoke Article A\n\nFirst version of A.',
  }
  const ITEM_B = {
    externalId: 'smoke-b',
    title: 'Smoke Article B',
    markdown: '# Smoke Article B\n\nFirst version of B.',
  }
  const kbCtx = { db, organizationId: orgId }

  let sourceId = ''
  try {
    // ── 1. Create + initial sync ────────────────────────────────────────────
    section('1. Create manual source (2 items) → runSourceSync')
    const source = await createSource(db, orgId, {
      name: `Smoke Test Source ${kb.id.slice(-6)}`,
      type: 'manual',
      targetKnowledgeBaseId: kb.id,
      surface: 'publishable',
      config: { items: [ITEM_A, ITEM_B] },
      createdById: kb.createdById,
    })
    sourceId = source.id
    await runSourceSync(db, orgId, sourceId)

    const afterSync = await getSource(db, orgId, sourceId)
    check("source status='live'", afterSync.status === 'live', afterSync.status)
    check('source itemCount=2', afterSync.itemCount === 2, afterSync.itemCount)
    check('source.rootFolderArticleId set', !!afterSync.rootFolderArticleId)

    let arts = await articlesForSource(sourceId)
    const pages = arts.filter((a) => a.articleKind === 'page')
    const folders = arts.filter((a) => a.articleKind === 'category')
    check(
      '2 managed page articles',
      pages.length === 2,
      pages.map((a) => a.title)
    )
    check(
      '1 root category folder',
      folders.length === 1,
      folders.map((a) => a.title)
    )
    check(
      'all source articles managed=true',
      arts.every((a) => a.managed),
      arts.map((a) => ({ t: a.title, m: a.managed }))
    )
    check(
      'page articles are DRAFT',
      pages.every((a) => a.status === 'DRAFT'),
      pages.map((a) => a.status)
    )

    const rootId = afterSync.rootFolderArticleId
    const placements = await placementsForArticles(arts.map((a) => a.id))
    const rootPlacement = placements.find((p) => p.articleId === rootId)
    const pagePlacements = placements.filter((p) => pages.some((a) => a.id === p.articleId))
    check(
      'every placement linkedFromSourceId=source.id',
      placements.length > 0 && placements.every((p) => p.linkedFromSourceId === sourceId),
      placements.map((p) => p.linkedFromSourceId)
    )
    check(
      'page placements parented under root folder placement',
      !!rootPlacement && pagePlacements.every((p) => p.parentId === rootPlacement.id),
      { root: rootPlacement?.id, parents: pagePlacements.map((p) => p.parentId) }
    )
    check(
      'page placements unpublished (DRAFT)',
      pagePlacements.every((p) => !p.isPublished)
    )

    const hashA1 = pages.find((a) => a.sourceExternalId === 'smoke-a')?.sourceContentHash
    const hashB1 = pages.find((a) => a.sourceExternalId === 'smoke-b')?.sourceContentHash
    check('both pages have a content hash', !!hashA1 && !!hashB1)

    // ── 2. Edit one item → re-sync → hash bump on A, skip B ──────────────────
    section('2. Edit item A markdown → re-sync → A changed, B hash-skipped')
    await updateSource(db, orgId, sourceId, {
      config: {
        items: [
          { ...ITEM_A, markdown: '# Smoke Article A\n\nSECOND version of A — edited.' },
          ITEM_B,
        ],
      },
    })
    await runSourceSync(db, orgId, sourceId)

    arts = await articlesForSource(sourceId)
    const hashA2 = arts.find((a) => a.sourceExternalId === 'smoke-a')?.sourceContentHash
    const hashB2 = arts.find((a) => a.sourceExternalId === 'smoke-b')?.sourceContentHash
    check('A content hash changed', !!hashA2 && hashA2 !== hashA1, { hashA1, hashA2 })
    check('B content hash unchanged (skipped)', hashB2 === hashB1, { hashB1, hashB2 })

    // ── 3. Remove an item → re-sync → archived ───────────────────────────────
    section('3. Remove item B → re-sync → B archived')
    await updateSource(db, orgId, sourceId, {
      config: {
        items: [{ ...ITEM_A, markdown: '# Smoke Article A\n\nSECOND version of A — edited.' }],
      },
    })
    await runSourceSync(db, orgId, sourceId)

    arts = await articlesForSource(sourceId)
    const bAfter = arts.find((a) => a.sourceExternalId === 'smoke-b')
    check('B archived', bAfter?.status === 'ARCHIVED', bAfter?.status)
    const aAfter = arts.find((a) => a.sourceExternalId === 'smoke-a')
    check('A still DRAFT (not archived)', aAfter?.status === 'DRAFT', aAfter?.status)

    // ── 4. Detach A → re-sync → A survives, skipped ──────────────────────────
    section('4. Detach A → re-sync (A edited upstream) → A untouched')
    const aId = aAfter?.id
    if (!aId) throw new Error('Article A not found — cannot continue detach checks')
    await detachArticleFromSource(kbCtx, aId)
    const aDetached = await db.query.Article.findFirst({
      where: (a, { eq }) => eq(a.id, aId),
      columns: { managed: true, sourceId: true },
    })
    check('A managed=false after detach', aDetached?.managed === false, aDetached)
    check('A keeps sourceId (provenance)', aDetached?.sourceId === sourceId)
    const aPlacementsDetached = await placementsForArticles([aId])
    check(
      'A placements linkedFromSourceId cleared',
      aPlacementsDetached.every((p) => p.linkedFromSourceId === null)
    )

    const hashA3 = (await articlesForSource(sourceId)).find((a) => a.id === aId)?.sourceContentHash
    await updateSource(db, orgId, sourceId, {
      config: {
        items: [{ ...ITEM_A, markdown: '# Smoke Article A\n\nTHIRD version — should be skipped.' }],
      },
    })
    await runSourceSync(db, orgId, sourceId)

    const aResynced = (await articlesForSource(sourceId)).find((a) => a.id === aId)
    check(
      'A hash unchanged after detach re-sync (skipped)',
      aResynced?.sourceContentHash === hashA3
    )
    check('A still managed=false', aResynced?.managed === false)
    check('A not archived despite upstream churn', aResynced?.status === 'DRAFT', aResynced?.status)

    // ── 5. Delete source → managed gone, detached survives ───────────────────
    // NOTE: Article.sourceId is `onDelete: set null`, so deleting the source nulls
    // the survivor's sourceId — we re-find the detached article by id, not sourceId.
    section('5. Delete source → managed removed, detached A survives')
    const managedIdsBeforeDelete = (await articlesForSource(sourceId))
      .filter((a) => a.managed)
      .map((a) => a.id)
    await deleteSource(db, orgId, sourceId)
    const sourceGone = await db.query.KnowledgeSource.findFirst({
      where: (s, { eq }) => eq(s.id, sourceId),
    })
    check('source row deleted', !sourceGone)
    const stillManaged = await db.query.Article.findMany({
      where: (a, { inArray }) => inArray(a.id, managedIdsBeforeDelete),
      columns: { id: true },
    })
    check('all managed articles + folder hard-deleted', stillManaged.length === 0, stillManaged)
    const survivor = await db.query.Article.findFirst({
      where: (a, { eq }) => eq(a.id, aId),
      columns: { id: true, managed: true, sourceId: true, articleKind: true },
    })
    check('detached A survives delete (managed=false)', survivor?.managed === false, survivor)
    check('detached A sourceId nulled by FK on source delete', survivor?.sourceId === null)

    // ── Cleanup: drop the surviving detached A ────────────────────────────────
    section('Cleanup')
    await deleteArticle(kbCtx, aId)
    console.log('  🧹 removed detached article A')
  } finally {
    // Belt-and-suspenders: if we bailed mid-run, drop the source (cascades managed
    // articles) + any detached leftovers.
    if (sourceId) {
      const stillThere = await db.query.KnowledgeSource.findFirst({
        where: (s, { eq }) => eq(s.id, sourceId),
      })
      if (stillThere) {
        await deleteSource(db, orgId, sourceId)
        const leftover = await articlesForSource(sourceId)
        for (const a of leftover) await deleteArticle({ db, organizationId: orgId }, a.id)
        console.log('  🧹 cleaned up source after early exit')
      }
    }
  }

  console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`}`)
  await closePools()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (err) => {
  console.error('\n💥 Smoke test threw:', err)
  await closePools()
  process.exit(1)
})
