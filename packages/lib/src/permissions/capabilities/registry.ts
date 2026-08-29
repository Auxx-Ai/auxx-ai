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
  // workflows is an instance-access resource — per-workflow `ResourceAccess`
  // grants sit on these three rungs (plan 30 §1).
  workflowsView = 'workflows.view',
  workflowsEdit = 'workflows.edit',
  workflowsManage = 'workflows.manage',
  // agents is an instance-access resource — per-agent `ResourceAccess` grants
  // sit on these three rungs (plan 25 §4.2.DECIDED).
  agentsView = 'agents.view',
  agentsEdit = 'agents.edit',
  agentsManage = 'agents.manage',

  // collaboration
  commentsView = 'comments.view',
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
  dashboardsEdit = 'dashboards.edit',
  dashboardsManage = 'dashboards.manage',

  // channels (mail + channel infrastructure — created 2026-07-27, plan 21 §6 Option A)
  channelsManage = 'channels.manage',

  // inboxes (instance-access resource — per-inbox ResourceAccess grants, plan 40
  // §1.1). TWO rungs only: there is no thread AUTHORITY axis, so there is
  // nothing to express between "work this inbox" and "manage this inbox".
  inboxesView = 'inboxes.view',
  inboxesManage = 'inboxes.manage',

  // signatures (instance-access resource — per-signature ResourceAccess grants, plan 36 §2.1)
  signaturesView = 'signatures.view',
  signaturesEdit = 'signatures.edit',
  signaturesManage = 'signatures.manage',

  // snippets (instance-access resource — per-snippet ResourceAccess grants, plan 36 §2.1)
  snippetsView = 'snippets.view',
  snippetsEdit = 'snippets.edit',
  snippetsManage = 'snippets.manage',

  // general ledger (plans/money/tasks/10-the-poster.md §6). NOT an instance-access
  // resource: a posting is org-scoped bookkeeping, not a shareable object.
  ledgerView = 'ledger.view',
  ledgerPost = 'ledger.post',
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
    key: PermissionKey.workflowsView,
    label: 'View & Run Workflows',
    description: 'See workflows shared with you and run them manually from a record.',
    group: 'Automation',
    featureKey: FeatureKey.workflows,
  },
  {
    key: PermissionKey.workflowsEdit,
    label: 'Edit Workflows',
    description: 'Edit, save, publish, and test workflows, and manage their versions.',
    group: 'Automation',
    featureKey: FeatureKey.workflows,
  },
  {
    key: PermissionKey.workflowsManage,
    label: 'Manage Workflows',
    description: 'Create, rename, duplicate, delete, and configure workflows.',
    group: 'Automation',
    featureKey: FeatureKey.workflows,
  },
  {
    key: PermissionKey.agentsView,
    label: 'View & Use Agents',
    description: 'See agents shared with you and chat with, mention, or assign work to them.',
    group: 'Automation',
    featureKey: FeatureKey.agents,
  },
  {
    key: PermissionKey.agentsEdit,
    label: 'Edit Agents',
    description: 'Edit an agent’s prompt, tools, knowledge scope, procedures, and evals.',
    group: 'Automation',
    featureKey: FeatureKey.agents,
  },
  {
    key: PermissionKey.agentsManage,
    label: 'Manage Agents',
    description: 'Create, publish, delete, and configure Kopilot agents.',
    group: 'Automation',
    featureKey: FeatureKey.agents,
  },

  // ── Collaboration ──
  {
    key: PermissionKey.commentsView,
    label: 'View Comments',
    description: 'Read comments on records.',
    group: 'Collaboration',
  },
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
    // NOT adminOnly since plan 39 §7.1 — see `PERMISSION_AREAS[Area.settings]`.
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
    // NOT adminOnly since doc 19 §0.25 — see `PERMISSION_AREAS[Area.permissions]`.
    // Deliberately NO `granularPermissions` featureKey here (plan 23 §2.2): binding
    // built-in profiles and permission reads must work on every plan. The plan gate
    // lives in the four authoring paths instead (profile-save / profile-mutations /
    // profile-delete / grant-service) per plan 19 §0.26.
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
    description: 'See dashboards shared with you and the widgets on them.',
    group: 'Analytics',
    featureKey: FeatureKey.dashboards,
  },
  {
    key: PermissionKey.dashboardsEdit,
    label: 'Edit Dashboard Widgets',
    description: 'Add, remove, and edit the widgets and layout inside dashboards.',
    group: 'Analytics',
    featureKey: FeatureKey.dashboards,
  },
  {
    key: PermissionKey.dashboardsManage,
    label: 'Manage Dashboards',
    description: 'Create, rename, delete, and configure dashboards.',
    group: 'Analytics',
    featureKey: FeatureKey.dashboards,
  },

  // ── Channels ──
  {
    key: PermissionKey.channelsManage,
    label: 'Manage Channels',
    description:
      'Administer mail domains, inboxes, labels, suppression, chat duty, and recordings.',
    group: 'Channels',
  },

  // ── Inboxes ──
  {
    key: PermissionKey.inboxesView,
    label: 'Use Mail',
    description: 'Open the mail surfaces and work the shared inboxes shared with you.',
    group: 'Channels',
  },
  {
    key: PermissionKey.inboxesManage,
    label: 'Administer Mail',
    description: "Manage every shared inbox's access, lens floor, and settings.",
    group: 'Channels',
  },

  // ── Signatures ──
  {
    key: PermissionKey.signaturesView,
    label: 'Use Signatures',
    description: 'See and insert the email signatures shared with you.',
    group: 'Channels',
  },
  {
    key: PermissionKey.signaturesEdit,
    label: 'Edit Signatures',
    description: 'Edit the name and content of signatures shared with you.',
    group: 'Channels',
  },
  {
    key: PermissionKey.signaturesManage,
    label: 'Manage Signatures',
    description: 'Create, delete, and share email signatures.',
    group: 'Channels',
  },

  // ── Snippets ──
  {
    key: PermissionKey.snippetsView,
    label: 'Use Snippets',
    description: 'See and insert the reply snippets shared with you.',
    group: 'Channels',
  },
  {
    key: PermissionKey.snippetsEdit,
    label: 'Edit Snippets',
    description: 'Edit the title and content of snippets shared with you.',
    group: 'Channels',
  },
  {
    key: PermissionKey.snippetsManage,
    label: 'Manage Snippets',
    description: 'Create, delete, and share reply snippets, and manage snippet folders.',
    group: 'Channels',
  },

  // ── Accounting ──
  {
    key: PermissionKey.ledgerView,
    label: 'View Ledger',
    description: 'Read the general ledger, preview an entry, and check the books balance.',
    group: 'Accounting',
  },
  {
    key: PermissionKey.ledgerPost,
    label: 'Post to Ledger',
    description: 'Post and reverse journal entries in the general ledger.',
    group: 'Accounting',
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
  // channels sits right after integrations — group order for
  // PROFILE_AREA_GROUPS/AREA_GROUPS derives from this enum's declaration
  // order (plan 21 §6), so this keeps the new Channels group beside the
  // other integration/mail-adjacent rows instead of trailing at the end.
  channels = 'channels',
  // inboxes is the mail WORK area (plan 40 §1.0) — `channels` above owns the
  // plumbing (which pipes and containers exist), this owns who works which mail.
  // Declared immediately after `channels` so `areaGroups()` — which walks
  // AREA_ORDER, i.e. this declaration order — renders it as the second row under
  // the existing Channels heading.
  inboxes = 'inboxes',
  // signatures + snippets share the `Channels` GROUP with `channels` above
  // (plan 36 §0.1). `areaGroups()` walks AREA_ORDER — i.e. this declaration
  // order — so a group's position comes from its FIRST member and each area's
  // position within the group comes from where it sits here. Declared next to
  // `channels` they render as the second and third rows under the existing
  // Channels heading; declared at the end of the enum they would still land
  // under that heading, but only after every unrelated area had been walked.
  signatures = 'signatures',
  snippets = 'snippets',
  aiConfig = 'aiConfig',
  automationRules = 'automationRules',
  auditLog = 'auditLog',
  files = 'files',
  connectors = 'connectors',
  datasets = 'datasets',
  knowledgeBase = 'knowledgeBase',
  dashboards = 'dashboards',
  // ledger is the general ledger's own area - declared last, so `areaGroups()`
  // (which walks AREA_ORDER, i.e. this declaration order) renders the new
  // Accounting heading after every existing group rather than splitting one.
  ledger = 'ledger',
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
  /** Layer-1 plan link — the area's keys AND the org's plan feature. */
  featureKey?: FeatureKey
}

