// apps/worker/src/dev/smoke-knowledge-sources.ts
//
// Smoke-test the knowledge-source spine end to end against the dev DB, asserting
// Article/ArticlePlacement rows directly (embedding rides the worker `sync-managed`
// queue, which we don't run here).
//
// Proves the source-owns-KB model: a source provisions its own hidden KB →
// materialize there (root folder + home placements, linkedFromSourceId) → re-sync
// diff (hash bump / skip) → link into a real KB (placements fan out, tree preserved)
// → re-sync adds new items to the linked KB → unlink drops them → orphan archive →
// detach survives re-sync → delete removes the source, its owned KB, and all content.
//
// Lives under the worker so it resolves @auxx/* via the worker's node_modules and
// runs on the worker's ESM/tsx runtime (file-type is ESM-only — a plain CJS `tsx`
// from scripts/ can't require() it). No `drizzle-orm` import: reads use the
// relational-query callback form, writes go through lib functions. Run from root:
//   pnpm dotenv -- node --conditions source --import tsx/esm \
//     apps/worker/src/dev/smoke-knowledge-sources.ts [--kb <id>]
//
// With no --kb it auto-picks the most recently created standard KnowledgeBase to
// link the source into.

import { closePools, database as db } from '@auxx/database'
import { detachArticleFromSource } from '@auxx/lib/kb'
import {
  createSource,
  deleteSource,
  getSource,
  linkSourceToKb,
  listSourceLinks,
  runSourceSync,
  unlinkSourceFromKb,
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
      knowledgeBaseId: true,
      parentId: true,
      isPublished: true,
      linkedFromSourceId: true,
    },
  })
}

