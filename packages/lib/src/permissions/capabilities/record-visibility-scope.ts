// packages/lib/src/permissions/capabilities/record-visibility-scope.ts

import type { Rung } from '@auxx/database/enums'
import { and, or, type SQL, sql } from 'drizzle-orm'
import { ForbiddenError } from '../../errors'
import {
  type ResourceAccessGrantees,
  resolveResourceAccessGrantees,
  resourceAccessGranteeConditions,
} from '../../resource-access/grantee-resolution'
import type { CapabilityView } from './capability-view'
import { ALL_RUNGS, RUNG_ORDER } from './rung'

/**
 * **The ONE authoring point for the record-lane grantee union** (plan v3/03 §5.1).
 *
 * Every record read that must respect per-record `ResourceAccess` grants goes
 * through this module: `listFiltered`, `listAll`, `search`, `getById`,
 * `getByIds`, the picker, exports, agent tools and relationship value reads.
 * Nowhere else may spell out "which `ResourceAccess` rows reach this member on a
 * record def" — that was the copy-paste failure 19a finding 4 recorded for the
 * grantee union itself, and a second copy of the *scope* would reintroduce it one
 * layer up.
 *
 * ## The four arms, resolved IN CODE
 *
 * ```
 * 1. defViewable && !hasRestrictions(def) → undefined   // pays NOTHING
 * 2. defViewable &&  hasRestrictions(def) → (NOT row-restricted) OR (my grant ≥ read)
 * 3. !defViewable && grantedDefIds[def]   → EXISTS(my grant ≥ read)
 * 4. !defViewable && !grantedDefIds[def]  → NONE (empty result, no query at all)
 * ```
 *
 * Because the branch is taken in TypeScript, **Postgres never sees an `OR`
 * between the arms**: each request gets constant SQL for its own case, the
 * planner gets a shape it can index (`ResourceAccess_grantee_def_idx` drives arm
 * 3), and there is exactly one maintained predicate per arm in one file.
 *
 * ## The rule-source seam (D8)
 *
 * The resolver is structured as `canViewEntity(def) OR ruleScope(def) OR
 * explicitGrants(def)`. {@link recordRuleScope} is the unimplemented middle term.
 * `resolveLinkedRecordIds` (`record-view-scope.ts`) is source #1 of that registry
 * when it comes — it is deliberately NOT wired here.
 */

/** Rungs at or above `floor`, ascending — the constants of a threshold `IN (…)`. */
export function rungsAtOrAbove(floor: Rung): Rung[] {
  return ALL_RUNGS.filter((rung) => RUNG_ORDER[rung] >= RUNG_ORDER[floor])
}

/**
 * The read floor of the record lane — `read` and above.
 *
 * `metadata` / `identity` are NOT in
 * {@link import('./instance-access').RECORD_DEF_RUNGS}, so a record def cannot
 * express them and a row carrying one is a data bug that must not admit. That is
 * why every threshold below is built from this floor rather than from `'none'`.
 */
export const RECORD_READ_FLOOR: Rung = 'read'

/** Which of the four §5.1 arms a `(member, def)` pair resolves to. */
export type RecordScopeArm =
  /** Arm 1 — the member may see every row; no predicate, no cost. */
  | 'all'
  /** Arm 2 — def-viewable but the def carries instance restrictions. */
  | 'restricted'
  /** Arm 3 — the def is invisible; only explicitly granted rows are reachable. */
  | 'grant-only'
  /** Arm 4 — nothing is reachable; the caller must not issue a query. */
  | 'none'

/** The resolved scope: an arm, plus the SQL predicate the two middle arms need. */
export type RecordVisibilityScope =
  | { arm: 'all'; where?: undefined }
  | { arm: 'restricted' | 'grant-only'; where: SQL }
  | { arm: 'none'; where?: undefined }

