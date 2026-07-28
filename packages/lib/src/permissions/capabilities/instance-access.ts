// packages/lib/src/permissions/capabilities/instance-access.ts

import { Area, Level, PERMISSION_AREAS, type PermissionKey } from './registry'

/**
 * Per-resource declaration for instance-level access (doc 08 §1.1 / doc 11 §1.1).
 *  - `baselineAtCreate` — whether every instance is born with a workspace
 *    baseline row. `false` (datasets, kb, workflows): a resource with no
 *    explicit instance rows falls back to the member's base L2 `area` level
 *    (org-shared). `true` (dashboards): no-row ⇒ no access.
 *  - `area` — the coarse L2 capability {@link Area} that gates "may this member
 *    touch the feature at all" AND supplies the absent-row fallback level.
 */
export interface InstanceAccessResourceConfig {
  baselineAtCreate: boolean
  area: Area
}

/**
 * The registry of resources that use instance-level `ResourceAccess` grants
 * (doc 11 §1.1). Keyed by the resource's non-CUID access key (a system resource
 * id or reserved slug). Datasets was the first entry; KB and dashboards were
 * added by later slices. Everything downstream is generic over
 * {@link InstanceAccessKey}.
 */
export const INSTANCE_ACCESS_RESOURCES = {
  // org-shared; absent instance row → base L2 `datasets` level (§0.1)
  dataset: { baselineAtCreate: false, area: Area.datasets },
  // org-shared; absent instance row → base L2 `knowledgeBase` level (doc 12 §0.2)
  kb: { baselineAtCreate: false, area: Area.knowledgeBase },
  // fully row-described at birth (workspace baseline + owner admin written at create);
  // absent instance row → NO access (doc 13 §0.1)
  dashboard: { baselineAtCreate: true, area: Area.dashboards },
  // org-shared; absent instance row → base L2 `workflows` level (plan 30 §3).
  // Deliberately the OPPOSITE of dashboards: members compose `workflows: Full`,
  // so RESTRICTION is the use case (lock the billing automation away from
  // general editing), and `false` means no create-time row write and no backfill
  // migration. The `Area.workflows` Read/Edit rungs (plan 30 §1) exist precisely
  // so this fallback can land on a real view/edit tier.
  //
  // Instance access gates USER-INITIATED work only. Headless execution
  // (schedules, record events, record rules, webhooks, polling, app triggers)
  // runs as the system and reads no member capabilities, so a workflow
  // restricted to `none` still fires — see the `Area.workflows` note in
  // `registry.ts` and plan 30 §2.1.
  workflow: { baselineAtCreate: false, area: Area.workflows },
  // org-shared; absent instance row → base L2 `agents` level (plan 25 §4.2).
  // Same posture as workflows and for the same reason: members compose
  // `agents: Full`, so RESTRICTION is the use case ("only the support leads may
  // touch the escalation agent"), and `false` means no create-time row write
  // and no backfill migration. The `Area.agents` Read/Edit rungs exist
  // precisely so this fallback can land on a real view/edit tier.
  //
  // `view` means USABLE, not merely visible (user decision 2026-07-27): chat in
  // Kopilot, DM, @-mention, assign, and appear in actor pickers. There was no
  // pre-existing "usable but not editable" tier to preserve — `actor.list` /
  // `actor.search` filtered agents not at all, and `dmEnabled` / `mentionable`
  // are org-wide booleans with no grantee dimension.
  //
  // Instance access gates HUMAN-INITIATED work only. The autonomous paths
  // (schedule, record event, app trigger, webhook, visitor, eval) pass no
  // `invokerUserId` by design, so a restricted agent still runs headlessly —
  // the same carve-out `workflow` documents above.
  agent: { baselineAtCreate: false, area: Area.agents },
} as const satisfies Record<string, InstanceAccessResourceConfig>

/** The set of resource keys backed by instance-level access. */
export type InstanceAccessKey = keyof typeof INSTANCE_ACCESS_RESOURCES

/** All instance-access resource keys (for `IN (...)` queries and set membership). */
export const INSTANCE_ACCESS_KEYS = Object.keys(INSTANCE_ACCESS_RESOURCES) as InstanceAccessKey[]

/** Type guard — whether an arbitrary `entityDefinitionId` is an instance-access key. */
export function isInstanceAccessKey(key: string): key is InstanceAccessKey {
  return Object.hasOwn(INSTANCE_ACCESS_RESOURCES, key)
}

/**
 * The `Level.Read` rung keys of each instance-access resource's L2 area, keyed
 * BY RESOURCE — the keys {@link import('./compose-user-capabilities')
 * .composeUserCapabilities} synthesizes for a member who holds ≥1 instance grant
 * reaching `view` on that resource (plan 25 §2 / handoff item 5b).
 *
 * Since an explicit instance row beats the area floor
 * ({@link import('./entity-access').effectiveInstanceLevel}), a member composing
 * `workflows: None` who holds one `view` grant genuinely has workflow access —
 * but their composed key set, built purely from resolved AREA levels, said
 * otherwise, so every coarse gate (sidebar, cmd+K, landing-page guards, the
 * `permissionProcedure` front door) fired against them. Deriving the Read rung
 * from the grants they actually hold makes the coarse key TRUE for exactly the
 * members it should be true for.
 *
 * **Read rung only, deliberately.** The higher rungs of these same areas front
 * the instance-LESS actions — `workflowsManage` fronts `create` /
 * `createForResource`, `datasetsManage` fronts dataset creation — which have no
 * instance to assert on, so an `admin` grant on ONE instance must never expand
 * to them. The derived key confers only "the feature's front door is open"; the
 * per-instance `assert{View,Edit,Admin}Instance` still decides everything else.
 *
 * **Per-resource, not a flat union.** The predecessor of this map was a single
 * type-blind `Set` used by the `permissionProcedure` waiver; because dashboards
 * are `baselineAtCreate: true`, every dashboard writes a `role:org_member @ view`
 * row at create, so in any org with ≥1 dashboard "holds an instance grant" was
 * effectively always true and the front door stood open on ALL four areas.
 * Keying by resource is what makes a dashboard grant confer `dashboards.view`
 * and nothing else.
 *
 * Derived from {@link INSTANCE_ACCESS_RESOURCES} rather than hand-listed: an
 * area with no `Level.Read` rung contributes nothing and therefore fails closed.
 */
export const INSTANCE_ACCESS_READ_KEYS: Readonly<
  Record<InstanceAccessKey, readonly PermissionKey[]>
> = INSTANCE_ACCESS_KEYS.reduce(
  (acc, key) => {
    acc[key] =
      PERMISSION_AREAS[INSTANCE_ACCESS_RESOURCES[key].area].rungs.find(
        (rung) => rung.level === Level.Read
      )?.keys ?? []
    return acc
  },
  {} as Record<InstanceAccessKey, readonly PermissionKey[]>
)
