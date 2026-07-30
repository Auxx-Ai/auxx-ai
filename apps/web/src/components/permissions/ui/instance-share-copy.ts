// apps/web/src/components/permissions/ui/instance-share-copy.ts

import {
  type Area,
  INSTANCE_ACCESS_KEYS,
  INSTANCE_ACCESS_RESOURCES,
  type InstanceAccessKey,
} from '@auxx/lib/permissions/client'
import {
  BookOpen,
  Bot,
  Database,
  Inbox,
  LayoutDashboard,
  type LucideIcon,
  Mailbox,
  MessageSquareText,
  PenTool,
  Workflow,
} from 'lucide-react'

/**
 * Per-resource UI copy for the generic {@link import('./instance-share-card').InstanceShareCard}
 * — the client mirror of the server's `INSTANCE_ACCESS_RESOURCES`. Everything
 * resource-specific about the Share card is DATA here, not code: adding KB /
 * dashboards later is one entry each, no new component (§4).
 */
export interface InstanceShareCopy {
  /** The resource noun, e.g. `'dataset'`. Used in inline copy. */
  noun: string
  /**
   * The "who this is shared with by default" line.
   *
   * **It may not say "everyone in the workspace"** (plan 43 §5.5.1). Under §0.2a
   * the workspace default reaches only members whose area rung admits it, so all
   * six org-shared resources carry the *"whose profile allows …"* qualifier. The
   * three private keys need no qualifier — *"Private to you by default"* is
   * unconditionally true.
   */
  baselineHint: string
  /**
   * The mirror-image warning, rendered directly beneath the workspace-baseline
   * row (plan 43 §5.5.2). The area row's failure mode is *"I set None and they
   * can still see one"*; the dialog's is the reverse — **an admin sets a
   * workspace default and it does not reach everyone**, and nothing on the card
   * said so.
   *
   * **Set for the six org-shared keys ONLY.** On `signature` / `snippet` /
   * `personal_inbox` it would be false: those have no workspace default for a
   * profile to be shut out of, so there is nothing for an area rung to gate.
   * `dashboard` is org-shared for this purpose despite `baselineAtCreate: true` —
   * every dashboard is born with a `role:org_member @ view` row, which is exactly
   * the baseline lane the area level gates.
   */
  baselineReachNote?: string
  /** What Read / Write / Full mean for this resource. */
  levels: { read: string; write: string; full: string }
  /**
   * A carve-out this resource's access does NOT cover, shown alongside the
   * baseline hint. Only set where restricting the resource would otherwise be
   * read as stopping something it does not stop (workflows: automation).
   */
  scopeNote?: string
}

/**
 * Copy keyed by {@link InstanceAccessKey}. Only the resources with an entry here
 * render a Share card — an unsupported def part narrows out to `null`.
 */
