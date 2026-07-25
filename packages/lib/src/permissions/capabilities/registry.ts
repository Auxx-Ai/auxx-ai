// packages/lib/src/permissions/capabilities/registry.ts

import { FeatureKey } from '../types'

/**
 * Coarse, per-feature-area capability verbs (Layer 2 — member capability).
 *
 * These are NOT per-field/per-record (that's Layer 3 ResourceAccess). Keys are
 * forever-ish once orgs configure grants against them — start coarse, split
 * later only when a real org needs it. See plans/permissions/v2/README.md.
 */
export enum PermissionKey {
  // records / CRM
  recordsView = 'records.view',
  recordsEdit = 'records.edit',
  recordsDelete = 'records.delete',
  recordsImport = 'records.import',
  /** READ-ONLY records reachable from a field seat's visits (row-scoped, §4.1). */
  recordsViewLinked = 'records.viewLinked',

  // automation
  workflowsManage = 'workflows.manage',
  agentsManage = 'agents.manage',

  // collaboration
  commentsManage = 'comments.manage',

  // dispatch
  dispatchBoardView = 'dispatch.board.view',
  dispatchBoardManage = 'dispatch.board.manage',
  dispatchMySchedule = 'dispatch.mySchedule',
  dispatchVisitReports = 'dispatch.visitReports',

  // org administration
  settingsManage = 'settings.manage',
  billingView = 'billing.view',
  billingManage = 'billing.manage',
  membersManage = 'members.manage',
  permissionsManage = 'permissions.manage',
  integrationsManage = 'integrations.manage',
  aiConfigManage = 'aiConfig.manage',
  automationRulesManage = 'automationRules.manage',
  auditLogView = 'auditLog.view',

  // files
  filesView = 'files.view',
  filesManage = 'files.manage',

  // connectors
  connectorsManage = 'connectors.manage',

  // datasets (instance-access resource — per-dataset ResourceAccess grants, §2)
  datasetsView = 'datasets.view',
  datasetsEdit = 'datasets.edit',
  datasetsManage = 'datasets.manage',

  // knowledge bases (instance-access resource — per-KB ResourceAccess grants, doc 12 §2)
  knowledgeBaseView = 'knowledgeBase.view',
  knowledgeBaseEdit = 'knowledgeBase.edit',
  knowledgeBaseManage = 'knowledgeBase.manage',

  // dashboards (instance-access resource — per-dashboard ResourceAccess grants, doc 13 §2)
  dashboardsView = 'dashboards.view',
  dashboardsManage = 'dashboards.manage',
}

/** Metadata describing a single capability key. Mirrors `FeatureMetadata`. */
export interface PermissionMetadata {
  key: PermissionKey
  label: string
  description: string
  /** Settings-UI grouping, like `FeatureMetadata.group`. */
  group: string
  /** Layer-1 plan link — the declarative plan-AND (§2.B). */
  featureKey?: FeatureKey
  /** Never grantable below ADMIN — excluded from the USER role default. */
  adminOnly?: boolean
}

