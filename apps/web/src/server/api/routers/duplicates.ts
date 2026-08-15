// apps/web/src/server/api/routers/duplicates.ts

import { getCachedResources } from '@auxx/lib/cache'
import {
  countOpenDuplicatePairs,
  DUPLICATE_HIGH_INSTANCE_ID_SQL,
  DUPLICATE_LOW_INSTANCE_ID_SQL,
  type DuplicateDefScope,
  type DuplicateSide,
  dismissPair,
  getVisibleDuplicatePair,
  listDuplicatePairs,
  listDuplicatePairsForRecord,
  orderByEstablishment,
  readMergeEstablishment,
} from '@auxx/lib/dedup'
import { BadRequestError, NotFoundError } from '@auxx/lib/errors'
import {
  FeatureKey,
  FeaturePermissionService,
  recordScopeArmFor,
  resolveRecordVisibilityScope,
} from '@auxx/lib/permissions'
import { isSystemResourceId } from '@auxx/lib/resources'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import { z } from 'zod'
import { capabilityProcedure, createTRPCRouter } from '../trpc'

/**
 * tRPC surface for the duplicate review queue
 * (plans/records/duplicate-suggestion-plan-v2.md §3.1).
 *
 * `@auxx/lib/dedup` holds ZERO permission checks by house rule, so **this router
 * is the only authorization path for the feature.** Two separate gates meet
 * here and must not be conflated:
 *
 * | Gate | What it decides |
 * | --- | --- |
 * | `FeatureKey.duplicateDetection` | whether the ORG has the feature at all |
 * | {@link loadDuplicateScopes} | which records THIS member may see, in SQL |
 *
 * The second one is the load-bearing half. A duplicate pair carries the *other*
 * record's display name, so a pair read without the record-scope predicate
 * advertises the names of records the viewer cannot open — the visibility leak
 * named in the plan's Risks section. The predicate is therefore resolved here
 * and applied inside the query, never as a post-fetch filter, and a pair whose
 * other side is invisible is dropped outright rather than rendered half-empty.
 */

/**
 * Client-facing shape of one side of a pair.
 *
 * Instance ids, not `RecordId`s: the brand does not survive serialization, so
 * the client composes them with `toRecordId(entityDefinitionId, instanceId)`
 * (the same thing `SuggestionRow` does) rather than casting a plain string back
 * into a branded type.
 */
interface DuplicateSideDto {
  instanceId: string
  displayName: string | null
  secondaryDisplayValue: string | null
  avatarUrl: string | null
}

/**
 * The org must hold the feature. Deliberately a hard refusal rather than an
 * empty list: the clients already skip these queries when the flag is off (the
 * Approvals section and the header indicator both gate on `useFeatureFlags`), so
 * a request arriving here without it is a bug worth seeing, not a state worth
 * pretending is empty.
 */
async function requireDuplicateDetection(organizationId: string): Promise<void> {
  await new FeaturePermissionService().requireAccess(organizationId, FeatureKey.duplicateDetection)
}

/**
 * The definitions this member may read duplicate pairs for, each with the
 * per-side record-scope predicate it needs.
 *
 * Mirrors `UnifiedCrudHandler.recordScope`, with two differences that fall out
 * of reading PAIRS rather than rows:
 *
 * 1. **It resolves every definition at once**, because the queue is not scoped
 *    to one type. Arms 1 and 4 are decided from the in-memory capability view
 *    with no I/O, so enumerating the org's definitions costs nothing; only the
 *    rare `restricted` / `grant-only` definitions reach for grantee resolution
 *    (itself org-cache-only).
 * 2. **The scope is resolved TWICE per narrowed definition**, once per side,
 *    because the two correlate against different join aliases. Resolving with
 *    the default correlation target would silently point both arms at
 *    `"EntityInstance"."id"`, which is not in this query's FROM list.
 *
 * System-table resources are skipped: they have no `EntityInstance` rows, so no
 * `DuplicateSuggestion` row can reference them and including them would only
 * pad the `IN (…)` list with ids that match nothing.
 */