export const INSTANCE_SHARE_COPY: Record<InstanceAccessKey, InstanceShareCopy> = {
  dataset: {
    noun: 'dataset',
    baselineHint:
      'Everyone whose profile allows datasets can use it in search and agents by default.',
    baselineReachNote:
      'Members whose profile closes datasets are not reached by this. Share with them directly to override it.',
    levels: {
      read: 'Use in search & agents',
      write: 'Add & manage files',
      full: 'Change settings',
    },
  },
  kb: {
    noun: 'knowledge base',
    baselineHint:
      'Everyone whose profile allows knowledge bases can read and write its articles by default.',
    baselineReachNote:
      'Members whose profile closes knowledge bases are not reached by this. Share with them directly to override it.',
    levels: {
      read: 'Read articles',
      write: 'Write & publish articles',
      full: 'Manage the KB & its settings',
    },
  },
  dashboard: {
    noun: 'dashboard',
    baselineHint:
      'Shared by default with everyone whose profile allows dashboards. Restrict it to make it private.',
    baselineReachNote:
      'Members whose profile closes dashboards are not reached by this. Share with them directly to override it.',
    levels: {
      read: 'View',
      write: 'Edit widgets & layout',
      full: 'Manage & delete',
    },
  },
  workflow: {
    noun: 'workflow',
    baselineHint:
      'Shared by default with everyone whose profile allows workflows. Restrict it to lock it down.',
    baselineReachNote:
      'Members whose profile closes workflows are not reached by this. Share with them directly to override it.',
    levels: {
      read: 'View & run manually',
      write: 'Edit, publish & test',
      full: 'Rename, duplicate, delete & configure',
    },
    // Plan 30 §2.1 — the single most misreadable thing about restricting a
    // workflow. Say it on the card, not in a doc.
    scopeNote:
      'This controls people, not automation. Schedules, record events, record rules, webhooks, ' +
      'and polling triggers run as the system and keep firing this workflow even when nobody ' +
      'here can see it. Only runs someone starts by hand are affected.',
  },
  agent: {
    noun: 'agent',
    baselineHint:
      'Shared by default with everyone whose profile allows agents. Restrict it to lock it down.',
    baselineReachNote:
      'Members whose profile closes agents are not reached by this. Share with them directly to override it.',
    levels: {
      read: 'Chat, mention & assign work',
      write: 'Edit prompt, tools & knowledge',
      full: 'Publish, rename & delete',
    },
    // Plan 25 §4.2.DECIDED. The obvious fear — "sharing an agent hands over
    // everything the agent can reach" — is FALSE here, and saying so is the
    // point: `agent-run-capabilities.ts` intersects the agent's published policy
    // with the INVOKER's own capabilities on every human-driven path, so the
    // note must not repeat the warning plan 25 §4.2.a originally drafted. What a
    // share genuinely does hand over is narrower and invisible in the policy
    // grid: the agent's bound connections and installed app tools.
    scopeNote:
      'People you share this with chat as themselves — the agent cannot read anything on their ' +
      'behalf that they could not read directly. What they do gain is the agent’s connected ' +
      'accounts and installed app tools, which run on the agent’s credentials. Automation is ' +
      'unaffected: schedules, record events, and app triggers run as the system and keep going ' +
      'even when nobody here can see the agent.',
  },
  signature: {
    noun: 'signature',
    baselineHint: 'Private to you by default. Share it to let teammates use it.',
    levels: {
      read: 'Use in replies',
      write: 'Edit name & content',
      full: 'Share & delete',
    },
    // Plan 36 §2.2 — the headless carve-out, stated where someone locking a
    // signature down will read it.
    scopeNote:
      'This controls people, not automation. Sequences, workflows, and automated sends stamp ' +
      'this signature as the system and keep doing so even when nobody here can see it.',
  },
  snippet: {
    noun: 'snippet',
    baselineHint: 'Private to you by default. Share it to let teammates use it.',
    levels: {
      read: 'Use in replies',
      write: 'Edit title & content',
      full: 'Share & delete',
    },
  },
  // ── Mail (plan 40 §1.3) ──
  //
  // `levels.write` is DEAD COPY for both mail keys and is written to say so.
  // There is no thread authority axis, so there is nothing between "work this
  // inbox" and "manage this inbox": the tiers are `view` and `admin` only, and
  // `Area.inboxes` has no `Level.Edit` rung, so the absent-row fallback can
  // never produce `edit` either. The picker (`LEVEL_ORDER` in
  // `instance-share-body.tsx`) is a flat module const with NO per-key subset
  // support, so it still OFFERS the middle tier — that is tracked as phase-3
  // work with the share-grid fold-in (plan 40 §6). Until it is narrowed, this
  // string is what a user would see if they picked it, so it must not promise a
  // capability that does not exist.
  inbox: {
    noun: 'inbox',
    baselineHint:
      'Everyone whose profile allows inboxes can work it by default. Restrict it to lock it down.',
    baselineReachNote:
      'Members whose profile closes inboxes are not reached by this. Share with them directly to override it.',
    levels: {
      read: 'Read & reply to its mail',
      write: 'Read & reply to its mail',
      full: 'Manage access, floor & settings',
    },
    // Plan 40 §2 — the same headless carve-out workflows and signatures carry,
    // and the one people restricting an inbox most often misread.
    scopeNote:
      'This controls people, not automation. Ingest, sequences, workflows and automated replies ' +
      'run as the system, so a restricted inbox still receives and still sends. It also does not ' +
      'control how much of a thread someone sees — that is the inbox lens, alongside this.',
  },
  personal_inbox: {
    noun: 'personal inbox',
    baselineHint: 'Private to its owner. Nobody else reaches it without an explicit share.',
    levels: {
      read: 'Read & reply to its mail',
      write: 'Read & reply to its mail',
      full: 'Manage access & settings',
    },
    scopeNote:
      'A personal mailbox has no workspace default and no owner override — not even the ' +
      'organization owner, who is capped at metadata. Only the rows here open it.',
  },
}

/**
 * Display metadata for every surface that names a shareable resource TYPE: the
 * per-instance rows on the Workspace defaults and grantee grids, the agent
 * policy tree's *"All X"* rows, and the read-only agent policy view.
 *
 * **This is the only copy** (plan 33 §4.3). There were three — this one and two
 * private `RESOURCE_TYPE_META` tables — justified as *"different rows, different
 * write path"*. That is true of the COMPONENTS and false of a display table whose
 * entries said the same thing, which is how one of them ended up without the
 * `agent` key that `INSTANCE_ACCESS_RESOURCES` had already grown.
 *
 * `description` is consumed only by the read-only agent policy view today; it is
 * here rather than in a fourth table because "what is this resource" is the same
 * sentence wherever it is asked.
 */
export const INSTANCE_TYPE_META: Record<
  InstanceAccessKey,
  { label: string; icon: LucideIcon; description: string }