/** Single source of truth for all capability keys, labels, groups, and plan links. */
export const PERMISSION_REGISTRY: PermissionMetadata[] = [
  // ── Records ──
  {
    key: PermissionKey.recordsView,
    label: 'View Records',
    description: 'Browse and read CRM records.',
    group: 'Records',
  },
  {
    key: PermissionKey.recordsEdit,
    label: 'Edit Records',
    description: 'Create and update CRM records.',
    group: 'Records',
  },
  {
    key: PermissionKey.recordsDelete,
    label: 'Delete Records',
    description: 'Delete or merge CRM records.',
    group: 'Records',
  },
  {
    key: PermissionKey.recordsImport,
    label: 'Import Records',
    description: 'Bulk-import records into the CRM.',
    group: 'Records',
  },
  {
    key: PermissionKey.recordsViewLinked,
    label: 'View Linked Records',
    description: 'Read-only access to records linked to the member’s own visits.',
    group: 'Records',
  },

  // ── Automation ──
  {
    key: PermissionKey.workflowsManage,
    label: 'Manage Workflows',
    description: 'Create, edit, and run automation workflows.',
    group: 'Automation',
    featureKey: FeatureKey.workflows,
  },
  {
    key: PermissionKey.agentsManage,
    label: 'Manage Agents',
    description: 'Create and configure Kopilot agents.',
    group: 'Automation',
    featureKey: FeatureKey.agents,
  },

  // ── Collaboration ──
  {
    key: PermissionKey.commentsManage,
    label: 'Manage Comments',
    description: 'Write, edit, and delete comments on records.',
    group: 'Collaboration',
  },

  // ── Dispatch ──
  {
    key: PermissionKey.dispatchBoardView,
    label: 'View Dispatch Board',
    description: 'See the dispatch board and schedule.',
    group: 'Dispatch',
    featureKey: FeatureKey.dispatch,
  },
  {
    key: PermissionKey.dispatchBoardManage,
    label: 'Manage Dispatch Board',
    description: 'Assign, schedule, and configure dispatch.',
    group: 'Dispatch',
    featureKey: FeatureKey.dispatch,
  },
  {
    key: PermissionKey.dispatchMySchedule,
    label: 'My Schedule',
    description: 'See and act on the member’s own assigned visits.',
    group: 'Dispatch',
    featureKey: FeatureKey.dispatch,
  },
  {
    key: PermissionKey.dispatchVisitReports,
    label: 'Visit Reports',
    description: 'Check in, file visit reports, and upload photos.',
    group: 'Dispatch',
    featureKey: FeatureKey.dispatch,
  },

  // ── Organization ──
  {
    key: PermissionKey.settingsManage,
    label: 'Manage Settings',
    description: 'Change organization-wide settings.',
    group: 'Organization',
    adminOnly: true,
  },
  {
    key: PermissionKey.billingView,
    label: 'View Billing',
    description: 'View the plan, usage, and invoices.',
    group: 'Organization',
  },
  {
    key: PermissionKey.billingManage,
    label: 'Manage Billing',
    description: 'View and change the plan, seats, and billing.',
    group: 'Organization',
  },
  {
    key: PermissionKey.membersManage,
    label: 'Manage Members',
    description: 'Invite, remove, and change roles/seats of members.',
    group: 'Organization',
  },
  {
    key: PermissionKey.permissionsManage,
    label: 'Manage Permissions',
    description: 'Configure permission profiles and capability grants for groups and members.',
    group: 'Organization',
    featureKey: FeatureKey.granularPermissions,
    // NOT adminOnly since doc 19 §0.25 — see `PERMISSION_AREAS[Area.permissions]`.
  },

  // ── Integrations ──
  {
    key: PermissionKey.integrationsManage,
    label: 'Manage Integrations',
    description: 'Install and configure apps, MCP servers, and webhooks.',
    group: 'Integrations',
  },

  // ── AI ──
  {
    key: PermissionKey.aiConfigManage,
    label: 'Manage AI Config',
    description: 'Configure AI models and Kopilot organization defaults.',
    group: 'AI',
  },

  // ── Automation (rules) ──
  {
    key: PermissionKey.automationRulesManage,
    label: 'Manage Rules',
    description: 'Create, edit, and delete record automation rules.',
    group: 'Automation',
  },

  // ── Organization (audit) ──
  {
    key: PermissionKey.auditLogView,
    label: 'View Account Activity',
    description: 'View the organization audit log.',
    group: 'Organization',
  },

  // ── Files ──
  {
    key: PermissionKey.filesView,
    label: 'View Files',
    description: 'List, search, preview, and download files.',
    group: 'Files',
    featureKey: FeatureKey.files,
  },
  {
    key: PermissionKey.filesManage,
    label: 'Manage Files',
    description: 'Delete, restore, archive, move, rename, copy, and version files and folders.',
    group: 'Files',
    featureKey: FeatureKey.files,
  },

  // ── Connectors ──
  {
    key: PermissionKey.connectorsManage,
    label: 'Manage Connectors',
    description: 'Create, configure, sync, and delete data connectors.',
    group: 'Integrations',
    featureKey: FeatureKey.dataConnectors,
  },

  // ── Datasets ──
  {
    key: PermissionKey.datasetsView,
    label: 'View Datasets',
    description: 'Browse and use datasets in search and agents.',
    group: 'Knowledge',
    featureKey: FeatureKey.datasets,
  },
  {
    key: PermissionKey.datasetsEdit,
    label: 'Contribute to Datasets',
    description: 'Add and manage the files inside datasets.',
    group: 'Knowledge',
    featureKey: FeatureKey.datasets,
  },
  {
    key: PermissionKey.datasetsManage,
    label: 'Manage Datasets',
    description: 'Create, delete, and configure datasets and their settings.',
    group: 'Knowledge',
    featureKey: FeatureKey.datasets,
  },

  // ── Knowledge Bases ──
  {
    key: PermissionKey.knowledgeBaseView,
    label: 'View Knowledge Bases',
    description: 'Read the articles inside knowledge bases.',
    group: 'Knowledge',
    featureKey: FeatureKey.knowledgeBase,
  },
  {
    key: PermissionKey.knowledgeBaseEdit,
    label: 'Write Knowledge Base Articles',
    description: 'Write, publish, and organize the articles inside knowledge bases.',
    group: 'Knowledge',
    featureKey: FeatureKey.knowledgeBase,
  },
  {
    key: PermissionKey.knowledgeBaseManage,
    label: 'Manage Knowledge Bases',
    description: 'Create, delete, and configure knowledge bases and their settings.',
    group: 'Knowledge',
    featureKey: FeatureKey.knowledgeBase,
  },

  // ── Dashboards ──
  {
    key: PermissionKey.dashboardsView,
    label: 'View Dashboards',
    description: 'See dashboards shared with you.',
    group: 'Analytics',
    featureKey: FeatureKey.dashboards,
  },
  {
    key: PermissionKey.dashboardsManage,
    label: 'Manage Dashboards',
    description: 'Create, delete, and configure dashboards.',
    group: 'Analytics',
    featureKey: FeatureKey.dashboards,
  },
]