/** Inputs the arm decision needs — pure booleans, so it is testable without Drizzle. */
export interface RecordScopeArmInput {
  /** `capabilities.canViewEntity(def)` — "may see ALL rows of this def". */
  defViewable: boolean
  /**
   * Whether this def can carry instance-level RESTRICTION rows (`rung: 'none'`).
   *
   * **Always `false` for a record def today**, and not by omission: the write
   * path rejects `rung: 'none'` for record defs (raise-only, D7 —
   * `routers/resourceAccess.ts`), so no producer of such a row exists. Arm 2 is
   * therefore unreachable in v1. It is implemented, tested and kept live anyway
   * so that the day a restriction producer lands the predicate already exists in
   * the one place the union is authored, rather than being invented at whichever
   * call site notices first.
   */
  hasRestrictions: boolean
  /** `grantedDefIds[def]` — the member holds ≥1 `read`-or-better row on this def. */
  grantedDef: boolean
}

/**
 * Which arm a `(member, def)` pair takes — the whole §5.1 decision, as a pure
 * function over three booleans.
 *
 * Split out from the SQL for the reason {@link
 * import('../../resource-access/grantee-resolution').granteeMatchers} was: under
 * the default Vitest config `@auxx/database`'s `schema` is a Proxy whose columns
 * are `undefined`, so asserting on a built Drizzle predicate passes vacuously.
 * The branch that decides whether a member sees anything at all must be assertable.
 */
export function recordScopeArm(input: RecordScopeArmInput): RecordScopeArm {
  if (input.defViewable) return input.hasRestrictions ? 'restricted' : 'all'
  return input.grantedDef ? 'grant-only' : 'none'
}

/**
 * The arm for a `(member, def)` pair, decided from a {@link CapabilityView}
 * alone — **zero I/O and no def-id normalization**.
 *
 * Deliberately takes the RAW def key (slug / apiSlug / id): `CapabilitySet`
 * normalizes internally through an in-memory map, so arms 1 and 4 answer without
 * touching the org cache. That is what makes §5.1's *"members who can see the def
 * pay NOTHING"* literally true, and it is also what keeps the "no reachable rows
 * ⇒ no query at all" path from paying for a cache warm.
 *
 * `capabilities: undefined` ⇒ `'all'` — internal caller, no enforcement.
 */
export function recordScopeArmFor(
  capabilities: CapabilityView | undefined,
  entityDefinitionKey: string,
  hasRestrictions = false
): RecordScopeArm {
  if (!capabilities) return 'all'
  return recordScopeArm({
    defViewable: capabilities.canViewEntity(entityDefinitionKey),
    hasRestrictions,
    grantedDef: capabilities.hasRecordGrantsOn(entityDefinitionKey),
  })
}

/**
 * The **rule-source seam** (D8) — the middle term of
 * `canViewEntity(def) OR ruleScope(def) OR explicitGrants(def)`.
 *
 * Deliberately unimplemented and deliberately called, so the seam is a real
 * branch rather than a comment. When record-view rules arrive, source #1 is
 * `resolveLinkedRecordIds` (`record-view-scope.ts`, currently zero call sites):
 * it resolves the row-scoped read set of a FIELD seat. Wiring it is NOT part of
 * this phase — a field seat's reach is a different registry from a share, and
 * folding them together before that registry exists is how the two stop being
 * separable.
 *
 * Returns `undefined` = "this source contributes nothing", which is the
 * fail-closed direction: an unimplemented rule source can only ever narrow.
 */
export function recordRuleScope(_input: {
  organizationId: string
  entityDefinitionId: string
  grantees: ResourceAccessGrantees
}): SQL | undefined {
  return undefined
}

/** Correlation target: the outer row whose id the grant rows point at. */
export interface RecordScopeSqlInput {
  organizationId: string
  /** Canonical `EntityDefinition.id` — the `ResourceAccess.entityDefinitionId` keyspace. */
  entityDefinitionId: string
  grantees: ResourceAccessGrantees
  /**
   * The outer `id` column to correlate `ResourceAccess.entityInstanceId` against.
   * Defaults to {@link DEFAULT_INSTANCE_ID_COLUMN}; the search paths pass their
   * own alias (`ei."id"`).
   */
  instanceIdColumn?: SQL | unknown
}

