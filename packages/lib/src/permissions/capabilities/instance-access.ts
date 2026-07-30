// packages/lib/src/permissions/capabilities/instance-access.ts

import { Area, Level, PERMISSION_AREAS, type PermissionKey } from './registry'
import type { Rung } from './rung'

/**
 * A domain evaluated through the **composed per-user capability blob** — its
 * grants are non-local (floors, derivations, workspace baselines) and its
 * instance count is bounded by org setup, so every instance the member can
 * reach is resolved once at compose time and shipped (plan v3/03 §4).
 *
 *  - `baselineAtCreate` — whether every instance is born with a workspace
 *    baseline row. `false` (datasets, kb, workflows): a resource with no
 *    explicit instance rows falls back to the member's base L2 `area` level
 *    (org-shared). `true` (dashboards): no-row ⇒ no access.
 *  - `area` — the coarse L2 capability {@link Area} that gates "may this member
 *    touch the feature at all" AND supplies the absent-row fallback level.
 *  - `rungs` — the domain's grant vocabulary, a sparse ascending subset of
 *    {@link Rung} (plan v3/03 §2.2). Ascending and duplicate-free, so a rung
 *    can be inserted between two existing ones without a data migration.
 */
export interface BlobLaneConfig {
  lane: 'blob'
  baselineAtCreate: boolean
  area: Area
  rungs: readonly Rung[]
}

/**
 * A domain evaluated **in the database, per query** — its grants are row-local
 * and its instance count is unbounded, so no per-user id set is ever composed
 * or cached for it (plan v3/03 §4). It carries NO `area` (the {@link Area} enum
 * has no `threads` and no `sequences` member — `area` exists solely to drive
 * the blob lane's absent-row fallback and L2 gate) and NO `baselineAtCreate`
 * (there is no compose-time baseline to write).
 *
 *  - `rungs` — the domain's grant vocabulary, as above.
 *  - `actAt` — the rung at which the domain's grant confers ACTING, when that
 *    is below `edit`. Mail is the case: `read` on a thread confers reply and
 *    assign, because there is no thread authority axis to express it on
 *    (`registry.ts`, the `inboxesView`/`inboxesManage` note). Absent means the
 *    ordinary reading: acting starts at `edit`.
 */
export interface QueryLaneConfig {
  lane: 'query'
  rungs: readonly Rung[]
  actAt?: Rung
}

/**
 * Per-resource declaration for instance-level access (doc 08 §1.1 / doc 11
 * §1.1), discriminated by evaluation lane.
 *
 * **The lane split is load-bearing, not documentation.** {@link
 * InstanceAccessKey} and every derivation below it filter to `lane: 'blob'`,
 * which is what lets a query-lane domain declare its rung vocabulary here
 * without inheriting the blob lane's six behaviours — see the note on
 * {@link isInstanceAccessKey}.
 */
export type InstanceAccessResourceConfig = BlobLaneConfig | QueryLaneConfig

/**
 * The config-scale vocabulary — today's `view / edit / admin` plus the `none`
 * restriction marker, unchanged in behaviour (plan v3/03 §2.2). Every
 * `baselineAtCreate`-bearing resource except the two inbox keys uses it.
 */
const CONFIG_SCALE_RUNGS = ['none', 'read', 'edit', 'admin'] as const

/**
 * The mail vocabulary. `metadata` and `identity` exist because a mailbox has
 * partial views worth expressing (see plan 40 and `visibility/lens.ts`), and
 * there is deliberately no `edit`: mail's `read` already confers acting
 * (reply/assign), so the only thing above it is managing the inbox itself.
 */
const INBOX_RUNGS = ['none', 'metadata', 'identity', 'read', 'admin'] as const

/**
 * The rung vocabulary of a RECORD definition (plan v3/03 §2.2). A separate
 * constant rather than a registry entry because record defs are CUIDs and can
 * therefore never be registry keys.
 *
 * A def may opt into `identity` later — an ordinal insertion, no migration,
 * with a fixed code-authored projection (the display name, i.e. `RecordMeta`),
 * NOT per-org field mapping. Salesforce-style field-level security stays out of
 * scope.
 */
