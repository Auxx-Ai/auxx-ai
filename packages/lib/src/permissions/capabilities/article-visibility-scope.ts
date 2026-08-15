// packages/lib/src/permissions/capabilities/article-visibility-scope.ts

import type { Rung } from '@auxx/database/enums'
import { type SQL, sql } from 'drizzle-orm'
import { getCachedKnowledgeBases } from '../../cache'
import type { CapabilityView } from './capability-view'
import {
  instanceTableVisibilityScope,
  isInstanceBackedTable,
} from './instance-table-visibility-scope'
import type { RecordVisibilityScope } from './record-visibility-scope'
import { RECORD_READ_FLOOR } from './record-visibility-scope'
import { RUNG_ORDER } from './rung'
import { fnv1a32 } from './scope-fingerprint'

/**
 * **The ONE authoring point for "which articles may this member read"**
 * (plan v3/06 §4.2).
 *
 * An article carries no `ResourceAccess` rows of its own and never should — it
 * is not a grant target. Its policy lives **one hop away, on its knowledge
 * base**, and before this module that rule was implemented independently at six
 * call sites in six spellings (§2.5), which is exactly why three further readers
 * — the generic records lane, the `.md` preview route and the dashboard
 * aggregate — forgot it without anyone noticing.
 *
 * ## Why this lives in `permissions/` and not in `kb/`
 *
 * `packages/lib` holds no access checks by design (`docs/lib-module-guide.md`
 * §6), and `packages/lib/src/kb/**` threads no capabilities anywhere — every one
 * of its callers is load-bearing. So the rule belongs beside
 * {@link import('./record-visibility-scope')}, as its **sibling**: same
 * discipline, different correlation. It is deliberately NOT folded into
 * `recordVisibilityScope`, whose whole job is the `ResourceAccess` grantee union
 * correlated against `EntityInstance.id`. Articles are neither.
 *
 * ## What is deliberately NOT narrowed here
 *
 * `search_knowledge` and agent retrieval read a KB's **managed `Dataset`**, not
 * `Article` rows, and an answering agent grounding a customer reply in the org's
 * KB is the product (§8.2). Agents run under their own published policy, not the
 * invoking member's, and an agent's `knowledge` scope is a *retrieval* scope,
 * not access control. Narrowing retrieval by the invoker's KB grants would break
 * ticket answering for every member on a narrow profile. **Do not "finish the
 * job" by pointing that path here.**
 */

/**
 * KB kinds that are **never** a viewable-KB source, whatever grants say (§6.1).
 *
 * `kind: 'source'` KBs are hidden containers owned by `KnowledgeSource` —
 * `listKnowledgeBases`' own comment already promises they are "never surfaced in
 * KB lists, pickers, or the public site". They also cannot be *granted*: they
 * never appear in `kb.list`, so no Share card can write a `kb` row against one.
 * Treating them as ordinary grantable KBs would make the allow-list depend on a
 * grant nobody can author — a rule with no lever.
 *
 * ⚠ This exclusion is load-bearing rather than cosmetic, because
 * `MEMBER_BASELINE_LEVELS[Area.knowledgeBase]` is `Level.Edit` and `kb` is
 * `baselineAtCreate: false` (§8.0): a stock member composes `edit` on every KB
 * carrying no restricting row, **including source KBs**. So
 * `canViewInstance('kb', <source kb>)` is `true` for almost everyone, and this
 * set is the only thing keeping source-managed articles out of the records lane.
 *
 * `kind: 'learned'` (AI Memory) is the OPPOSITE and must NOT be collapsed into
 * this: it is deliberately member-facing org knowledge every teammate can read
 * and correct. Its only problem is that `listKnowledgeBases` filters it out of
 * `kb.list`, which is a defect fixed elsewhere (§6.2 / P4), not here.
 */
const HIDDEN_KB_KINDS: ReadonlySet<string> = new Set(['source'])