/**
 * 🔴 **The correlation target is a RAW qualified identifier, NOT
 * `schema.EntityInstance.id`, and that is load-bearing.**
 *
 * Drizzle's `buildSelection` rewrites every `Column` chunk it finds in the
 * PROJECTION to a bare `sql.identifier(column.name)` when the query has a single
 * table in its `FROM` — and it walks into nested `sql` fragments to do it. Every
 * one of these predicates rides in the projection of a single-table
 * `select(...).from(EntityInstance)` (the `_access` stamp, the sharing guard,
 * the request lane), so a `Column` here rendered as bare `"id"` — which, inside
 * `FROM "ResourceAccess"`, binds to **`ResourceAccess.id`**, not the outer row.
 * The correlation silently became `ResourceAccess.entityInstanceId =
 * ResourceAccess.id`, `max()` aggregated zero rows, and every per-record grant
 * folded away to the def rung.
 *
 * It fails CLOSED and silently: a member granted `edit` on a row reads back
 * `_access: 'read'`, so the drawer stays read-only, the write gate refuses, and
 * the access-request lane re-derives `read → edit` forever. Nothing errors.
 *
 * A raw identifier cannot be rewritten, so it survives the projection.
 */
const DEFAULT_INSTANCE_ID_COLUMN = sql.raw('"EntityInstance"."id"')

/**
 * `EXISTS (… a grant of `floor` or better addressed to this member …)` — the
 * grantee union, written ONCE.
 *
 * Reuses {@link resourceAccessGranteeConditions} rather than inlining the four
 * `(granteeType, granteeId)` pairs. That function exists precisely because the
 * forward and reverse expansions once diverged, and the divergence mode is
 * vicious: a grantee kind one reader cannot resolve does not fail closed *for
 * that grantee*, it flips a definition's whole restriction posture.
 *
 * `treatTeamAsGroup` is deliberately NOT set — that is the mail evaluator's
 * legacy behaviour and the record lane has no `team` rows to be bug-compatible
 * with.
 */
function grantExistsSql(input: RecordScopeSqlInput, floor: Rung): SQL {
  const instanceId = input.instanceIdColumn ?? DEFAULT_INSTANCE_ID_COLUMN
  const grantee = or(...resourceAccessGranteeConditions(input.grantees))
  const rungs = rungsAtOrAbove(floor)
  return sql`EXISTS (
    SELECT 1 FROM "ResourceAccess"
    WHERE "ResourceAccess"."organizationId" = ${input.organizationId}
      AND "ResourceAccess"."entityDefinitionId" = ${input.entityDefinitionId}
      AND "ResourceAccess"."entityInstanceId" = ${instanceId}
      AND "ResourceAccess"."rung" IN ${rungs}
      AND ${grantee}
  )`
}

/**
 * `NOT EXISTS (… any `none` restriction marker on this instance, from ANY
 * grantee …)` — arm 2's anti-join.
 *
 * Grantee-AGNOSTIC on purpose, and it is the same predicate
 * `governingInstanceIds` carries for the blob lane: a restriction row of a
 * grantee kind this reader cannot expand must still deny, or a `profile`-keyed
 * marker would be silently unenforceable.
 */
function notRowRestrictedSql(input: RecordScopeSqlInput): SQL {
  const instanceId = input.instanceIdColumn ?? DEFAULT_INSTANCE_ID_COLUMN
  return sql`NOT EXISTS (
    SELECT 1 FROM "ResourceAccess"
    WHERE "ResourceAccess"."organizationId" = ${input.organizationId}
      AND "ResourceAccess"."entityDefinitionId" = ${input.entityDefinitionId}
      AND "ResourceAccess"."entityInstanceId" = ${instanceId}
      AND "ResourceAccess"."rung" = 'none'
  )`
}

/**
 * Build the §5.1 scope for one `(member, def)` pair.
 *
 * ⚠ **Arm 2's shape resolves an ambiguity in the plan text.** §5.1 writes it as
 * `AND(NOT EXISTS(rung='none' on instance), OR(EXISTS(grant ≥ read)))`. Read as
 * a literal conjunction that says "a def-viewable member sees a row only if they
 * ALSO hold an explicit grant on it", which contradicts `canViewEntity`'s own
 * meaning ("may see ALL rows") and would empty the table for every member the
 * moment one restriction row existed anywhere. It is implemented here as the
 * DISJUNCTION the surrounding prose describes and that
 * {@link import('./entity-access').effectiveInstanceLevel} already enforces on
 * the blob lane — *a row-governed instance denies **unless** the member holds
 * their own row*:
 *
 * ```
 * (NOT EXISTS <any 'none' marker on the row>)  OR  (EXISTS <my grant ≥ read>)
 * ```
 */