async function loadDuplicateScopes(ctx: {
  session: { organizationId: string; userId: string }
  capabilities: Parameters<typeof recordScopeArmFor>[0]
}): Promise<DuplicateDefScope[]> {
  const { organizationId, userId } = ctx.session
  const resources = await getCachedResources(organizationId)
  const scopes: DuplicateDefScope[] = []

  for (const resource of resources) {
    if (isSystemResourceId(resource.id)) continue

    const arm = recordScopeArmFor(ctx.capabilities, resource.id)
    // Arm 4 — nothing of this definition is reachable, so it must not appear in
    // the query at all (not even as a definition id whose rows are then filtered).
    if (arm === 'none') continue
    if (arm === 'all') {
      scopes.push({ entityDefinitionId: resource.entityDefinitionId })
      continue
    }

    const [low, high] = await Promise.all([
      resolveRecordVisibilityScope({
        organizationId,
        userId,
        entityDefinitionId: resource.entityDefinitionId,
        capabilities: ctx.capabilities,
        instanceIdColumn: DUPLICATE_LOW_INSTANCE_ID_SQL,
      }),
      resolveRecordVisibilityScope({
        organizationId,
        userId,
        entityDefinitionId: resource.entityDefinitionId,
        capabilities: ctx.capabilities,
        instanceIdColumn: DUPLICATE_HIGH_INSTANCE_ID_SQL,
      }),
    ])

    scopes.push({
      entityDefinitionId: resource.entityDefinitionId,
      lowWhere: low.where,
      highWhere: high.where,
    })
  }

  return scopes
}

function toSideDto(side: DuplicateSide): DuplicateSideDto {
  return {
    instanceId: side.instanceId,
    displayName: side.displayName,
    secondaryDisplayValue: side.secondaryDisplayValue,
    avatarUrl: side.avatarUrl,
  }
}

/**
 * `mergeInstanceIds` on every item below is ordered **best-established first**
 * (plan §3.4).
 *
 * `MergeDialog` defaults its target to the first id it is given, and in
 * canonical pair order that is whichever cuid2 sorts lower — i.e. arbitrary.
 * Since the merge target is the record whose id survives while the other's dies,
 * letting pair order pick it is how "merged into the empty stub" happens. The
 * ordering is decided HERE because the evidence it reads (outbound history,
 * interaction history) is server-side; `orderByEstablishment` is the pure
 * comparator over it.
 *
 * Scoped to this entry point on purpose: every other `MergeDialog` caller keeps
 * its own ordering, because elsewhere the first id is a deliberate user
 * selection rather than an artefact of storage.
 */