/**
 * The org's knowledge bases the viewer may read, as an id **allow-list**.
 *
 * `'all'` means "no member to be relative to" — an internal caller (worker,
 * seeder, `apps/kb` render, widget API, embedding job). That
 * `capabilities: undefined` ⇒ unrestricted convention is load-bearing for
 * headless work and matches `recordScopeArmFor` (§8.2).
 *
 * ## Why an allow-list and not `instanceListScope(caps, 'kb')`
 *
 * That helper returns three arms and only `include` is directly usable. The
 * `exclude` arm is a **deny**-list, and a deny-list does not compose across a
 * one-to-many relation: an article placed in both an excluded and a permitted KB
 * must stay visible, so `NOT (kb = ANY(excludeIds))` has to be pushed *inside*
 * the `EXISTS` — a second predicate shape to maintain. One shape, always
 * positive (§5.3).
 *
 * ## The positive-form hazard, accepted with eyes open
 *
 * A positive form depends on the org cache being complete, the same hazard
 * `recordUnionVisibilitySql` refuses for search. It is accepted here because the
 * failure direction is **closed** — a KB missing from the cache hides its
 * articles rather than exposing them — and the `knowledgeBases` key is
 * invalidated on `kb.created` / `kb.deleted` / `kb.updated`.
 *
 * Zero I/O beyond one cached read: the KB list is an org-cache blob and
 * `canViewInstance` is an in-memory lookup on the composed capability blob. The
 * measured heaviest per-`(user, org)` instance count across ALL instance-access
 * resources is 37 (`03-entity-instance-access.md` §4), and KBs are a strict
 * subset — bounded by org *setup*, not org *activity*. No size guard is needed.
 */
export async function viewableKnowledgeBaseIds(
  organizationId: string,
  capabilities: CapabilityView | undefined
): Promise<string[] | 'all'> {
  if (!capabilities) return 'all'
  const knowledgeBases = await getCachedKnowledgeBases(organizationId)
  const viewable: string[] = []
  for (const kb of knowledgeBases) {
    if (HIDDEN_KB_KINDS.has(kb.kind)) continue
    if (!capabilities.canViewInstance('kb', kb.id)) continue
    viewable.push(kb.id)
  }
  // 🔴 `'all'` is returned for an ABSENT viewer only — never for a member who
  // happens to hold everything, and there are two independent reasons.
  //
  // 1. **The plan's §8.0 is wrong that "the predicate narrows nothing on a
  //    seeded org".** That holds for the GRANT half and fails for the `kind`
  //    half: `source` KBs are dropped unconditionally, for every principal
  //    including OWNER. Any org with a KnowledgeSource therefore always narrows,
  //    and a source-only article always leaves the records lane (its own surface
  //    is the `knowledgeSources` router — §6.1 / I6).
  // 2. **An `'all'` short-circuit for a real member would skip the `_access`
  //    stamp**, and "missing stamp ⇒ deny" (`assertRecordRowsEditable`) would
  //    turn this read fix into the very under-permission §7.2 exists to close.
  //    A member must always be stamped, however wide their access.
  return viewable
}

/**
 * 🔴 RAW qualified identifiers, not `schema.Article.*` columns — the same
 * reasoning `DEFAULT_INSTANCE_ID_COLUMN` carries in
 * {@link import('./record-visibility-scope')}.
 *
 * Drizzle's `buildSelection` rewrites every `Column` chunk it finds to a bare
 * `sql.identifier(column.name)` when the query has a single table in its `FROM`,
 * and it walks into nested `sql` fragments to do it. A bare `"id"` inside
 * `FROM "ArticlePlacement"` binds to **`ArticlePlacement.id`**, silently turning
 * the correlation into `p."articleId" = p."id"` — which matches nothing and
 * hides every article from everyone. A raw identifier cannot be rewritten.
 */
const ARTICLE_ID_COLUMN = sql.raw('"Article"."id"')
const ARTICLE_HOME_KB_COLUMN = sql.raw('"Article"."homeKnowledgeBaseId"')