async function main() {
  // ── Setup: pick a standard KB to link into + its org ──────────────────────
  const kbId = arg('--kb')
  const kb = kbId
    ? await db.query.KnowledgeBase.findFirst({ where: (k, { eq }) => eq(k.id, kbId) })
    : await db.query.KnowledgeBase.findFirst({
        where: (k, { eq }) => eq(k.kind, 'standard'),
        orderBy: (k, { desc }) => [desc(k.createdAt)],
      })
  if (!kb) {
    console.error('No standard KnowledgeBase found. Pass --kb <id> or seed a KB first.')
    process.exit(1)
  }
  const orgId = kb.organizationId
  const linkKbId = kb.id
  console.log(`Link target KB: ${kb.name ?? kb.id} (${kb.id}) — org ${orgId}`)

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
  const ITEM_C = {
    externalId: 'smoke-c',
    title: 'Smoke Article C',
    markdown: '# Smoke Article C\n\nAdded later.',
  }
  const kbCtx = { db, organizationId: orgId }

  let sourceId = ''
  let ownedKbId = ''
  try {
    // ── 1. Create standalone source + initial sync ────────────────────────────
    section('1. Create manual source (2 items) → provisions its own KB → runSourceSync')
    const source = await createSource(db, orgId, {
      name: `Smoke Test Source ${kb.id.slice(-6)}`,
      type: 'manual',
      surface: 'publishable',
      config: { items: [ITEM_A, ITEM_B] },
      createdById: kb.createdById,
    })
    sourceId = source.id
    ownedKbId = source.ownedKnowledgeBaseId
    check('source owns a KB', !!ownedKbId && ownedKbId !== linkKbId, ownedKbId)
    const ownedKb = await db.query.KnowledgeBase.findFirst({
      where: (k, { eq }) => eq(k.id, ownedKbId),
      columns: { kind: true, datasetId: true },
    })
    check("owned KB kind='source'", ownedKb?.kind === 'source', ownedKb?.kind)
    check('owned KB has a managed dataset', !!ownedKb?.datasetId)

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
      arts.every((a) => a.managed)
    )

    const rootId = afterSync.rootFolderArticleId
    let placements = await placementsForArticles(arts.map((a) => a.id))
    check(
      'all placements home in the owned KB',
      placements.length > 0 && placements.every((p) => p.knowledgeBaseId === ownedKbId),
      placements.map((p) => p.knowledgeBaseId)
    )
    check(
      'every home placement linkedFromSourceId=source.id',
      placements.every((p) => p.linkedFromSourceId === sourceId)
    )
    const rootPlacement = placements.find((p) => p.articleId === rootId)
    const pagePlacements = placements.filter((p) => pages.some((a) => a.id === p.articleId))
    check(
      'page placements parented under root folder placement',
      !!rootPlacement && pagePlacements.every((p) => p.parentId === rootPlacement.id)
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

    // ── 3. Link into the standard KB → placements materialize there ──────────
    section('3. Link source into the standard KB → placements fan out, tree preserved')
    await linkSourceToKb(db, orgId, sourceId, linkKbId)
    arts = await articlesForSource(sourceId)
    placements = await placementsForArticles(arts.map((a) => a.id))
    const inLinkKb = placements.filter((p) => p.knowledgeBaseId === linkKbId)
    check('all 3 articles linked into the standard KB', inLinkKb.length === arts.length, {
      linked: inLinkKb.length,
      total: arts.length,
    })
    check(
      'linked placements carry linkedFromSourceId',
      inLinkKb.every((p) => p.linkedFromSourceId === sourceId)
    )
    const linkRootPlacement = inLinkKb.find((p) => p.articleId === rootId)
    const linkPagePlacements = inLinkKb.filter((p) => pages.some((a) => a.id === p.articleId))
    check(
      'linked tree preserved (pages under root in the linked KB)',
      !!linkRootPlacement && linkPagePlacements.every((p) => p.parentId === linkRootPlacement.id)
    )
    const links = await listSourceLinks(db, orgId, sourceId)
    check(
      'listSourceLinks reports the linked KB',
      links.some((l) => l.id === linkKbId),
      links
    )

    // ── 4. Add item C → re-sync → fan-out places C in the linked KB ──────────
    section('4. Add item C → re-sync → C homes in owned KB and fans out to the linked KB')
    await updateSource(db, orgId, sourceId, {
      config: {
        items: [
          { ...ITEM_A, markdown: '# Smoke Article A\n\nSECOND version of A — edited.' },
          ITEM_B,
          ITEM_C,
        ],
      },
    })
    await runSourceSync(db, orgId, sourceId)
    arts = await articlesForSource(sourceId)
    const cArticle = arts.find((a) => a.sourceExternalId === 'smoke-c')
    check('C article created', !!cArticle)
    const cPlacements = await placementsForArticles(cArticle ? [cArticle.id] : [])
    check(
      'C homes in owned KB',
      cPlacements.some((p) => p.knowledgeBaseId === ownedKbId)
    )
    check(
      'C fanned out into the linked KB',
      cPlacements.some((p) => p.knowledgeBaseId === linkKbId && p.linkedFromSourceId === sourceId)
    )

    // ── 5. Unlink from the standard KB → linked placements removed ───────────
    section('5. Unlink from the standard KB → linked placements gone, owned KB intact')
    await unlinkSourceFromKb(db, orgId, sourceId, linkKbId)
    arts = await articlesForSource(sourceId)
    placements = await placementsForArticles(arts.map((a) => a.id))
    check(
      'no placements remain in the unlinked KB',
      placements.every((p) => p.knowledgeBaseId !== linkKbId)
    )
    check(
      'owned-KB placements survive the unlink',
      placements.some((p) => p.knowledgeBaseId === ownedKbId)
    )

    // ── 6. Remove an item → re-sync → archived ───────────────────────────────
    section('6. Remove item B → re-sync → B archived')
    await updateSource(db, orgId, sourceId, {
      config: {
        items: [
          { ...ITEM_A, markdown: '# Smoke Article A\n\nSECOND version of A — edited.' },
          ITEM_C,
        ],
      },
    })
    await runSourceSync(db, orgId, sourceId)
    arts = await articlesForSource(sourceId)
    const bAfter = arts.find((a) => a.sourceExternalId === 'smoke-b')
    check('B archived', bAfter?.status === 'ARCHIVED', bAfter?.status)

    // ── 7. Detach A → re-sync → A survives, skipped ──────────────────────────
    section('7. Detach A → re-sync (A edited upstream) → A untouched')
    const aId = arts.find((a) => a.sourceExternalId === 'smoke-a')?.id
    if (!aId) throw new Error('Article A not found — cannot continue detach checks')
    await detachArticleFromSource(kbCtx, aId)
    const aDetached = await db.query.Article.findFirst({
      where: (a, { eq }) => eq(a.id, aId),
      columns: { managed: true, sourceId: true },
    })
    check('A managed=false after detach', aDetached?.managed === false, aDetached)
    check('A keeps sourceId (provenance)', aDetached?.sourceId === sourceId)

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

    // ── 8. Delete source → owned KB + ALL its content removed ────────────────
    section('8. Delete source → owned KB, all articles (incl. detached), and links gone')
    const allIdsBeforeDelete = (await articlesForSource(sourceId)).map((a) => a.id)
    await deleteSource(db, orgId, sourceId)
    const sourceGone = await db.query.KnowledgeSource.findFirst({
      where: (s, { eq }) => eq(s.id, sourceId),
    })
    check('source row deleted', !sourceGone)
    const ownedKbGone = await db.query.KnowledgeBase.findFirst({
      where: (k, { eq }) => eq(k.id, ownedKbId),
    })
    check('owned source-KB deleted', !ownedKbGone)
    const remaining = await db.query.Article.findMany({
      where: (a, { inArray }) => inArray(a.id, allIdsBeforeDelete),
      columns: { id: true },
    })
    check('all source content (incl. detached A) hard-deleted', remaining.length === 0, remaining)
  } finally {
    // Belt-and-suspenders: if we bailed mid-run, drop the source (cascades its owned
    // KB + all articles).
    if (sourceId) {
      const stillThere = await db.query.KnowledgeSource.findFirst({
        where: (s, { eq }) => eq(s.id, sourceId),
      })
      if (stillThere) {
        await deleteSource(db, orgId, sourceId)
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
