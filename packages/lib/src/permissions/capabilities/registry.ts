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

  // signatures (instance-access resource — per-signature ResourceAccess grants, plan 36 §2.1)
  signaturesView = 'signatures.view',
  signaturesEdit = 'signatures.edit',
  signaturesManage = 'signatures.manage',

  // snippets (instance-access resource — per-snippet ResourceAccess grants, plan 36 §2.1)
  snippetsView = 'snippets.view',
  snippetsEdit = 'snippets.edit',
  snippetsManage = 'snippets.manage',
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
    adminOnly: true,
    // Binary role gate dropped 2026-07-27 (plan 21 §4.2 — a HOLE closure, not a
    // pure migration): `setting.ts` (`updateOrganizationSetting`,
    // `batchUpdateOrganizationSettings`) and `organization.ts:update` now assert
    // `settingsManage` via `requirePermission` instead of `isAdminOrOwner`.
    // Admins keep the key through `ROLE_DEFAULTS.ADMIN`, so default behavior is
    // unchanged; a profile that zeroes `settings` now actually bites.
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
  [Area.signatures]: {
    area: Area.signatures,
    label: 'Signatures',
    description: 'Use, create, and share email signatures.',
    group: 'Channels',
    rungs: [
      { level: Level.Read, keys: [PermissionKey.signaturesView] },
      { level: Level.Edit, keys: [PermissionKey.signaturesEdit] },
      { level: Level.Full, keys: [PermissionKey.signaturesManage] },
    ],
    // Created 2026-07-28 (plan 36 §2.1). Signatures are an
    // `INSTANCE_ACCESS_RESOURCES` entry with `baselineAtCreate: true`.
    //
    // BE HONEST ABOUT WHAT THE LOWER RUNGS DO. For a `baselineAtCreate: true`
    // resource the AREA level never reaches instance access:
    // `effectiveInstanceLevel` returns the explicit row, and
    // `instanceFallbackLevel` returns `undefined` for these resources by
    // construction — no-row means NO access, whatever this ladder says.
    // Dashboards is the precedent and shows the consequence: `dashboardsView`
    // and `dashboardsEdit` are asserted NOWHERE on the server; only
    // `dashboardsManage` is, and only where there is no instance to assert on.
    //   Read  = tier vocabulary + client gating (RUNG_LABELS, levelToPermission,
    //           read-only affordances). NOT a server assert.
    //   Edit  = the same — the per-instance `assertEditInstance` is the real gate.
    //   Full  = the ONE rung fronting a real instance-LESS action: CREATE.
    // Three rungs ship for ladder parity with the other shareable resources.
    // Do NOT invent server asserts for Read/Edit that have nothing to guard —
    // that is the mistake the dashboards slice had to unpick.
    //
    // MEMBER DEFAULT is `Full` (`MEMBER_BASELINE_LEVELS`): every member creates
    // and owns their own signatures. Restriction happens per-instance, not here.
  },
  [Area.snippets]: {
    area: Area.snippets,
    label: 'Snippets',
    description: 'Use, create, and share reply snippets.',
    group: 'Channels',
    rungs: [
      { level: Level.Read, keys: [PermissionKey.snippetsView] },
      { level: Level.Edit, keys: [PermissionKey.snippetsEdit] },
      { level: Level.Full, keys: [PermissionKey.snippetsManage] },
    ],
    // Created 2026-07-28 (plan 36 §2.1). Same shape and the same honesty note
    // as `Area.signatures` directly above: `baselineAtCreate: true` means the
    // area level never supplies an absent-row fallback, so Read/Edit are tier
    // vocabulary + client gating rather than server asserts. `Full` is the only
    // rung fronting instance-less actions — creating a snippet, and (plan 36
    // §0.4 / §6.3) creating, renaming, and deleting snippet FOLDERS, which stay
    // flat labels with no grants of their own.
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
    description:
      'View dashboards, edit their widgets and layout, or create, rename, and delete them.',
    group: 'Analytics',
    rungs: [
      { level: Level.Read, keys: [PermissionKey.dashboardsView] },
      { level: Level.Edit, keys: [PermissionKey.dashboardsEdit] },
      { level: Level.Full, keys: [PermissionKey.dashboardsManage] },
    ],
    // `Edit` rung added 2026-07-27: dashboards were the only instance-access
    // area on a 2-rung ladder even though the share dialog and `dashboard.ts`
    // already spoke three per-instance tiers (view / edit widgets / manage).
    // Read = see the dashboard and its widgets; Edit = add/remove/edit widgets
    // and layout (draft, publish, versions); Full = rename, delete, create.
    // Purely a SPLIT of the old Full rung — no path got more permissive.
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