export const duplicatesRouter = createTRPCRouter({
  /**
   * The review queue — the Approvals tab's fifth section.
   *
   * Keyset-paged on `(score desc, id desc)`; clusters are computed at read over
   * the page (see `listDuplicatePairs`).
   */
  list: capabilityProcedure
    .input(
      z
        .object({
          cursor: z.object({ score: z.number(), id: z.string() }).optional(),
          limit: z.number().int().min(1).max(50).default(25),
          entityDefinitionId: z.string().optional(),
        })
        .default({ limit: 25 })
    )
    .query(async ({ ctx, input }) => {
      await requireDuplicateDetection(ctx.session.organizationId)
      const scopes = await loadDuplicateScopes(ctx)

      const page = await listDuplicatePairs(ctx.db, {
        organizationId: ctx.session.organizationId,
        scopes,
        cursor: input.cursor,
        limit: input.limit,
        entityDefinitionId: input.entityDefinitionId,
      })
      if (page.isErr()) throw page.error

      const establishment = await readMergeEstablishment(
        ctx.db,
        ctx.session.organizationId,
        page.value.items.flatMap((pair) => pair.clusterInstanceIds)
      )
      if (establishment.isErr()) throw establishment.error

      const items = page.value.items.map((pair) => {
        const ordered = orderByEstablishment(pair.clusterSides, establishment.value)
        const byId = new Map(pair.clusterSides.map((side) => [side.instanceId, side]))
        return {
          id: pair.id,
          entityDefinitionId: pair.entityDefinitionId,
          score: pair.score,
          band: pair.band,
          signals: pair.signals,
          createdAt: pair.createdAt,
          /**
           * Every record in the cluster, best-established first — one row per
           * component, so a three-record cluster is one card listing three
           * records rather than three cards offering the same merge.
           */
          records: ordered.flatMap((id) => {
            const side = byId.get(id)
            return side ? [toSideDto(side)] : []
          }),
          /**
           * The same ids, same order — what the client turns into
           * `MergeDialog.baseRecordIds`. The FIRST id becomes the merge target.
           */
          mergeInstanceIds: ordered,
        }
      })

      return { items, nextCursor: page.value.nextCursor }
    }),

  /**
   * Open pairs touching one record — the drawer / detail-page header indicator.
   *
   * Same scope rule as {@link list}, and for a sharper reason: the caller
   * plainly can see THIS record (they are looking at it), and the other side is
   * exactly what this read discloses.
   */
  forRecord: capabilityProcedure
    .input(z.object({ recordId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireDuplicateDetection(ctx.session.organizationId)
      // The brand does not survive the wire, so the zod input is a plain string.
      // `parseRecordId` does not throw on a malformed id — it yields an empty
      // instance id — so the shape is checked here rather than relying on a
      // query for `id = ''` to return nothing.
      const { entityInstanceId } = parseRecordId(input.recordId as RecordId)
      if (!entityInstanceId) throw new BadRequestError('Malformed recordId')
      const scopes = await loadDuplicateScopes(ctx)

      const pairs = await listDuplicatePairsForRecord(ctx.db, {
        organizationId: ctx.session.organizationId,
        instanceId: entityInstanceId,
        scopes,
      })
      if (pairs.isErr()) throw pairs.error

      const establishment = await readMergeEstablishment(
        ctx.db,
        ctx.session.organizationId,
        pairs.value.flatMap((pair) => [pair.low.instanceId, pair.high.instanceId])
      )
      if (establishment.isErr()) throw establishment.error

      return pairs.value.map((pair) => {
        const isLow = pair.low.instanceId === entityInstanceId
        const other = isLow ? pair.high : pair.low
        const ordered = orderByEstablishment([pair.low, pair.high], establishment.value)
        return {
          id: pair.id,
          entityDefinitionId: pair.entityDefinitionId,
          score: pair.score,
          band: pair.band,
          signals: pair.signals,
          createdAt: pair.createdAt,
          other: toSideDto(other),
          mergeInstanceIds: ordered,
        }
      })
    }),

  /**
   * The badge term. Carries the SAME archived, snooze and scope filters as
   * {@link list} — a badge counting a different set than the tab renders is the
   * drift bug `use-approvals-count.ts` exists to prevent.
   */
  count: capabilityProcedure.query(async ({ ctx }) => {
    await requireDuplicateDetection(ctx.session.organizationId)
    const scopes = await loadDuplicateScopes(ctx)

    const count = await countOpenDuplicatePairs(ctx.db, {
      organizationId: ctx.session.organizationId,
      scopes,
    })
    if (count.isErr()) throw count.error
    return { count: count.value }
  }),

  /**
   * Dismiss a pair, or snooze it until a date.
   *
   * Resolve-then-authorize: the pair is loaded through the same scoped read the
   * queue uses, so an id the caller cannot see is a 404 rather than a silent
   * write. `dismissedBand` is stamped from the row's own stored band inside the
   * update — never from anything the client sent.
   */
  dismiss: capabilityProcedure
    .input(z.object({ pairId: z.string(), snoozeUntil: z.date().optional() }))
    .mutation(async ({ ctx, input }) => {
      await requireDuplicateDetection(ctx.session.organizationId)
      const scopes = await loadDuplicateScopes(ctx)

      const pair = await getVisibleDuplicatePair(ctx.db, {
        organizationId: ctx.session.organizationId,
        pairId: input.pairId,
        scopes,
      })
      if (pair.isErr()) throw pair.error
      if (!pair.value) throw new NotFoundError('Duplicate suggestion not found')

      const result = await dismissPair(ctx.db, {
        organizationId: ctx.session.organizationId,
        pairId: input.pairId,
        userId: ctx.session.userId,
        snoozeUntil: input.snoozeUntil,
      })
      if (result.isErr()) throw result.error
      return { dismissed: result.value }
    }),
})