/**
 * The row predicate: `EXISTS(placement in a viewable KB) OR home in a viewable
 * KB` (§5.2).
 *
 * ⚠ **Qualified to `"Article"`.** It is only valid inside a query whose `FROM`
 * is the `Article` table — i.e. the system-table lane. It must never be ANDed
 * into an `EntityInstance` query; there is no `"Article"` there and Postgres
 * raises `missing FROM-clause entry`. {@link systemTableVisibilityScope} is the
 * only supported way to obtain it.
 *
 * ## Why BOTH arms, and why placement comes first
 *
 * - **Placement arm.** An article homed in a hidden `source` KB and *linked into*
 *   a standard KB the member holds must stay visible. Dev has exactly one such
 *   row (`gxbz6zn31qsebel4lhqek50y`). A `homeKnowledgeBaseId`-only predicate
 *   hides a row deliberately published into a KB the member owns — an
 *   under-permission that reads to a user as "linking is broken".
 * - **Home arm, as belt and braces.** The ≥1-placement-per-article invariant is
 *   enforced in CODE (`kb/internal/placement.ts`), **not** by a DB constraint. A
 *   placement-only predicate would turn any violation of that code-level
 *   invariant into a silently unreadable article — for everyone, including its
 *   author. The home arm costs one indexed equality and removes that mode.
 *
 * An empty `viewableKbIds` renders `= ANY('{}'::text[])`, which matches nothing
 * — fail-closed. Callers should still short-circuit before querying at all; see
 * {@link systemTableVisibilityScope}'s `'none'` arm.
 *
 * There are deliberately **no column-override parameters**. Every optional
 * column argument is one more thing the unit tests cannot verify (columns are
 * `{}` under this package's Vitest config), and no caller in this lane aliases
 * the `Article` table. A future aliased caller should add the override then,
 * with a real query behind it.
 */
export function articleVisibilitySql(input: {
  organizationId: string
  viewableKbIds: readonly string[]
}): SQL {
  // cuid2s are `[a-z0-9]{24}` so a brace-wrapped join needs no quoting — the
  // same assumption `recordSearchVisibilitySql` already makes for def ids.
  const ids = `{${input.viewableKbIds.join(',')}}`
  return sql`(
    EXISTS (
      SELECT 1 FROM "ArticlePlacement" p
      WHERE p."articleId" = ${ARTICLE_ID_COLUMN}
        AND p."organizationId" = ${input.organizationId}
        AND p."knowledgeBaseId" = ANY(${ids}::text[])
    )
    OR ${ARTICLE_HOME_KB_COLUMN} = ANY(${ids}::text[])
  )`
}

/**
 * A KB's rung on the instance ladder, read off the composed capability blob.
 *
 * The twin of `record-picker-service.ts`'s private `instanceRung`, and it walks
 * the three predicates highest-first for the same reason: they are already
 * intersected across run-as/invoker by {@link CapabilityView}'s combining
 * wrapper, so adding a fourth method would have to re-derive that intersection.
 */
function knowledgeBaseRung(
  capabilities: CapabilityView,
  knowledgeBaseId: string
): Rung | undefined {
  if (capabilities.canAdminInstance('kb', knowledgeBaseId)) return 'admin'
  if (capabilities.canEditInstance('kb', knowledgeBaseId)) return 'edit'
  if (capabilities.canViewInstance('kb', knowledgeBaseId)) return 'read'
  return undefined
}

/**
 * The article's **READ** rung — `max` across the KBs it is reachable through
 * (§7.1). `undefined` ⇒ no viewable KB ⇒ the row drops.
 *
 * 🔴 **`kbIds` MUST already be filtered through
 * {@link viewableKnowledgeBaseIds}.** This function asks `canViewInstance`, which
 * is `true` for a `source` KB under the seeded baseline (§8.0) — so handing it
 * an article's raw placement set would re-admit exactly the rows
 * {@link HIDDEN_KB_KINDS} exists to exclude.
 *
 * **`max`, not `min`.** An article linked into a KB the member administers is
 * administrable there; a second placement in a KB they merely read cannot take
 * that away. Same rule `effectiveInstanceLevel` applies within a lane.
 */
export function articleAccessRung(
  capabilities: CapabilityView,
  kbIds: readonly string[]
): Rung | undefined {
  let best: Rung | undefined
  for (const kbId of kbIds) {
    const rung = knowledgeBaseRung(capabilities, kbId)
    if (!rung) continue
    if (!best || RUNG_ORDER[rung] > RUNG_ORDER[best]) best = rung
  }
  return best
}

