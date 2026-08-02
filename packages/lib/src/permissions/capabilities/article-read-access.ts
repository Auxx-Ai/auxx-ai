// packages/lib/src/permissions/capabilities/article-read-access.ts

import { type Database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { viewableKnowledgeBaseIds } from './article-visibility-scope'
import type { CapabilityView } from './capability-view'

/**
 * **The ONE boolean article/KB read gate** — the in-memory twin of
 * {@link import('./article-visibility-scope').articleVisibilitySql} (plan v3/06
 * §2.5 / P5).
 *
 * `article-visibility-scope.ts` owns the *rule*: which KBs a viewer may read
 * (`viewableKnowledgeBaseIds`, including the `kind: 'source'` exclusion), the
 * SQL predicate for the record lane, and the `_access` rung folds. What it does
 * NOT own is the shape every non-record-lane reader actually needs: a yes/no
 * answer for one KB id, or for one article reached through its placements. That
 * shape was hand-rolled **six times in six spellings** — the finding this phase
 * exists to close:
 *
 * | # | Reader | Was |
 * |---|---|---|
 * | I1 | `routers/kb.ts` | `assertViewInstance('kb', kbId)` × 39 |
 * | I2 | Kopilot `kb-access.ts` | `canViewInstance`, home-keyed |
 * | I3 | `apps/kb` `canViewKB` | its own `getCapabilities` + `canViewInstance` |
 * | I4 | the article SSE route | `canViewInstance('kb', home)` |
 * | I5 | `attachment-visibility.ts` | `canViewInstance('kb', home)` |
 * | I6 | `assertCanReadSource` | `kbIds.some(canViewInstance)` |
 *
 * Six spellings with no shared code is why three FURTHER readers (the records
 * lane, the `.md` preview route, the dashboard aggregate) forgot the rule
 * entirely without anyone noticing. I2–I6 now call this module; I1 keeps
 * `assertViewInstance` because it is a KB-keyed *throwing* router assert on a KB
 * the caller named explicitly, not an article-inheritance question.
 *
 * ## Reads are placement-permissive; writes are not
 *
 * An article homed in a hidden `source` KB and *linked into* a standard KB the
 * member holds stays readable (§5.2) — {@link canReadArticle} answers on
 * `placements ∪ home`. Content **writes** stay home-strict (§7.3, closed as such
 * in §11 item 3) and belong on `articleWriteRung` / `assertEditInstance`, never
 * here: a draft revision is shared across every placement, so editing through a
 * linked placement mutates content the home KB owns.
 *
 * ## What is deliberately NOT narrowed
 *
 * `search_knowledge` and agent retrieval read a KB's **managed `Dataset`**, not
 * `Article` rows (§8.2 / A4). Agents run under their own published policy, not
 * the invoking member's, so narrowing retrieval by the invoker's KB grants would
 * break ticket answering for every member on a narrow profile. **Do not "finish
 * the job" by pointing that path here.**
 */

/**
 * A resolved, reusable read scope: one cached KB read + one fold, then pure
 * predicates.
 *
 * Resolve it ONCE per request and reuse it. The per-call convenience wrappers
 * below re-resolve, which is right for a single point read and wrong inside a
 * loop — `list_articles` filters up to 200 rows and would otherwise pay 200
 * cache round trips for one answer.
 */
export interface ArticleReadScope {
  /**
   * `true` ⇒ there is **no viewer** — an internal/headless caller (worker,
   * seeder, embedding job, `apps/kb` render, widget API). Every predicate
   * returns `true`.
   *
   * ⚠ This is "no viewer", never "a viewer who happens to hold everything". A
   * real member is always folded through the `kind` policy, because `source`
   * KBs are excluded for every principal including OWNER (§8.0).
   */
  readonly unrestricted: boolean
  /** The allow-list, for callers that need the ids themselves. */
  readonly knowledgeBaseIds: ReadonlySet<string>
  /** May the viewer read this knowledge base? */
  canReadKnowledgeBase(knowledgeBaseId: string | null | undefined): boolean
  /**
   * May the viewer read an article reachable through these KBs? Pass the
   * article's **placements ∪ home** — any one viewable KB admits the row.
   */
  canReadArticleIn(knowledgeBaseIds: Iterable<string | null | undefined>): boolean
}

/**
 * Resolve the viewer's article/KB read scope. One cached org read; the
 * capability lookups are in-memory on the already-composed blob.
 */
export async function resolveArticleReadScope(
  organizationId: string,
  capabilities: CapabilityView | undefined
): Promise<ArticleReadScope> {
  const viewable = await viewableKnowledgeBaseIds(organizationId, capabilities)
  if (viewable === 'all') {
    return {
      unrestricted: true,
      knowledgeBaseIds: new Set<string>(),
      canReadKnowledgeBase: () => true,
      canReadArticleIn: () => true,
    }
  }
  const knowledgeBaseIds = new Set(viewable)
  const canReadKnowledgeBase = (id: string | null | undefined) => !!id && knowledgeBaseIds.has(id)
  return {
    unrestricted: false,
    knowledgeBaseIds,
    canReadKnowledgeBase,
    canReadArticleIn: (ids) => {
      for (const id of ids) if (canReadKnowledgeBase(id)) return true
      return false
    },
  }
}

/**
 * May the viewer read this knowledge base? The KB-keyed half of the rule — used
 * by `apps/kb`'s site gate (I3), Kopilot's `list_articles` filter (I2) and the
 * knowledge-source read guard (I6).
 *
 * Stricter than a bare `canViewInstance('kb', id)` in exactly one way, and
 * deliberately: a `kind: 'source'` KB is never readable through this door,
 * whatever the grants say. Source KBs are hidden pipeline containers that cannot
 * be granted at all (they never reach `kb.list`, so no Share card can author a
 * row against one), and their own surface is the `knowledgeSources` router.
 */
export async function canReadKnowledgeBase(
  organizationId: string,
  capabilities: CapabilityView | undefined,
  knowledgeBaseId: string | null | undefined
): Promise<boolean> {
  const scope = await resolveArticleReadScope(organizationId, capabilities)
  return scope.unrestricted || scope.canReadKnowledgeBase(knowledgeBaseId)
}

/**
 * May the viewer read this article? **Placement-permissive** (§5.2 / §2.6).
 *
 * An absent article is `false` — invisible ≍ nonexistent, so article ids stay
 * unprobeable across orgs. Callers that must distinguish 404 from 403 should
 * resolve the row themselves and pass {@link ArticleReadInput.homeKnowledgeBaseId}.
 *
 * Costs at most two reads and usually one: the home KB is checked first and
 * short-circuits, so the `ArticlePlacement` scan only runs for the minority case
 * of an article homed somewhere the viewer cannot see — which is exactly the
 * multi-home row the placement arm exists for. A viewer with an empty allow-list
 * short-circuits before any query at all.
 */
export async function canReadArticle(db: Database, input: ArticleReadInput): Promise<boolean> {
  const { organizationId, capabilities, articleId } = input
  const scope = await resolveArticleReadScope(organizationId, capabilities)
  if (scope.unrestricted) return true
  if (scope.knowledgeBaseIds.size === 0) return false

  let homeKnowledgeBaseId = input.homeKnowledgeBaseId
  if (homeKnowledgeBaseId === undefined) {
    const [row] = await db
      .select({ homeKnowledgeBaseId: schema.Article.homeKnowledgeBaseId })
      .from(schema.Article)
      .where(
        and(eq(schema.Article.id, articleId), eq(schema.Article.organizationId, organizationId))
      )
      .limit(1)
    if (!row) return false
    homeKnowledgeBaseId = row.homeKnowledgeBaseId
  }
  if (scope.canReadKnowledgeBase(homeKnowledgeBaseId)) return true

  const placements = await db
    .select({ knowledgeBaseId: schema.ArticlePlacement.knowledgeBaseId })
    .from(schema.ArticlePlacement)
    .where(
      and(
        eq(schema.ArticlePlacement.articleId, articleId),
        eq(schema.ArticlePlacement.organizationId, organizationId)
      )
    )
  return scope.canReadArticleIn(placements.map((row) => row.knowledgeBaseId))
}

export interface ArticleReadInput {
  organizationId: string
  /** `undefined` ⇒ headless caller ⇒ unrestricted (§8.2). */
  capabilities: CapabilityView | undefined
  articleId: string
  /**
   * The article's `homeKnowledgeBaseId`, when the caller already read the row —
   * skips one query. `undefined` means "not supplied", so this function reads it
   * and returns `false` for an article that does not exist in the org.
   */
  homeKnowledgeBaseId?: string | null
}
