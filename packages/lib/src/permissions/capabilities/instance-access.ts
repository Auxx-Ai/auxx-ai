// packages/lib/src/permissions/capabilities/instance-access.ts

import { Area } from './registry'

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
} as const satisfies Record<string, InstanceAccessResourceConfig>

/** The set of resource keys backed by instance-level access. */
export type InstanceAccessKey = keyof typeof INSTANCE_ACCESS_RESOURCES

/** All instance-access resource keys (for `IN (...)` queries and set membership). */
export const INSTANCE_ACCESS_KEYS = Object.keys(INSTANCE_ACCESS_RESOURCES) as InstanceAccessKey[]

/** Type guard — whether an arbitrary `entityDefinitionId` is an instance-access key. */
export function isInstanceAccessKey(key: string): key is InstanceAccessKey {
  return Object.hasOwn(INSTANCE_ACCESS_RESOURCES, key)
}
