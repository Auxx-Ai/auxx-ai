// packages/lib/src/cache/providers/governing-instance-ids-provider.ts

import { schema } from '@auxx/database'
import { ResourceGranteeType } from '@auxx/database/enums'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { INSTANCE_ACCESS_KEYS } from '../../permissions/capabilities/instance-access'
import { ORG_MEMBER_GRANTEE_ID } from '../../resource-access/grantee-resolution'
import type { CacheProvider } from '../org-cache-provider'

/**
 * The org-wide set of `entityInstanceId`s whose access is **GOVERNED BY ROWS** —
 * an instance somebody authored a restriction on, so the L2 area fallback stands
 * down and a member holding no row of their own is denied.
 *
 * An instance is governed when it carries an **instance-level** `ResourceAccess`
 * row (`entityInstanceId IS NOT NULL`) for an instance-access resource that is
 * EITHER:
 *  - the **workspace baseline** (`role:org_member`) at ANY rung — the authored
 *    statement "this instance's org-wide default is X, not the area level"; or
 *  - an explicit **`rung = 'none'`** row at ANY grantee kind — the per-instance
 *    downward marker.
 *
 * **Deliberately NOT "carries ≥1 row for anyone".** That older reading (the
 * `restrictedInstanceIds` this provider replaces) conflated SHARING with
 * RESTRICTING: the first `user @ edit` row on an otherwise-open instance flipped
 * it to grantees-only for the whole org, while the permissions page's
 * Workspace-defaults tab still rendered it "Inherit → «area level»" — that tab
 * models exactly three states (no `role:org_member` row = Inherit,
 * `role:org_member @ none` = Restricted, else that row's rung; see
 * `use-instance-baseline-rows.ts`). One React hook carried a compensating
 * "materialize the baseline at Read on the first grant" hack for precisely this
 * conflation; it is deleted with this change.
 *
 * The predicate here is **mail's `rowGoverned` verbatim**
 * (`compute-user-instance-grants.ts` — a `role:org_member` row at any rung, or any
 * `none` row), so the capability layer and the mail visibility layer can
 * no longer disagree about which inboxes are governed.
 *
 * **Deliberate behaviour delta:** for the `baselineAtCreate: false` resources
 * (`dataset`, `kb`, `workflow`, `agent`, `inbox`) SHARING an instance no longer
 * RESTRICTS it. Restricting is now an explicit act — set the workspace baseline
 * to Restricted, or write a `none` row. Census 2026-07-29 (local postgres, all
 * orgs): of those keys only `inbox` had instances carrying rows at all — 33, of
 * which 31 carried no governing row, every one of them from
 * `InboxService.createInbox`'s creator-Manager row. So the observable change is
 * mail-only, and there it is a fix: a default org ADMIN at `inboxes: Full` who
 * did not create an inbox stops 403-ing on its Access section.
 *
 * **Still grantee-agnostic WITHIN that filter, and that is load-bearing** (19a
 * finding 1): a `none` row of a grantee kind the resolver cannot expand (a
 * `profile` grantee today) never appears in a member's `instanceAccess` map, so
 * without this org-wide signal it would silently grant instead of deny. Adding a
 * grantee kind to the storage vocabulary still means adding it to every reader in
 * the same change.
 *
 * Only rows keyed by an instance-access resource id count — generic mail-share
 * instance rows (`contact:<id>` etc.) are excluded by the `IN (...)` filter, so
 * they never enter the capability path.
 *
 * Invalidated by the `resource-access.governing-instance.changed` cache event —
 * its own event since v3/03 §9, because `resource-access.instance.changed` became
 * def-agnostic (it busts the capability blob for record-def instance grants too)
 * while this set stays gated on the `IN (...)` filter below.
 */
export const governingInstanceIdsProvider: CacheProvider<string[]> = {
  async compute(orgId, db) {
    const rows = await db
      .select({
        entityInstanceId: schema.ResourceAccess.entityInstanceId,
        granteeType: schema.ResourceAccess.granteeType,
        granteeId: schema.ResourceAccess.granteeId,
        rung: schema.ResourceAccess.rung,
      })
      .from(schema.ResourceAccess)
      .where(
        and(
          eq(schema.ResourceAccess.organizationId, orgId),
          inArray(schema.ResourceAccess.entityDefinitionId, INSTANCE_ACCESS_KEYS),
          isNotNull(schema.ResourceAccess.entityInstanceId)
        )
      )

    // The governing filter runs in JS through the SHARED predicate rather than as
    // a second `WHERE` clause: `effective-state.ts` must answer this question
    // identically from an open transaction (the escalation guard measures the
    // post-write state through the same `effectiveInstanceLevel`), and a SQL copy
    // beside a TypeScript copy is precisely the drift that produced the bug this
    // narrowing fixes. One definition, one test. The candidate set is already
    // small — instance-level rows on instance-access resources for one org — and
    // the result is cached for a day.
    const governing = new Set<string>()
    for (const row of rows) {
      if (row.entityInstanceId && isGoverningInstanceRow(row)) governing.add(row.entityInstanceId)
    }
    return [...governing]
  },
}

/**
 * Whether one instance-level `ResourceAccess` row GOVERNS its instance — the
 * single definition behind both {@link governingInstanceIdsProvider} (cached read
 * path) and `effective-state.ts` (transaction-local escalation guard).
 *
 * True for the authored workspace baseline (`role:org_member`) at ANY rung, and
 * for any `rung = 'none'` marker at ANY grantee kind. False for an
 * ordinary positive grant — a creator's `user @ admin` row or a share to one
 * colleague — because **sharing is not restricting**.
 *
 * Structurally identical to mail's `rowGoverned`
 * (`compute-user-instance-grants.ts`), which is the point: the two layers now
 * answer "is this inbox governed by rows?" the same way by construction. Mail
 * composes its answer per-user from an already grantee-expanded row set, so it
 * cannot share this exact function; if either predicate changes, change both.
 */
export function isGoverningInstanceRow(row: {
  granteeType: string
  granteeId: string
  rung: string
}): boolean {
  if (row.rung === 'none') return true
  return row.granteeType === ResourceGranteeType.role && row.granteeId === ORG_MEMBER_GRANTEE_ID
}