export function recordVisibilityScope(
  input: RecordScopeSqlInput & RecordScopeArmInput
): RecordVisibilityScope {
  const arm = recordScopeArm(input)
  if (arm === 'all' || arm === 'none') return { arm }

  const rule = recordRuleScope({
    organizationId: input.organizationId,
    entityDefinitionId: input.entityDefinitionId,
    grantees: input.grantees,
  })
  const grants = grantExistsSql(input, RECORD_READ_FLOOR)

  if (arm === 'grant-only') {
    // `canViewEntity(def) OR ruleScope(def) OR explicitGrants(def)` — the first
    // term is false by construction on this arm, so what survives is the OR of
    // the remaining two.
    const where = rule ? or(rule, grants)! : grants
    return { arm, where }
  }

  const where = or(notRowRestrictedSql(input), grants, ...(rule ? [rule] : []))!
  return { arm, where }
}

/**
 * `EXISTS (… a `read`-or-better grant addressed to this member on the correlated
 * row …)`, **def-agnostic** — it correlates on org, instance id and the grantee
 * union, but not on `entityDefinitionId`.
 *
 * That is sound for the same reason `instanceListScope` states for its own id
 * lists: instance ids are globally-unique cuid2s, so a grant row belonging to a
 * different def can never match another def's instance. Making it def-aware
 * would need one `EXISTS` per def, i.e. SQL whose size grows with the org's
 * schema — which is exactly what a multi-def search cannot afford.
 *
 * The def-SCOPED twin is {@link grantExistsSql}; both search shapes below share
 * this one so the two cannot drift.
 */
function anyDefGrantExistsSql(input: {
  organizationId: string
  grantees: ResourceAccessGrantees
  instanceIdColumn: SQL | unknown
}): SQL {
  const grantee = or(...resourceAccessGranteeConditions(input.grantees))
  const rungs = rungsAtOrAbove(RECORD_READ_FLOOR)
  return sql`EXISTS (
    SELECT 1 FROM "ResourceAccess"
    WHERE "ResourceAccess"."organizationId" = ${input.organizationId}
      AND "ResourceAccess"."entityInstanceId" = ${input.instanceIdColumn}
      AND "ResourceAccess"."rung" IN ${rungs}
      AND ${grantee}
  )`
}

/**
 * The MULTI-DEF form of the scope, for a search that spans several definitions
 * at once (§5.1: *"`search` — all three arms; the def-list arm additionally
 * unions grant-only defs"*).
 *
 * ```
 *   ei."entityDefinitionId" = ANY(<fully viewable>)
 * OR (
 *   ei."entityDefinitionId" = ANY(<grant-only>) AND EXISTS(<my grant ≥ read on ei.id>)
 * )
 * ```
 *
 * Returns `undefined` when every def in scope is fully viewable (nothing to
 * narrow) and `null` when NOTHING is reachable (the caller must return empty
 * without querying).
 */
export function recordSearchVisibilitySql(input: {
  organizationId: string
  grantees: ResourceAccessGrantees
  fullyViewableDefIds: string[]
  grantOnlyDefIds: string[]
  /** The outer instance-id column, e.g. `sql.raw('ei."id"')`. */
  instanceIdColumn: SQL | unknown
  /** The outer def column, e.g. `sql.raw('ei."entityDefinitionId"')`. */
  defIdColumn: SQL | unknown
}): SQL | undefined | null {
  if (input.fullyViewableDefIds.length === 0 && input.grantOnlyDefIds.length === 0) return null
  if (input.grantOnlyDefIds.length === 0) return undefined

  const grantOnly = `{${input.grantOnlyDefIds.join(',')}}`
  const grantOnlyArm = sql`(
    ${input.defIdColumn} = ANY(${grantOnly}::text[])
    AND ${anyDefGrantExistsSql(input)}
  )`

  if (input.fullyViewableDefIds.length === 0) return grantOnlyArm
  const viewable = `{${input.fullyViewableDefIds.join(',')}}`
  return sql`(${input.defIdColumn} = ANY(${viewable}::text[]) OR ${grantOnlyArm})`
}