// RETIRED 2026-07-27 (plan 21 §8 step 11): `AreaMetadata` used to carry a flag
// marking areas whose routers were still fronted by a binary admin-role check
// instead of a capability assert. Plan 21 §4 migrated the last such router —
// the binary admin gate itself is now deleted — so every area ships
// capability-gated from birth; a new one that doesn't is a bug to fix before
// merge, not a flag to set.

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
    // Audited (step 10): never had a binary role gate — view/edit run through
    // `resources/crud/unified-handler.ts` + `entity-access.ts`, and `record.ts`
    // asserts `recordsDelete` — all capability-driven. `entityDefinition.create`
    // and `tableView.ts`'s def-less fallback are `adminProcedure`/`isAdminOrOwner`,
    // but they are def-SCHEMA surfaces with no key in this area, not record CRUD.
    // `recordsImport` gap CLOSED 2026-07-27 (plan 21 §4.2): every `data-import.ts`
    // procedure now runs through `permissionProcedure(recordsImport)`.
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
    description:
      'View and run workflows, edit and publish them, or create, duplicate, and delete them.',
    group: 'Automation',
    rungs: [
      { level: Level.Read, keys: [PermissionKey.workflowsView] },
      { level: Level.Edit, keys: [PermissionKey.workflowsEdit] },
      { level: Level.Full, keys: [PermissionKey.workflowsManage] },
    ],
    // `Read`/`Edit` rungs added 2026-07-27 (plan 30 §1) — prerequisite for
    // per-workflow instance access. Workflows are an `INSTANCE_ACCESS_RESOURCES`
    // entry with `baselineAtCreate: false`, so a workflow with NO explicit
    // `ResourceAccess` row falls back to THIS area level; on the old single-rung
    // ladder that fallback could only be `None` or `Full`, which would have made
    // the per-instance view/edit tiers half-decorative.
    //   Read  = see the workflow, open it read-only, and RUN it manually from a
    //           record (user decision 2026-07-27 — `view` means "may run it").
    //   Edit  = edit nodes, save, publish, test-run, manage versions.
    //   Full  = create, rename, duplicate, delete, settings, share tokens.
    // Purely a SPLIT of the old Full rung: no path got more permissive, and no
    // migration is needed (`Level` is ordinal, and zero `PermissionGrant` rows
    // store `workflows: 1` or `2`).
    //
    // WORKER SEATS: `workflows` is deliberately NOT in `WORKER_AREAS`
    // (`seat-policy.ts`), so `SEAT_CEILINGS.worker` clamps it to `None` — and
    // that stays true (user decision 2026-07-27). The consequence is explicit,
    // not incidental: **a field-tech seat cannot run a manual workflow from a
    // record**, because manual run is gated on the `Read` rung. Reopening that
    // means adding `Area.workflows` to `WORKER_AREAS`, nothing else.
    //
    // HEADLESS EXECUTION IS NOT GATED BY ANY OF THIS (plan 30 §2.1). Schedules,
    // record-CRUD events, record rules, message-received, app triggers, webhook
    // endpoints, polling, and resume/approval jobs all run as the system and
    // read no member capabilities — a workflow restricted to `None` for everyone
    // STILL FIRES. Only user-initiated runs consult these rungs.
    //
    // Prior history — closed 2026-07-27 (plan 21 §4.2, first of the four §4.2
    // holes). This was a HOLE closure, not a pure migration — `workflow.ts` was
    // 25× `protectedProcedure` and never read `workflowsManage`; every member,
    // not just admins, could manage workflows in production regardless of
    // this area's level. All management procedures (create, update, delete,
    // duplicate, test, publish, versions, run control, stats, share tokens)
    // assert `permissionProcedure(workflowsManage)`; re-tiering read/list onto
    // `workflowsView` and authoring onto `workflowsEdit` is plan 30 phase 2.
    // Member default is unaffected — `MEMBER_BASELINE_LEVELS[workflows]` is
    // Full, so every full-seat member still holds all three keys out of the box.
    featureKey: FeatureKey.workflows,
  },
  [Area.agents]: {
    area: Area.agents,
    label: 'Agents',
    description:
      'Use agents shared with you, edit their prompt and tools, or create, publish, and delete them.',
    group: 'Automation',
    rungs: [
      { level: Level.Read, keys: [PermissionKey.agentsView] },
      { level: Level.Edit, keys: [PermissionKey.agentsEdit] },
      { level: Level.Full, keys: [PermissionKey.agentsManage] },
    ],
    // `Read`/`Edit` rungs added 2026-07-28 (plan 25 §4.2.DECIDED) — prerequisite
    // for per-agent instance access, exactly as plan 30 §1 was for workflows.
    // Agents are an `INSTANCE_ACCESS_RESOURCES` entry with
    // `baselineAtCreate: false`, so an agent with NO explicit `ResourceAccess`
    // row falls back to THIS area level; on the old single-rung ladder that
    // fallback could only be `None` or `Full`, which would have handed every
    // member `admin` on every agent the moment instance access shipped.
    //   Read  = see the agent and USE it — chat in Kopilot, DM it, @-mention it,
    //           assign work to it, pick it in an actor picker (user decision
    //           2026-07-27: `view` means "usable"). There is no separate
    //           "usable but not editable" tier being preserved here; usability
    //           and manageability were the SAME key before this split.
    //   Edit  = prompt, drafts, toolsets, knowledge scope, procedures, evals,
    //           and RENAME (name + slug). Rename sits here rather than on Full
    //           — deliberately unlike `Area.workflows` above — because it is an
    //           authoring field, and `agent.update`'s `ADMIN_ONLY_UPDATE_FIELDS`
    //           reflects that (user decision 2026-07-28).
    //   Full  = create, publish, delete, archive, triggers, and the agent's own
    //           permission profile / `runAsUserId`.
    // Purely a SPLIT of the old Full rung: no path got more permissive, and no
    // migration is needed. `Level` is ordinal, and the dev check that #1344's
    // dashboards rung established as the bar came back clean — all 25
    // `PermissionGrant` rows carrying an `agents` level store `3` (Full), none
    // store `1` or `2`, and `ResourceAccess` had zero `agent` rows — so nothing
    // silently gained rights. `MEMBER_BASELINE_LEVELS[agents]` is `Full`, so no
    // member regresses and RESTRICTION is the use case, not sharing-up.
    //
    // SHARING AN AGENT IS NOT A CAPABILITY GRANT. A chatting user acts as
    // THEMSELVES: `agent-run-capabilities.ts` intersects the agent's published
    // policy with the invoker's own capabilities for every human-driven path
    // (Kopilot SSE, mention, assignment), so an agent can never read data on
    // someone's behalf that they could not read directly. What a share DOES
    // hand over is the agent's bound third-party credentials and installed app
    // tools, which run on the agent's connection — see plan 25 §4.2.DECIDED and
    // the share dialog's scope note.
    //
    // Prior history — migrated 2026-07-27 (plan 21 §4.1, Tier B): every sibling
    // authoring router that used to gate on a bare `adminProcedure` asserts an
    // agents key instead (`agent-toolset.ts`, `agent-trigger.ts`,
    // `agent-scope.ts`, `agent-procedure.ts` + `procedure.ts`, and `eval.ts`'s
    // `evalManageProcedure`). That pass covered the MUTATING procedures only —
    // 13 read procedures in those same routers stayed bare `protectedProcedure`
    // and read no capabilities at all until this slice.
    featureKey: FeatureKey.agents,
  },
  [Area.comments]: {
    area: Area.comments,
    label: 'Comments',
    description: 'Read, write, edit, and delete comments on records.',
    group: 'Collaboration',
    rungs: [
      { level: Level.Read, keys: [PermissionKey.commentsView] },
      { level: Level.Full, keys: [PermissionKey.commentsManage] },
    ],
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
    // Migrated 2026-07-27 (plan 21 §4.1, Tier B): `availability.ts`
    // (`saveWeeklyHours`, `addException`, `updateException`, `deleteException`)
    // now asserts `permissionProcedure(dispatchBoardManage)` instead of the
    // bare `adminProcedure` it used to sit behind, and the
    // `invoice-delete-guard.ts` / `work-order-delete-guard.ts` pre-delete hooks
    // on the board's own record faces now call
    // `requirePermission(dispatchBoardManage)`. `dispatch.ts` and `money.ts`
    // already asserted the key with a role check layered on top (Tier A); that
    // redundant `isAdminOrOwner` layer is gone too. The area is honestly
    // unlockable; flag dropped.
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
    // Binary role gate dropped 2026-07-27 (plan 21 §4.2 — a HOLE closure, not a
    // pure migration): `setting.ts` (`updateOrganizationSetting`,
    // `batchUpdateOrganizationSettings`) and `organization.ts:update` now assert
    // `settingsManage` via `requirePermission` instead of `isAdminOrOwner`.
    // Admins keep the key through `ROLE_DEFAULTS.ADMIN`, so default behavior is
    // unchanged; a profile that zeroes `settings` now actually bites.
    //
    // `adminOnly` DROPPED 2026-07-28 (plan 39 §7.1), leaving that set empty.
    // It was the last member, and while it stood the nine settings pages plan 39
    // moves off role gates would have been capability-EXPRESSED but still
    // admin-only — one authority instead of two, and zero delegation. Follows
    // doc 19 §0.25's precedent for `permissions`, under the same rule: dropping
    // the flag must never flip a default on. It does not — `settings` is
    // omitted from `MEMBER_BASELINE_LEVELS` (seat-policy.ts), so the Member
    // baseline stays `None` and a grantee needs an explicit grant.
    //
    // The key is COARSE, and knowingly so: it spans the 61 org-scoped settings
    // in `SETTINGS_CATALOG` (32 of them `DOCUMENTS` — invoicing/tax/business
    // identity), `organization.ts:update` (name, handle, domains — the handle
    // changes org URLs), and `entityDefinition.ts:create` (a structural schema
    // change). Splitting it into per-surface areas is plan 39 §7.2 and wants its
    // own `user:capabilities:vN` bump; it is cheaper to decide before orgs
    // configure grants against this one key.
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
    // Audited (step 10): never had a binary role gate — `billing.ts` has no
    // role check at all — writes go through `permissionProcedure(billingManage)`,
    // so the `Full` rung bites for admins too. `billingView` gap CLOSED
    // 2026-07-27 (plan 21 §4.2): billing-DATA reads (invoices, billing details,
    // payment methods, reactivation, previews) assert `billingView`; app-shell
    // subscription state (`getPlans`, `getCurrentSubscription`, trial checks)
    // deliberately stays open — it feeds plan gates and banners for every
    // member and is not billing data.
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
    // default stays `None` (`ROLE_DEFAULTS.USER` is the all-`None` floor, plan
    // 22 — omitted from `MEMBER_BASELINE_LEVELS` in seat-policy.ts, the real
    // source of truth for the Member baseline — so dropping `adminOnly` must
    // never flip a default on).
    // Agent-side profile editing and assignment stay OWNER/ADMIN-only and are
    // enforced separately in `profile-save.ts` / `profile-mutations.ts`, not by
    // this area (doc 14 §0.9). `permissionsRouter` is fronted by the
    // `permissionsManage` capability rather than a binary role check, so the
    // grant actually reaches a non-admin holder. Plan 21 §4 later migrated
    // every other router in the org group off its binary role gate too.
  },
  [Area.integrations]: {
    area: Area.integrations,
    label: 'Integrations',
    description: 'Install and configure apps, MCP servers, and webhooks.',
    group: 'Integrations',
    rungs: [{ level: Level.Full, keys: [PermissionKey.integrationsManage] }],
    // Binary role gate dropped 2026-07-27 (plan 21 §4.1 + the §2.d
    // classification): the app CONNECTION lifecycle now asserts
    // `integrationsManage` — org-scoped
    // connections in `saveSecretConnection`, the admin half of
    // `requireConnectionManageAccess` (its `own credential` half is an ownership
    // carve-out and stays, §5.2), and `apiKey.ts`'s chat signing keys. The §2.d
    // contradiction resolved as BOTH: carve-out for the owner path, real gate for
    // the org-scoped path — the gate half is what migrated.
  },
  [Area.channels]: {
    area: Area.channels,
    label: 'Channels',
    description:
      'Administer mail domains, inboxes, labels, suppression, chat duty, and recordings.',
    group: 'Channels',
    rungs: [{ level: Level.Full, keys: [PermissionKey.channelsManage] }],
    // Created 2026-07-27 per plan 21 §6 Option A — mail infra previously had NO
    // capability home; these routers were `adminProcedure`. USER default is
    // `None` (`ROLE_DEFAULTS.USER` is the all-`None` floor, plan 22 — omitted
    // from `MEMBER_BASELINE_LEVELS` in seat-policy.ts) — the migrated sites
    // were admin-only, so admins keep access via `ROLE_DEFAULTS.ADMIN`.
  },
  [Area.inboxes]: {
    area: Area.inboxes,
    label: 'Inboxes',
    description: 'Use the shared inboxes, and administer who works which mail.',
    group: 'Channels',
    rungs: [
      { level: Level.Read, keys: [PermissionKey.inboxesView] },
      { level: Level.Full, keys: [PermissionKey.inboxesManage] },
    ],
    // Created 2026-07-29 (plan 40 §1.1). Mail never had a Layer-2 area at all,
    // so before this NO permission profile could express "this profile has no
    // mail access" — and `SEAT_CEILINGS` clamps by AREA, so a worker seat read
    // and replied to every org inbox at `defaultLens: 'full'` with no
    // configuration that could stop it. This is that front door.
    //
    // TWO RUNGS, and deliberately no `Edit` (user decision 2026-07-28). There is
    // no thread AUTHORITY axis: if you can see a thread at full lens you can
    // reply, forward, tag, assign, delete and merge it — that is the shipped
    // semantics (`assertCanActOnThreads` requires `full` for ANY mutation and
    // then permits all of them), and this area does not change it. So there is
    // nothing to express between "work this inbox" and "manage this inbox", and
    // `edit` is dead vocabulary for the `inbox` / `personal_inbox` instance tiers
    // too (plan 40 §1.3 — the share grid must not offer it, and the fallback
    // below can never produce it because there is no `Level.Edit` rung).
    // Partial ladders are established precedent — `Area.channels` directly above
    // is `Full`-only.
    //
    // READ THIS BEFORE TOUCHING A RUNG. Because `inbox` is
    // `baselineAtCreate: false`, this ladder is NOT merely a coarse front door:
    // `instanceFallbackLevel` maps the area level straight through to the
    // per-instance vocabulary for every shared inbox the org holds no explicit
    // row on. So
    //   Read → `view`  — the inbox is open and fully workable (§1.3), and
    //   Full → `admin` — **Manager of EVERY row-less shared inbox**.
    // `inboxes: Full` therefore means exactly one thing: MAIL ADMINISTRATOR.
    // That is why inbox create/delete lives on `channelsManage` instead
    // (plan 40 §1.0): welding creation to this top rung would have meant every
    // admin who granted it so someone could make a team inbox silently made that
    // person Manager of every inbox in the org.
    //
    // `personal_inbox` shares this area but is `baselineAtCreate: true`, so the
    // rung supplies it NO fallback — a personal mailbox is reachable only
    // through an explicit row. That split is the whole reason there are two
    // instance keys over one area; see `INSTANCE_ACCESS_RESOURCES`.
    //
    // MEMBER DEFAULT is `Read` (`MEMBER_BASELINE_LEVELS`), which IS today's
    // behaviour and is what keeps dispatch-org assignees working. NOT `Full` —
    // that would make every member Manager of every inbox.
  },
  [Area.signatures]: {
    area: Area.signatures,
    label: 'Signatures',
    // Plan 43 §2.2 — a NOUN PHRASE naming the feature, not a verb list of rights
    // the rung does not grant. The rung's meaning now lives one row down, on the
    // access child row (§2.1); this header carries no control. The old wording
    // ("Use, create, and share…") promised sharing, which is the per-instance
    // `admin` rung and is reachable from no position on this ladder.
    description: 'Email signatures members can add to their replies.',
    group: 'Channels',
    rungs: [
      { level: Level.Read, keys: [PermissionKey.signaturesView] },
      { level: Level.Full, keys: [PermissionKey.signaturesManage] },
    ],
    // Created 2026-07-28 (plan 36 §2.1). Signatures are an
    // `INSTANCE_ACCESS_RESOURCES` entry with `baselineAtCreate: true`.
    //
    // TWO RUNGS, NOT THREE — the `Level.Edit` rung was DROPPED 2026-07-29
    // (plan 43 §3.1). It was never asserted anywhere: `signaturesEdit` had zero
    // assertion sites, and the area level cannot reach an instance decision for a
    // `baselineAtCreate: true` resource, so the rung guarded nothing in either
    // direction. `Level` is ordinal, so nothing renumbers, and a dev-data check
    // found zero `PermissionGrant` rows storing `signatures: 2` — nobody silently
    // gained or lost a rung. Precedent for a partial ladder: `Area.inboxes`
    // (Read/Full) and `Area.channels` (Full-only).
    //
    // **`PermissionKey.signaturesEdit` deliberately STAYS in the enum.** It is
    // per-instance ladder vocabulary (`RUNG_LABELS`, `levelToRung`,
    // `ResourcePermission.edit`) and backs the real `Read+write` instance tier
    // that `assertEditInstance` enforces. Deleting the key would break that tier;
    // only the AREA rung went.
    //
    // What the two remaining rungs mean:
    //   Read  = the member may receive the WORKSPACE DEFAULT for signatures
    //           (plan 43 §0.2a). It gates the baseline path only — an individual
    //           grant (`user`/`group`/`profile`) overrules it, so a member at
    //           `None` still keeps signatures they created or that were shared
    //           with them directly. Rendered as "Use", not "Read only" (§2.1a).
    //   Full  = the ONE rung fronting a real instance-LESS action: CREATE.
    //           Rendered as "Create" (§2.1a).
    // Do NOT invent server asserts for Read that have nothing to guard — that is
    // the mistake the dashboards slice had to unpick. Its effect arrives through
    // `effectiveInstanceLevel`'s baseline gate, not through an `assert`.
    //
    // MEMBER DEFAULT is `Full` (`MEMBER_BASELINE_LEVELS`): every member creates
    // and owns their own signatures. Restriction happens per-instance, not here.
    // The USER-RANK FLOOR is `Read` (`ROLE_DEFAULTS.USER`, plan 43 §3.2) — a
    // custom profile silent on this area still receives the workspace default.
  },
  [Area.snippets]: {
    area: Area.snippets,
    label: 'Snippets',
    // Plan 43 §2.2 — noun phrase; see `Area.signatures` above for why.
    description: 'Saved reply snippets members can insert.',
    group: 'Channels',
    rungs: [
      { level: Level.Read, keys: [PermissionKey.snippetsView] },
      { level: Level.Full, keys: [PermissionKey.snippetsManage] },
    ],
    // Created 2026-07-28 (plan 36 §2.1). Same shape and the same rationale as
    // `Area.signatures` directly above, including why the `Level.Edit` rung was
    // dropped 2026-07-29 (plan 43 §3.1 — `snippetsEdit` had zero assertion
    // sites) and why `PermissionKey.snippetsEdit` nonetheless STAYS in the enum
    // as per-instance ladder vocabulary. `Full` is the only rung fronting
    // instance-less actions — creating a snippet, and (plan 36 §0.4 / §6.3)
    // creating, renaming, and deleting snippet FOLDERS, which stay flat labels
    // with no grants of their own. `Read` gates the WORKSPACE DEFAULT only
    // (plan 43 §0.2a); snippets shared with a member directly always reach them.
    // The USER-rank floor is `Read` (plan 43 §3.2).
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
    // Plan 43 §2.2 — noun phrase; see `Area.signatures` for why. The old wording
    // enumerated three tiers of rights, two of which this ladder no longer has.
    description: 'Dashboards and the widgets on them.',
    group: 'Analytics',
    rungs: [
      { level: Level.Read, keys: [PermissionKey.dashboardsView] },
      { level: Level.Full, keys: [PermissionKey.dashboardsManage] },
    ],
    // History, in order, because the second entry reverses the first:
    //
    // `Edit` rung added 2026-07-27 (#1344): dashboards were the only
    // instance-access area on a 2-rung ladder even though the share dialog and
    // `dashboard.ts` already spoke three per-instance tiers.
    //
    // `Edit` rung DROPPED again 2026-07-29 (plan 43 §3.1). The three per-instance
    // tiers are real and unaffected — they live on the `ResourceAccess` row and
    // are enforced by `assertEditInstance` — but the AREA rung mirroring them
    // asserted nothing: `dashboardsView` and `dashboardsEdit` have zero assertion
    // sites, and for a `baselineAtCreate: true` resource the area level cannot
    // reach an instance decision. `PermissionKey.dashboardsEdit` STAYS in the
    // enum as per-instance ladder vocabulary; only the rung went. Zero
    // `PermissionGrant` rows stored `dashboards: 2`, so nothing renumbered and
    // nobody silently changed tier.
    //
    // Read = the member may receive the WORKSPACE DEFAULT for dashboards
    // (plan 43 §0.2a) — the 89 `role:org_member @ view` rows in dev reach them
    // only at this rung or above. An individual grant overrules it, so `None`
    // never costs a member a dashboard they created or that was shared with them
    // directly. Full = create and duplicate (the instance-less actions).
    // The USER-rank floor is `Read` (plan 43 §3.2).
    featureKey: FeatureKey.dashboards,
  },
  [Area.ledger]: {
    area: Area.ledger,
    label: 'General ledger',
    description: 'The double-entry ledger, its entries, and what is pushed to accounting.',
    group: 'Accounting',
    rungs: [
      { level: Level.Read, keys: [PermissionKey.ledgerView] },
      { level: Level.Full, keys: [PermissionKey.ledgerPost] },
    ],
    // Created 2026-08-28 (plans/money/tasks/10-the-poster.md §6). Posting is
    // manual for the cutover - a person clicks Post, roughly 30 entries a month
    // - so this area is the only thing standing between a member and the
    // financial statements.
    //
    // WHY NOT `billingManage`, which is the alternative and was rejected:
    // posting to the general ledger is not billing. `billing` governs what auxx
    // charges THIS org (plan, seats, payment method, invoices from us); this
    // governs what the org's own books say about its money. They are different
    // authorities held by different people - a founder who owns the auxx
    // subscription is usually not the bookkeeper who closes a period, and the
    // bookkeeper who closes a period usually has no business changing the plan.
    // Welding them would mean either handing the card to the bookkeeper or
    // handing the ledger to whoever pays the bill.
    //
    // TWO RUNGS, no `Edit`. There is no third thing between reading the ledger
    // and writing to it: an entry is immutable once posted and a mistake is
    // corrected by REVERSING it (task 10 §5), which is itself a post. So `Edit`
    // would be dead vocabulary. Partial ladders are established precedent -
    // `Area.billing` and `Area.files` both jump Read → Full.
    //   Read = `ledger.preview` (persists nothing), `ledger.unpostedPeriods`,
    //          `ledger.verifyBalance`.
    //   Full = `ledger.post` and `ledger.reverse`, the two writes.
    //
    // Ships CLOSED, by construction and deliberately: omitted from
    // `MEMBER_BASELINE_LEVELS` and from `ROLE_DEFAULTS.USER`'s three floored
    // areas, so a member lands at `None` and needs an explicit grant. Admins and
    // owners hold it through `ROLE_DEFAULTS.ADMIN`/`.OWNER` (`ALL_FULL`).
    // Absent from `WORKER_AREAS`, so `SEAT_CEILINGS.worker` clamps it to `None`
    // - a field seat can never reach the books.
    //
    // No `featureKey`: the ledger is ours whether or not an accounting provider
    // is connected (decision P1), so it is not gated on a plan feature.
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
 * The highest rung `area` actually offers at or below `level` — what a level
 * authored on the generic four-rung ladder composes down to *here*.
 *
 * Ladders are per-area and sparse: `auditLog` stops at `Read`, `files` and
 * `billing` jump `Read → Full` with no `Edit`. {@link expandLevelsToKeys} already
 * behaves this way (it unions the rungs `≤ level`, so `Full` on `auditLog` yields
 * exactly `auditLogView`), which means a stored `Full` there is not extra
 * authority — it is an unrepresentable value that composes to `Read`.
 *
 * Anything that COMPARES an authored level against a composed one must normalize
 * through this first, or it reports a difference the enforcement path does not
 * have: the author clamp read a `Full` agent policy against an owner's composed
 * `Read` on `auditLog` and announced a reduction that changes nothing.
 */
export function clampLevelToArea(area: Area, level: Level): Level {
  let clamped = Level.None
  for (const rung of PERMISSION_AREAS[area].rungs) {
    if (rung.level <= level) clamped = rung.level
    else break
  }
  return clamped
}

/** The top rung `area` offers — `Level.None` for an area with no rungs. */
export function areaCeilingLevel(area: Area): Level {
  return PERMISSION_AREAS[area].rungs.at(-1)?.level ?? Level.None
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