export const RECORD_DEF_RUNGS: readonly Rung[] = CONFIG_SCALE_RUNGS

/**
 * The registry of resources that take instance-level `ResourceAccess` grants
 * (doc 11 §1.1). Keyed by the resource's non-CUID access key (a system resource
 * id or reserved slug). Datasets was the first entry; KB and dashboards were
 * added by later slices. Everything downstream is generic over
 * {@link InstanceAccessKey} — which is the BLOB-LANE keys only.
 *
 * Record definitions are absent by construction: their keys are CUIDs, so they
 * can never be registry entries. Their vocabulary is {@link RECORD_DEF_RUNGS}.
 */
export const INSTANCE_ACCESS_RESOURCES = {
  // org-shared; absent instance row → base L2 `datasets` level (§0.1)
  dataset: {
    lane: 'blob',
    baselineAtCreate: false,
    area: Area.datasets,
    rungs: CONFIG_SCALE_RUNGS,
  },
  // org-shared; absent instance row → base L2 `knowledgeBase` level (doc 12 §0.2)
  kb: {
    lane: 'blob',
    baselineAtCreate: false,
    area: Area.knowledgeBase,
    rungs: CONFIG_SCALE_RUNGS,
  },
  // fully row-described at birth (workspace baseline + owner admin written at create);
  // absent instance row → NO access (doc 13 §0.1)
  dashboard: {
    lane: 'blob',
    baselineAtCreate: true,
    area: Area.dashboards,
    rungs: CONFIG_SCALE_RUNGS,
  },
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
  workflow: {
    lane: 'blob',
    baselineAtCreate: false,
    area: Area.workflows,
    rungs: CONFIG_SCALE_RUNGS,
  },
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
  agent: { lane: 'blob', baselineAtCreate: false, area: Area.agents, rungs: CONFIG_SCALE_RUNGS },
  // private by default (owner `admin` row at create); absent instance row → NO
  // access (plan 36 §0.2). Deliberately DASHBOARDS' posture, not
  // workflows'/agents': a signature is a personal sign-off and a snippet starts
  // as personal scratch content, so SHARING is the opt-in, not restriction.
  //
  // Instance access gates USER-INITIATED work only. A sequence, workflow, or
  // automated send that stamps a signature runs as the system and reads no
  // member capabilities — the same carve-out `workflow` and `agent` document
  // above. A signature nobody can see still lands on the outgoing mail.
  //
  // WORKER SEATS get neither, by decision (plan 36 §0.5) — see the
  // `WORKER_AREAS` note in `seat-policy.ts` for why that bites even on an
  // instance the field tech owns.
  signature: {
    lane: 'blob',
    baselineAtCreate: true,
    area: Area.signatures,
    rungs: CONFIG_SCALE_RUNGS,
  },
  snippet: { lane: 'blob', baselineAtCreate: true, area: Area.snippets, rungs: CONFIG_SCALE_RUNGS },
  // ── Mail: TWO keys over ONE area (plan 40 §0.2), and the split is the point ──
  //
  // `Area.inboxes` is a single row in the profile editor because "may this
  // member use mail" is one question. But a KEY carries exactly one
  // `baselineAtCreate`, and the two inbox kinds want OPPOSITE postures, so one
  // key cannot serve both:
  //
  //  - A single `false` key would let the org OWNER read every member's personal
  //    mailbox at full lens. `effectiveInstanceLevel` short-circuits
  //    `role === 'OWNER' → admin` **but only for `baselineAtCreate: false`**
  //    (`entity-access.ts`), and that branch runs FIRST — so an explicit
  //    `role:org_member @ none` row would not stop it either. Today an admin is
  //    capped at `metadata` on a personal mailbox (`effective-lens.ts`), so that
  //    is a privacy regression, and the OWNER-bypass docstring is verbatim about
  //    this case ("reading a member's private content is a different power, and
  //    it is not one org ownership confers"). A personal mailbox is its
  //    archetype.
  //  - A single `true` key would give admins `inboxes: Full` and still no shared
  //    inbox without an explicit row — forcing the `vis.isAdmin` bypass back in,
  //    i.e. re-importing role-as-authority into the exact place plan 39 removed
  //    it from.
  //
  // SAFETY PROPERTY THAT MUST KEEP HOLDING: `OrgSharedInstanceAccessKey`
  // (`entity-access.ts`) is derived as "`lane: 'blob'` AND
  // `baselineAtCreate: false` only", so
  // `personal_inbox` is a COMPILE ERROR at every `instanceListScope` call site.
  // A list query cannot start leaking other people's mailboxes silently — it has
  // to fail the build first.
  //
  // Instance access gates USER-INITIATED work only, the same carve-out
  // `workflow` / `agent` / `signature` document above: ingest, automation,
  // sequences and workflows write and read mail as the system and consult no
  // member capabilities, so a restricted inbox still receives and still sends.
  //
  // org-shared; absent instance row → base L2 `inboxes` level, i.e.
  // `Read → view` / `Full → admin` (plan 40 §1.2 — read that note in
  // `registry.ts` before changing either rung).
  inbox: { lane: 'blob', baselineAtCreate: false, area: Area.inboxes, rungs: INBOX_RUNGS },
  // private; absent instance row → NO access. Dashboards'/signatures' posture,
  // for a stronger reason than either: a personal mailbox is not "content that
  // starts private", it is content nobody else has a claim on by rank.
  personal_inbox: { lane: 'blob', baselineAtCreate: true, area: Area.inboxes, rungs: INBOX_RUNGS },
  // ── QUERY LANE — declared here for their vocabulary ONLY ────────────────────
  //
  // These two are NOT `InstanceAccessKey`s and must never become them. They sit
  // in this table so that one place answers "which rungs may a grant on this
  // domain take" — the share picker renders the declaration — while every
  // derivation below filters to `lane: 'blob'` so their presence changes no
  // behaviour. Read the {@link isInstanceAccessKey} note for the six behaviours
  // a plain entry would have flipped.
  //
  // Mail threads: unbounded per org and evaluated against the composed mail
  // visibility blob, never against `instanceAccess`. `identity` is today's
  // `subject`; `read` is today's `full`.
  //
  // `actAt: 'read'` — mail's read rung confers reply and assign. That is not a
  // convenience: `registry.ts` gives `Area.inboxes` exactly two rungs
  // (`inboxesView` / `inboxesManage`) precisely BECAUSE there is no thread
  // authority axis to express "may read but not reply" on. The rung ladder must
  // record where acting starts rather than assume `edit`, since `edit` is not
  // in this domain's vocabulary at all.
  thread: { lane: 'query', rungs: ['none', 'metadata', 'identity', 'read'], actAt: 'read' },
  // Sequences: QUERY-LANE PRIOR ART, and the reason this lane is not
  // speculative. §2.2 of plan v3/03 omits `sequence`, which is a gap in the
  // plan — it is the largest instance-grant lane in the dev database (235 rows,
  // more than snippet or dashboard), and `sequences/access.ts` already resolves
  // it with an uncached direct `hasPermission` query per request: exactly the
  // model §4/§5 propose for records. It has never had an `Area` member, never
  // had a `baselineAtCreate`, and never appeared in a composed blob.
  sequence: { lane: 'query', rungs: CONFIG_SCALE_RUNGS },
} as const satisfies Record<string, InstanceAccessResourceConfig>