/** Lookup map for quick access to a key's metadata. */
export const PERMISSION_REGISTRY_MAP = new Map(PERMISSION_REGISTRY.map((p) => [p.key, p]))

/** All valid PermissionKey string values (registry-validation set). */
const PERMISSION_KEY_SET = new Set<string>(Object.values(PermissionKey))

/** Type guard: whether an arbitrary string is a registered PermissionKey. */
export function isPermissionKey(key: string): key is PermissionKey {
  return PERMISSION_KEY_SET.has(key)
}

/** Registry-ordered PermissionKey list (used to keep key output deterministic). */
const PERMISSION_KEY_ORDER = Object.values(PermissionKey)

// ─────────────────────────────────────────────────────────────────────────────
// Leveled model (v1.5) — areas, rungs, sparse level storage.
//
// The `PermissionKey` enum above stays the atomic enforcement unit. v1.5 groups
// the keys into coarse `Area`s, each a ladder of access `Level`s (None/Read/Edit/
// Full). A grantee stores a sparse jsonb map `{ areaSlug: Level }` (absent area =
// unset → falls through to the code default); composition resolves per-area
// levels → expands back to a PermissionKey set. See
// plans/permissions/capability-layer-v1.5-leveled-model.md §3/§7.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-area access rung. Ordered `None(0) < Read(1) < Edit(2) < Full(3)` so
 * composition's `max`/`min` are plain numeric comparisons. Toggle areas are
 * degenerate ladders that only use `None`/`Full`.
 */
export enum Level {
  None = 0,
  Read = 1,
  Edit = 2,
  Full = 3,
}

/** Coarse capability area slugs — the level ladder is defined per area. */
export enum Area {
  records = 'records',
  recordsLinked = 'recordsLinked',
  workflows = 'workflows',
  agents = 'agents',
  comments = 'comments',
  dispatchBoard = 'dispatchBoard',
  dispatchMySchedule = 'dispatchMySchedule',
  dispatchVisitReports = 'dispatchVisitReports',
  settings = 'settings',
  billing = 'billing',
  members = 'members',
  permissions = 'permissions',
  integrations = 'integrations',
  aiConfig = 'aiConfig',
  automationRules = 'automationRules',
  auditLog = 'auditLog',
  files = 'files',
  connectors = 'connectors',
  datasets = 'datasets',
  knowledgeBase = 'knowledgeBase',
  dashboards = 'dashboards',
}

/** A single rung of an area's ladder — the keys ADDED at (and above) `level`. */
interface AreaRung {
  level: Level
  /** Keys introduced at this rung; expansion unions every rung with `level ≤ target`. */
  keys: PermissionKey[]
}