/**
 * The **UNSCOPED-UNION** form of the scope, for the global search that takes no
 * def scope at all (`record.search` with neither `entityDefinitionId` nor
 * `entityDefinitionIds` — the cross-type union of the system tables and
 * `EntityInstance`).
 *
 * ```
 *   NOT (ei."entityDefinitionId" = ANY(<grant-only>))   -- unchanged rows
 * OR EXISTS(<my grant ≥ read on ei.id>)                 -- the newly admitted ones
 * ```
 *
 * ## Why this is the complement of {@link recordSearchVisibilitySql}, not a copy
 *
 * The def-list arm knows its whole universe — the caller named every def — so it
 * can enumerate the fully-viewable half and write `= ANY(<viewable>)`. The union
 * arm has no such list: it reads EVERY `EntityInstance` row in the org and hands
 * the result to a `canViewEntity` post-filter. Enumerating "every def I may view"
 * to feed the positive form would replace that post-filter with a list built from
 * the org cache, so a def missing from the cache would silently stop appearing —
 * a fail-closed regression, but a regression.
 *
 * So this predicate is **purely additive**: it names only the grant-only defs and
 * leaves every other row exactly as reachable as it was, for the post-filter to
 * judge as before. The caller must therefore keep that post-filter and widen it
 * to `canViewEntity(def) || grantOnlyDefIds.has(def)` — rows of a grant-only def
 * have already been narrowed here, and `canViewEntity` is `false` for them by
 * construction.
 *
 * `NOT (x = ANY(…))` rather than `x <> ALL(…)`: identical semantics for a
 * NOT NULL column and a NULL-free array, and it reads as the negation it is.
 *
 * Returns `undefined` when the member has no grant-only def — the overwhelmingly
 * common case, which must cost nothing.
 */
export function recordUnionVisibilitySql(input: {
  organizationId: string
  grantees: ResourceAccessGrantees
  grantOnlyDefIds: string[]
  /** The outer instance-id column, e.g. `sql.raw('ei."id"')`. */
  instanceIdColumn: SQL | unknown
  /** The outer def column, e.g. `sql.raw('ei."entityDefinitionId"')`. */
  defIdColumn: SQL | unknown
}): SQL | undefined {
  if (input.grantOnlyDefIds.length === 0) return undefined
  const grantOnly = `{${input.grantOnlyDefIds.join(',')}}`
  return sql`(
    NOT (${input.defIdColumn} = ANY(${grantOnly}::text[]))
    OR ${anyDefGrantExistsSql(input)}
  )`
}

/**
 * Resolve the scope for a request, including the member's grantee identities.
 *
 * Grantee resolution is **cache-only** (`groupMembers`, `memberRoleMap`,
 * `profiles` are all org-cache keys), so this adds no I/O — it is `async` only
 * because the cache reads are.
 *
 * `capabilities: undefined` means an INTERNAL caller (worker, seeder,
 * record-rule) and yields arm `'all'` — today's semantics, unchanged. Request
 * paths must never reach that branch; see {@link assertRequestScoped}.
 */
export async function resolveRecordVisibilityScope(input: {
  organizationId: string
  userId: string
  entityDefinitionId: string
  capabilities?: CapabilityView
  /** See {@link RecordScopeArmInput.hasRestrictions} — no producer exists yet. */
  hasRestrictions?: boolean
  instanceIdColumn?: SQL | unknown
}): Promise<ResolvedRecordScope> {
  // ARM FIRST, and that ordering is load-bearing: arm 4 means the member can
  // reach no row of this def, so it must cost nothing — not even the (cached)
  // grantee resolution, and certainly not a query. `grantees` is therefore
  // absent on that arm, which the type states rather than merely documents.
  const arm = recordScopeArmFor(
    input.capabilities,
    input.entityDefinitionId,
    input.hasRestrictions ?? false
  )
  if (arm === 'none') return { arm: 'none' }

  const grantees = await resolveResourceAccessGrantees(input.organizationId, input.userId)
  if (arm === 'all') return { arm: 'all', grantees }

  const scope = recordVisibilityScope({
    organizationId: input.organizationId,
    entityDefinitionId: input.entityDefinitionId,
    grantees,
    instanceIdColumn: input.instanceIdColumn,
    defViewable: arm === 'restricted',
    hasRestrictions: arm === 'restricted',
    grantedDef: arm === 'grant-only',
  })
  return { ...scope, grantees } as ResolvedRecordScope
}