/** Every key declared in {@link INSTANCE_ACCESS_RESOURCES}, both lanes. */
type DeclaredInstanceAccessKey = keyof typeof INSTANCE_ACCESS_RESOURCES

/**
 * The set of resource keys backed by the BLOB lane — i.e. by `instanceAccess` /
 * `baselineInstanceAccess` in the composed capability blob.
 *
 * Derived by filtering the registry to `lane: 'blob'`, NOT by `keyof`. Query-
 * lane declarations (`thread`, `sequence`) are deliberately excluded: they
 * declare a rung vocabulary and nothing else.
 */
export type InstanceAccessKey = {
  [K in DeclaredInstanceAccessKey]: (typeof INSTANCE_ACCESS_RESOURCES)[K]['lane'] extends 'blob'
    ? K
    : never
}[DeclaredInstanceAccessKey]

/** All blob-lane resource keys (for `IN (...)` queries and set membership). */
export const INSTANCE_ACCESS_KEYS = (
  Object.keys(INSTANCE_ACCESS_RESOURCES) as DeclaredInstanceAccessKey[]
).filter((key): key is InstanceAccessKey => INSTANCE_ACCESS_RESOURCES[key].lane === 'blob')

const INSTANCE_ACCESS_KEY_SET: ReadonlySet<string> = new Set(INSTANCE_ACCESS_KEYS)