/** Metadata describing one capability area (its ladder + Layer-1/admin gates). */
export interface AreaMetadata {
  area: Area
  /** Human label for the settings grid row. */
  label: string
  /** One-line description shown beside the level control. */
  description: string
  /** Settings-UI grouping — mirrors `PermissionMetadata.group`. */
  group: string
  /** Rungs in ascending level order; each lists only the keys it introduces. */
  rungs: AreaRung[]
  /** Never grantable below ADMIN — forced to `None` in the USER baseline. */
  adminOnly?: boolean
  /**
   * Only meaningful on a `worker` seat — hidden from the settings grid. The area
   * still expands to its keys for every seat (role defaults are seat-agnostic),
   * but its enforcement is seat-scoped, so exposing a level control for full
   * seats would be a lever that does nothing.
   */
  workerOnly?: boolean
  /**
   * The area is grantable in the model, but the routers behind it are still
   * fronted by a binary `adminProcedure` / `isAdminOrOwner` gate — so turning it
   * off in a profile changes nothing and an unlocked control would be lying
   * (doc 19 §5.3). Rows render locked with *"Still role-gated — admins reach
   * this regardless."* Drop the flag per area as its routers migrate to
   * `permissionProcedure`.
   *
   * This applies to any profile bound to an ADMIN member, not only the `admin`
   * system profile — a custom profile on an admin has the identical problem.
   * Step 10 populates it; no area sets it yet.
   */
  roleGated?: boolean
  /** Layer-1 plan link — the area's keys AND the org's plan feature. */
  featureKey?: FeatureKey
}

/**
 * Single source of truth for the area→level→keys expansion (§3 table). Toggle
 * areas list a lone `Full` rung; hybrid areas (`dispatchBoard`) simply skip the
 * `Edit` rung. Tickets are governed as an entity def (per-def ResourceAccess on
 * the `ticket` def, `records` area), not a standalone area.
 */