/**
 * The article's **WRITE** rung — **home-strict** (§7.3, closed as such in §11
 * item 3).
 *
 * Reads are placement-permissive; content writes are not. A draft revision is
 * shared across every placement, so editing through a *linked* placement mutates
 * content the home KB owns. `kb.ts:768` already models exactly this: it asserts
 * `assertEditInstance` on the placement KB **and additionally** on the home KB
 * when the two differ.
 *
 * Two functions rather than one fold is the point: a single fold would silently
 * let a linked-placement `edit` grant rewrite content in a KB the member cannot
 * open. `delete` follows this rung too — deleting the `Article` row destroys
 * every placement.
 *
 * `viewableKbIds` is required (not optional) so the {@link HIDDEN_KB_KINDS}
 * policy cannot be bypassed here: an article homed in a `source` KB has **no**
 * write rung, however wide the member's baseline is.
 */
export function articleWriteRung(
  capabilities: CapabilityView,
  homeKnowledgeBaseId: string | null | undefined,
  viewableKbIds: ReadonlySet<string>
): Rung | undefined {
  if (!homeKnowledgeBaseId) return undefined
  if (!viewableKbIds.has(homeKnowledgeBaseId)) return undefined
  return knowledgeBaseRung(capabilities, homeKnowledgeBaseId)
}

/**
 * The record-lane visibility scope for a **system table** — arm `all` for every
 * table except `article`, which inherits its KB's grants, and `kb` / `dataset`,
 * which ARE grant targets and delegate to
 * {@link import('./instance-table-visibility-scope').instanceTableVisibilityScope}.
 *
 * This exists so `UnifiedCrudHandler` and `RecordPickerService` — the two entry
 * points into one lane — share a single one-line call rather than two hand-rolled
 * dispatches. `recordScope`'s blanket `isSystemResource → { arm: 'all' }` was
 * never "the caller may read every row"; it was "the record lane has no per-row
 * policy for this table". Both comments already named `thread` / `message` as
 * the case where that distinction is the bug. `article` is the third, and
 * neither comment knew it.
 *
 * ⚠ The `'restricted'` arm's `where` is qualified to `"Article"` — see
 * {@link articleVisibilitySql}. Only the system-table query lane may consume it.
 *
 * Arms, and what each costs:
 * - `all` — a non-`article` table, or an internal caller. No predicate.
 * - `none` — no viewable KB at all: the caller must return empty **without
 *   querying**.
 * - `restricted` — the §5.2 predicate, ANDed into the clause the page query and
 *   the `COUNT(*)` share so `total` describes the visible set.
 *
 * ⚠ There is deliberately **no "this member holds everything, skip the
 * predicate" arm**, even though it looks free. `source` KBs are excluded
 * unconditionally, so on any org with a KnowledgeSource such an arm would be
 * WRONG, not merely unhelpful — it would re-admit exactly the source-only rows
 * §6.1 removes. See {@link viewableKnowledgeBaseIds}.
 */
export async function systemTableVisibilityScope(input: {
  organizationId: string
  /** The `RESOURCE_TABLE_REGISTRY` id, e.g. `'article'` / `'user'` / `'kb'`. */
  tableId: string
  capabilities: CapabilityView | undefined
  /**
   * A pre-resolved allow-list from {@link viewableKnowledgeBaseIds}, for callers
   * that ALSO need it for something else — the picker needs it for its cache-key
   * fingerprint (§5.5), and resolving it twice per request would be two folds
   * over the same blob with two chances to disagree.
   */
  viewableKbIds?: string[] | 'all'
}): Promise<RecordVisibilityScope> {
  // `kb` and `dataset` are grant targets in their own right, so their predicate
  // is a direct id filter off the composed blob rather than a one-hop
  // correlation — and it needs no I/O at all, which is why it is answered before
  // the `article` branch reaches for the KB cache.
  if (isInstanceBackedTable(input.tableId)) {
    return instanceTableVisibilityScope(input.tableId, input.capabilities)
  }
  if (input.tableId !== 'article') return { arm: 'all' }
  const viewableKbIds =
    input.viewableKbIds ??
    (await viewableKnowledgeBaseIds(input.organizationId, input.capabilities))
  if (viewableKbIds === 'all') return { arm: 'all' }
  if (viewableKbIds.length === 0) return { arm: 'none' }
  return {
    arm: 'restricted',
    where: articleVisibilitySql({ organizationId: input.organizationId, viewableKbIds }),
  }
}