/**
 * {@link resolveRecordVisibilityScope}'s result — the scope plus the grantee
 * identities it was built from, so a caller can hand the SAME union to
 * {@link recordAccessRankSql} without resolving twice.
 *
 * `grantees` is absent on arm 4 alone: nothing is reachable, so nothing needs
 * stamping and nothing was resolved.
 */
export type ResolvedRecordScope =
  | { arm: 'none'; where?: undefined; grantees?: undefined }
  | { arm: 'all'; where?: undefined; grantees: ResourceAccessGrantees }
  | { arm: 'restricted' | 'grant-only'; where: SQL; grantees: ResourceAccessGrantees }

/**
 * Fail LOUDLY when a request path builds a record read without a
 * {@link CapabilityView}.
 *
 * `capabilities: undefined` is a real and supported mode — it means "internal
 * caller, no enforcement", and workers/seeders/record-rules depend on it. The
 * hazard is that the same absence on a REQUEST path is indistinguishable at
 * runtime and reads the whole org silently. So the request path states itself
 * (`requestPath: true`) and this assertion turns the silent read into a 403.
 */
export function assertRequestScoped(
  capabilities: CapabilityView | undefined,
  site: string
): asserts capabilities is CapabilityView {
  if (capabilities) return
  throw new ForbiddenError(
    `${site} was constructed on a request path without capabilities — refusing to read unscoped.`
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// The `_access` stamp (§5.2)
// ─────────────────────────────────────────────────────────────────────────────

/** `CASE "rung" WHEN 'admin' THEN 5 … END` — the ordinal table, projected into SQL. */
const RUNG_RANK_CASE = sql.raw(
  `CASE "ResourceAccess"."rung" ${ALL_RUNGS.map((rung) => `WHEN '${rung}' THEN ${RUNG_ORDER[rung]}`).join(' ')} ELSE 0 END`
)

/**
 * `max(rung)` across the member's matching grant rows for the correlated row —
 * the grant half of the `_access` stamp, as a scalar subquery so it rides the
 * SAME query as the row it describes (§5.2: one roundtrip, no cache read, no
 * post-filter).
 *
 * `none` rows are excluded from the aggregate rather than ranked at 0. They are
 * a RESTRICTION marker, not a weak grant: the visibility predicate is what acts
 * on them (arm 2's anti-join), and letting one into `max()` would be harmless
 * only by arithmetic accident. Excluding them says why.
 */
export function recordAccessRankSql(input: RecordScopeSqlInput): SQL<number | null> {
  const instanceId = input.instanceIdColumn ?? DEFAULT_INSTANCE_ID_COLUMN
  const grantee = or(...resourceAccessGranteeConditions(input.grantees))
  return sql<number | null>`(
    SELECT max(${RUNG_RANK_CASE})
    FROM "ResourceAccess"
    WHERE "ResourceAccess"."organizationId" = ${input.organizationId}
      AND "ResourceAccess"."entityDefinitionId" = ${input.entityDefinitionId}
      AND "ResourceAccess"."entityInstanceId" = ${instanceId}
      AND "ResourceAccess"."rung" <> 'none'
      AND ${grantee}
  )`
}

/**
 * Re-exported from `rung.ts` (which is pure and client-safe, so the client
 * mirror of the stamp shares one implementation): the def-level ⋁ grant-rank
 * fold that produces `_access`, and the rank→rung inverse it reads.
 */
export { foldRecordAccess, rankToRung } from './rung'

/**
 * Combine two scope predicates with `AND`, tolerating either being absent.
 * `undefined` means "no narrowing" on both sides, so the identity is `undefined`.
 */
export function andScope(a: SQL | undefined, b: SQL | undefined): SQL | undefined {
  if (!a) return b
  if (!b) return a
  return and(a, b)
}