export const PERMISSION_AREAS: Record<Area, AreaMetadata> = {
  [Area.records]: {
    area: Area.records,
    label: 'Records',
    description: 'Read, edit, delete, and import CRM records.',
    group: 'Records',
    rungs: [
      { level: Level.Read, keys: [PermissionKey.recordsView] },
      { level: Level.Edit, keys: [PermissionKey.recordsEdit] },
      { level: Level.Full, keys: [PermissionKey.recordsDelete, PermissionKey.recordsImport] },
    ],
  },
  [Area.recordsLinked]: {
    area: Area.recordsLinked,
    label: 'Linked records',
    description: 'Read-only access to records linked to the member’s own visits.',
    group: 'Records',
    rungs: [{ level: Level.Full, keys: [PermissionKey.recordsViewLinked] }],
    // Worker-seat surface only: `canViewRecord`'s carve-out is gated on
    // `seatType === 'worker'`, so the control is inert for full seats.
    workerOnly: true,
  },
  [Area.workflows]: {
    area: Area.workflows,
    label: 'Workflows',
    description: 'Create, edit, and run automation workflows.',
    group: 'Automation',
    rungs: [{ level: Level.Full, keys: [PermissionKey.workflowsManage] }],
    featureKey: FeatureKey.workflows,
  },
  [Area.agents]: {
    area: Area.agents,
    label: 'Agents',
    description: 'Create and configure Kopilot agents.',
    group: 'Automation',
    rungs: [{ level: Level.Full, keys: [PermissionKey.agentsManage] }],
    featureKey: FeatureKey.agents,
  },
  [Area.comments]: {
    area: Area.comments,
    label: 'Comments',
    description: 'Write, edit, and delete comments on records.',
    group: 'Collaboration',
    rungs: [{ level: Level.Full, keys: [PermissionKey.commentsManage] }],
  },
  [Area.dispatchBoard]: {
    area: Area.dispatchBoard,
    label: 'Dispatch board',
    description: 'View the dispatch board, or assign and configure it.',
    group: 'Dispatch',
    rungs: [
      { level: Level.Read, keys: [PermissionKey.dispatchBoardView] },
      { level: Level.Full, keys: [PermissionKey.dispatchBoardManage] },
    ],
    featureKey: FeatureKey.dispatch,
  },
  [Area.dispatchMySchedule]: {
    area: Area.dispatchMySchedule,
    label: 'My schedule',
    description: 'See and act on the member’s own assigned visits.',
    group: 'Dispatch',
    rungs: [{ level: Level.Full, keys: [PermissionKey.dispatchMySchedule] }],
    featureKey: FeatureKey.dispatch,
  },
  [Area.dispatchVisitReports]: {
    area: Area.dispatchVisitReports,
    label: 'Visit reports',
    description: 'Check in, file visit reports, and upload photos.',
    group: 'Dispatch',
    rungs: [{ level: Level.Full, keys: [PermissionKey.dispatchVisitReports] }],
    featureKey: FeatureKey.dispatch,
  },
  [Area.settings]: {
    area: Area.settings,
    label: 'Settings',
    description: 'Change organization-wide settings.',
    group: 'Organization',
    rungs: [{ level: Level.Full, keys: [PermissionKey.settingsManage] }],
    adminOnly: true,
  },
  [Area.billing]: {
    area: Area.billing,
    label: 'Billing',
    description: 'View the plan and invoices, or change the plan, seats, and payment method.',
    group: 'Organization',
    rungs: [
      { level: Level.Read, keys: [PermissionKey.billingView] },
      { level: Level.Full, keys: [PermissionKey.billingManage] },
    ],
  },
  [Area.members]: {
    area: Area.members,
    label: 'Members',
    description: 'Invite, remove, and change roles and seats of members.',
    group: 'Organization',
    rungs: [{ level: Level.Full, keys: [PermissionKey.membersManage] }],
  },
  [Area.permissions]: {
    area: Area.permissions,
    label: 'Permissions',
    description: 'Configure permission profiles and capability grants for groups and members.',
    group: 'Organization',
    rungs: [{ level: Level.Full, keys: [PermissionKey.permissionsManage] }],
    // Doc 19 §0.25 reverses doc 09's deferral: this area is GRANTABLE. It governs
    // creating/editing permission profiles and assigning them to HUMANS. The USER
    // default stays `None` (it is in `USER_ADMIN_NONE_AREAS`, the real source of
    // truth for the baseline — dropping `adminOnly` must never flip a default on).
    // Agent-side profile editing and assignment stay OWNER/ADMIN-only and are
    // enforced separately in `profile-save.ts` / `profile-mutations.ts`, not by
    // this area (doc 14 §0.9). `permissionsRouter` is fronted by the
    // `permissionsManage` capability rather than `adminProcedure`, so the grant
    // actually reaches a non-admin holder, so this area is deliberately NOT
    // `roleGated`. Every OTHER router in the org group is still binary-role-gated;
    // step 10 audits those and sets `roleGated` on the areas that need it.
    featureKey: FeatureKey.granularPermissions,
  },
  [Area.integrations]: {
    area: Area.integrations,
    label: 'Integrations',
    description: 'Install and configure apps, MCP servers, and webhooks.',
    group: 'Integrations',
    rungs: [{ level: Level.Full, keys: [PermissionKey.integrationsManage] }],
  },
  [Area.aiConfig]: {
    area: Area.aiConfig,
    label: 'AI configuration',
    description: 'Configure AI models and Kopilot organization defaults.',
    group: 'AI',
    rungs: [{ level: Level.Full, keys: [PermissionKey.aiConfigManage] }],
  },
  [Area.automationRules]: {
    area: Area.automationRules,
    label: 'Rules',
    description: 'Create, edit, and delete record automation rules.',
    group: 'Automation',
    rungs: [{ level: Level.Full, keys: [PermissionKey.automationRulesManage] }],
  },
  [Area.auditLog]: {
    area: Area.auditLog,
    label: 'Account activity',
    description: 'View the organization audit log.',
    group: 'Organization',
    rungs: [{ level: Level.Read, keys: [PermissionKey.auditLogView] }],
  },
  [Area.files]: {
    area: Area.files,
    label: 'Files',
    description: 'Browse and download files, or manage them (delete, move, rename, version).',
    group: 'Files',
    rungs: [
      { level: Level.Read, keys: [PermissionKey.filesView] },
      { level: Level.Full, keys: [PermissionKey.filesManage] },
    ],
    featureKey: FeatureKey.files,
  },
  [Area.connectors]: {
    area: Area.connectors,
    label: 'Connectors',
    description: 'Create, configure, sync, and delete data connectors.',
    group: 'Integrations',
    rungs: [{ level: Level.Full, keys: [PermissionKey.connectorsManage] }],
    featureKey: FeatureKey.dataConnectors,
  },
  [Area.datasets]: {
    area: Area.datasets,
    label: 'Datasets',
    description: 'Browse and use datasets, contribute files, or manage them and their settings.',
    group: 'Knowledge',
    rungs: [
      { level: Level.Read, keys: [PermissionKey.datasetsView] },
      { level: Level.Edit, keys: [PermissionKey.datasetsEdit] },
      { level: Level.Full, keys: [PermissionKey.datasetsManage] },
    ],
    featureKey: FeatureKey.datasets,
  },
  [Area.knowledgeBase]: {
    area: Area.knowledgeBase,
    label: 'Knowledge Base',
    description:
      'Read articles, write & publish them, or manage the knowledge base and its settings.',
    group: 'Knowledge',
    rungs: [
      { level: Level.Read, keys: [PermissionKey.knowledgeBaseView] },
      { level: Level.Edit, keys: [PermissionKey.knowledgeBaseEdit] },
      { level: Level.Full, keys: [PermissionKey.knowledgeBaseManage] },
    ],
    // Layer-1 boolean access gate (types.ts:31) — NOT the plural
    // FeatureKey.knowledgeBases (types.ts:61), which is the numeric KB-count limit.
    featureKey: FeatureKey.knowledgeBase,
  },
  [Area.dashboards]: {
    area: Area.dashboards,
    label: 'Dashboards',
    description: 'See dashboards shared with you, or create and manage dashboards.',
    group: 'Analytics',
    rungs: [
      { level: Level.Read, keys: [PermissionKey.dashboardsView] },
      { level: Level.Full, keys: [PermissionKey.dashboardsManage] },
    ],
    featureKey: FeatureKey.dashboards,
  },
}