> = {
  dataset: {
    label: 'Datasets',
    icon: Database,
    description: 'Stored datasets and their rows.',
  },
  kb: {
    label: 'Knowledge bases',
    icon: BookOpen,
    description: 'Knowledge bases and their articles.',
  },
  dashboard: {
    label: 'Dashboards',
    icon: LayoutDashboard,
    description: 'Dashboards and their widgets.',
  },
  workflow: {
    label: 'Workflows',
    icon: Workflow,
    description: 'Workflows the agent may see and run.',
  },
  agent: {
    label: 'Agents',
    icon: Bot,
    description: 'Agents, their prompts and their tools.',
  },
  signature: {
    label: 'Signatures',
    icon: PenTool,
    description: 'Email signatures and their content.',
  },
  snippet: {
    label: 'Snippets',
    icon: MessageSquareText,
    description: 'Reply snippets and their content.',
  },
  inbox: {
    label: 'Inboxes',
    icon: Inbox,
    description: 'Shared inboxes and the mail that lands in them.',
  },
  personal_inbox: {
    label: 'Personal inboxes',
    icon: Mailbox,
    description: "Members' own connected mailboxes.",
  },
}

/**
 * The reverse of `INSTANCE_ACCESS_RESOURCES` — which instance-access key (if
 * any) a given L2 area expands into per-instance rows for. Shared by every
 * `renderChildren` host that nests `InstanceBaselineRows` / `GranteeInstanceRows`
 * under an area row (`grantee-overrides-tab.tsx`, `grantee-levels-section.tsx`)
 * so the mapping is defined once.
 *
 * **The reverse is no longer 1:1.** `Area.inboxes` carries TWO keys (plan 40
 * §0.2: `inbox` org-shared, `personal_inbox` private), which is the first time
 * that has happened — and the old `Object.fromEntries` form silently resolved
 * the area to whichever key was declared LAST, i.e. `personal_inbox`. That would
 * have pointed the Inboxes area row at other people's private mailboxes instead
 * of the org's shared ones.
 *
 * The tie-break is by POSTURE, not declaration order: an area row expands into
 * the rows an admin can set a WORKSPACE DEFAULT on, and a `baselineAtCreate:
 * true` resource has no workspace default by construction (no row ⇒ no access,
 * whatever the area says). So the org-shared key wins whenever an area has both.
 */
export const AREA_TO_INSTANCE_KEY: Partial<Record<Area, InstanceAccessKey>> =
  INSTANCE_ACCESS_KEYS.reduce<Partial<Record<Area, InstanceAccessKey>>>((acc, key) => {
    const { area, baselineAtCreate } = INSTANCE_ACCESS_RESOURCES[key]
    const held = acc[area]
    if (
      held === undefined ||
      (!baselineAtCreate && INSTANCE_ACCESS_RESOURCES[held].baselineAtCreate)
    )
      acc[area] = key
    return acc
  }, {})

/**
 * Row copy for the two per-instance row scopes (capability layer v2 §B.2.6):
 * the **baseline** scope (the org-wide default) and a **grantee** scope (a
 * specific member/team's own access), which must never borrow the area grid's
 * raise-only framing — instance grants can restrict as well as raise.
 *
 * The baseline description used to say *"every member"* (plan 43 §5.5.4). Under
 * §0.2a the workspace default is gated by the member's area rung, so it reaches
 * every member **whose profile allows the area** and no further.
 */
export const INSTANCE_ROW_COPY = {
  baseline: {
    description:
      'The default access members start with for each item, where their profile allows it. ' +
      'Expand an item to see or change who else can reach it.',
    /**
     * `InstanceShareBody`'s empty state. Names the workspace-default control
     * sitting directly above the list — true under `InstanceBaselineRows` and
     * the Share card, where that control is the `role:org_member` row itself.
     * Passed in rather than hardcoded (plan 31 §2.6) so a mount whose scope has
     * no such control cannot inherit the sentence by accident.
     */
    emptyHint: (noun: string) =>
      `Not shared with anyone specific. Adjust the workspace default above to restrict this ${noun}.`,
  },
  grantee: {
    description: (noun: string) => `Their own access to this ${noun}, on top of the default above.`,
  },
} as const

/**
 * The dead-row warning (capability layer v2 §B.2.8, re-aimed by plan 25 §2).
 *
 * It used to mark any `user` row on a member whose composed area level was
 * `None`, because `effectiveInstanceLevel` closed the area gate *before* it
 * consulted instance rows and every such share was silently inert. Plan 25 §2
 * inverted that: an explicit row now beats the area floor, so a POSITIVE grant
 * against a sparse profile is exactly how "no workflows except this one" is
 * expressed — warning about it would now be actively wrong.
 *
 * What remains genuinely dead is the opposite row: an explicit `none`
 * RESTRICTION on a member who already composes the area to `None`. It takes away
 * something they never had.
 *
 * **Plan 43 §0.2a's decision C preserves that exactly** — an individual grant
 * still overrules the area level, so a positive `user` / `group` / `profile` row
 * is never inert. C does add one newly-inert shape, and it is deliberately NOT
 * warned about here: a positive `role:org_member` baseline row does nothing for a
 * member whose area is `None`. That has no grantee, so it cannot be a per-row
 * warning — {@link InstanceShareCopy.baselineReachNote} is what says it instead.
 */
export function deadGrantWarning(areaLabel: string): string {
  return `No effect — their profile already has no ${areaLabel} access to take away.`
}