/**
 * A short, stable fingerprint of a viewable-KB allow-list — the **viewer
 * dimension** the picker's org-keyed result cache is missing (§5.5).
 *
 * 🔴 `RecordPickerCacheService.buildListKey` is
 * `(orgId, entityDefinitionId, {cursor, search, filters})` — **no user
 * dimension at all**. Narrowing `fetchResourcesFromDb` without extending that
 * key would serve the first caller's visible set to every other member in the
 * org, in BOTH directions: a narrow member would be served a wide member's
 * results (a leak strictly worse than the one being closed), and a wide member
 * would be served a narrow member's (silent data loss). A cached page is the
 * same disclosure as a fresh one — the argument step 0.1 already makes for
 * `thread`.
 *
 * Sorted before hashing so two members with the same access always produce the
 * same key regardless of cache iteration order, which is what keeps the hit rate
 * up: per §8.0 nearly everyone composes the same allow-list, so they keep
 * sharing one entry.
 *
 * `'all'` (internal caller) gets its own literal rather than an empty digest, so
 * an unenforced read can never collide with a member who happens to see nothing.
 * FNV-1a rather than a crypto hash: this is a cache-key discriminator, not a
 * security boundary — the enforcement is the SQL predicate, and the value is the
 * FULL 32-bit digest of a pre-sorted list rather than a truncation.
 *
 * ⚠ **Accepted risk, stated so it is not an unexamined one.** A 32-bit collision
 * between two *distinct* allow-lists that are both live in one org would serve
 * one member's article rows to another — a silent cross-member leak, i.e. the
 * exact failure this plan exists to close, reintroduced in the cache instead of
 * the query. It is accepted because the collision domain is not "all possible
 * KB sets" but "distinct allow-lists actually composed in one organization",
 * which is bounded by how many distinct KB-access shapes an admin has authored —
 * single digits in practice, tens at the extreme. At 100 distinct shapes the
 * birthday probability is ~1.2e-6; at 1000 it is ~1.2e-4. Widen to a 64-bit or
 * crypto digest if a real org ever approaches thousands of distinct shapes, or
 * if this fingerprint is ever reused for a scope whose domain is per-USER rather
 * than per-access-shape — that would change the count from "shapes" to
 * "headcount" and the math with it.
 */
export function knowledgeBaseScopeFingerprint(viewableKbIds: string[] | 'all'): string {
  if (viewableKbIds === 'all') return 'kb:all'
  if (viewableKbIds.length === 0) return 'kb:none'
  return `kb:${fnv1a32([...viewableKbIds].sort().join(','))}`
}

/**
 * The `_access` stamp for ONE fetched article row (§7.1 + §7.3) — `undefined`
 * means the row is not viewable and must drop.
 *
 * The read rung decides **admission**; the stamp itself is the **home-strict
 * write rung**, floored at {@link RECORD_READ_FLOOR}. That split is not
 * cosmetic: `_access` is precisely what `canEditRecordAt` / `canDeleteRecordAt`
 * and the client's `useRecordAccess` judge, so stamping the placement-permissive
 * `max` would hand a member `edit` on content owned by a KB they cannot open —
 * the thing §7.3 closes.
 *
 * Once this stamp exists, the shipped per-row machinery fixes §7.2's *other*
 * defect for free, with no new vocabulary: `assertRecordRowsEditable` already
 * re-judges def-denied rows against `_access`, so a `knowledgeBase: Edit`,
 * `records: None` member regains inline tag editing on articles in KBs they
 * hold — which per §8.0 is the **common** configuration, not an edge case.
 */
export function articleRowAccess(input: {
  capabilities: CapabilityView
  /** The article's placement KB ids (`ArticlePlacement.knowledgeBaseId`). */
  placementKbIds: readonly string[]
  homeKnowledgeBaseId: string | null | undefined
  /** The org's viewable-KB allow-list from {@link viewableKnowledgeBaseIds}. */
  viewableKbIds: ReadonlySet<string>
}): Rung | undefined {
  const { capabilities, viewableKbIds } = input
  const reachable = [...input.placementKbIds]
  if (input.homeKnowledgeBaseId) reachable.push(input.homeKnowledgeBaseId)

  const read = articleAccessRung(
    capabilities,
    reachable.filter((kbId) => viewableKbIds.has(kbId))
  )
  if (!read) return undefined

  return (
    articleWriteRung(capabilities, input.homeKnowledgeBaseId, viewableKbIds) ?? RECORD_READ_FLOOR
  )
}