/** Stable area ordering — drives every iteration over areas. */
export const AREA_ORDER: Area[] = Object.values(Area)

/** Set of valid Area slugs (fast membership test for {@link parseAreaLevels}). */
const AREA_SET = new Set<string>(AREA_ORDER)

/** Build a full `Record<Area, Level>` from a per-area factory (all areas present). */
export function buildAreaLevels(fn: (area: Area) => Level): Record<Area, Level> {
  const out = {} as Record<Area, Level>
  for (const area of AREA_ORDER) out[area] = fn(area)
  return out
}

/**
 * Defensively coerce a stored jsonb `levels` value into a sparse, trusted
 * `Partial<Record<Area, Level>>`: keep only known {@link Area} slugs, clamp each
 * value to `Level.None..Level.Full` (rounding/flooring non-integers), and drop
 * anything else. Unknown/malformed input yields an empty map.
 */
export function parseAreaLevels(raw: unknown): Partial<Record<Area, Level>> {
  const out: Partial<Record<Area, Level>> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!AREA_SET.has(key)) continue
    const num = typeof value === 'number' ? Math.floor(value) : Number.NaN
    if (!Number.isFinite(num)) continue
    const clamped = Math.min(Level.Full, Math.max(Level.None, num)) as Level
    out[key as Area] = clamped
  }
  return out
}

/**
 * Expand per-area levels into the flat, registry-ordered PermissionKey set the
 * enforcement surface consumes: for each area, union every rung with
 * `rung.level ≤ areaLevel`. Accepts sparse maps — absent areas default to `None`.
 */
export function expandLevelsToKeys(levels: Partial<Record<Area, Level>>): PermissionKey[] {
  const held = new Set<PermissionKey>()
  for (const area of AREA_ORDER) {
    const level = levels[area] ?? Level.None
    for (const rung of PERMISSION_AREAS[area].rungs) {
      if (rung.level <= level) for (const key of rung.keys) held.add(key)
    }
  }
  return PERMISSION_KEY_ORDER.filter((key) => held.has(key))
}

/**
 * The inverse of {@link expandLevelsToKeys} for a single area: recover the
 * member's effective {@link Level} for `area` from an already-materialized
 * (seat-clamped, composed) PermissionKey set. Walks the area's rungs in
 * ascending order and returns the highest rung whose keys are all held,
 * stopping at the first gap (rungs are cumulative, so this matches the
 * expansion semantics). Absent rungs ⇒ {@link Level.None}. Pure, zero I/O —
 * used by the instance-access resolver to read the coarse L2 area gate + base
 * fallback level from a {@link import('./capability-set').CapabilitySet}.
 */
export function areaLevelFromKeys(keys: ReadonlySet<PermissionKey>, area: Area): Level {
  let level = Level.None
  for (const rung of PERMISSION_AREAS[area].rungs) {
    if (rung.keys.every((key) => keys.has(key))) level = rung.level
    else break
  }
  return level
}