/**
 * Type guard — whether an arbitrary `entityDefinitionId` is a BLOB-LANE
 * instance-access key.
 *
 * **Membership in {@link INSTANCE_ACCESS_KEYS}, deliberately not
 * `Object.hasOwn(INSTANCE_ACCESS_RESOURCES, key)`.** This predicate is the
 * switch on six separate behaviours, and a query-lane key answering `true`
 * would silently flip all of them:
 *
 *  1. `authorizeInstanceTarget` (`routers/resourceAccess.ts`) would assert
 *     `assertAdminInstance(key, id)` instead of falling through to
 *     `assertCanManageMailSharing` — re-routing mail's entire share
 *     authorization.
 *  2. The `none` rejection in the same router would start ALLOWING `none` rows
 *     on threads.
 *  3. `emitResourceAccessInstanceChanged` would fire on the hottest lane in the
 *     product.
 *  4. `governingInstanceIdsProvider`'s SQL filter would ingest thread rows.
 *  5. `deriveInstanceReadKeys` would grant `INSTANCE_ACCESS_READ_KEYS[key]`.
 *  6. {@link import('./entity-access').OrgSharedInstanceAccessKey} would widen,
 *     destroying the compile-error safety property the `personal_inbox` note
 *     above spells out.
 *
 * Every one of those reads the blob lane. The guard therefore names the blob
 * lane, and adding a query-lane declaration is inert by construction.
 */
export function isInstanceAccessKey(key: string): key is InstanceAccessKey {
  return INSTANCE_ACCESS_KEY_SET.has(key)
}

/**
 * Whether `key` is declared in this registry **at all**, in either lane.
 *
 * The deliberate counterpart to {@link isInstanceAccessKey}, and the two must
 * never be conflated: that one answers *"does the blob-lane machinery govern
 * this?"* and is `false` for `thread` and `sequence`; this one answers *"is this
 * a known, named domain rather than an `EntityDefinition` CUID?"* and is `true`
 * for both.
 *
 * It exists because "is this a record def?" cannot be asked as
 * `!isInstanceAccessKey(id)` — that reads `true` for `thread` and `sequence`,
 * which would put mail threads and sequences into the record lane's front door.
 * A record def is one that appears in NEITHER this registry NOR
 * `MAIL_SHARING_DEFS`; both exclusions are required and neither is sufficient.
 *
 * This is exactly the predicate `isInstanceAccessKey` was before the lane split
 * (`Object.hasOwn` over the registry). It is kept under a name that says what it
 * means so the two can never be swapped back by accident.
 */
export function isDeclaredInstanceDomain(key: string): boolean {
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
 * Blob-lane only, via {@link INSTANCE_ACCESS_KEYS} — a query-lane domain has no
 * {@link Area} to derive a front-door key from, and must not synthesize one.
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
