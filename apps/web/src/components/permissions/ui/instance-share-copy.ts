// apps/web/src/components/permissions/ui/instance-share-copy.ts

import {
  type Area,
  INSTANCE_ACCESS_KEYS,
  INSTANCE_ACCESS_RESOURCES,
  type InstanceAccessKey,
} from '@auxx/lib/permissions/client'
import { BookOpen, Bot, Database, LayoutDashboard, type LucideIcon, Workflow } from 'lucide-react'

/**
 * Per-resource UI copy for the generic {@link import('./instance-share-card').InstanceShareCard}
 * — the client mirror of the server's `INSTANCE_ACCESS_RESOURCES`. Everything
 * resource-specific about the Share card is DATA here, not code: adding KB /
 * dashboards later is one entry each, no new component (§4).
 */
export interface InstanceShareCopy {
  /** The resource noun, e.g. `'dataset'`. Used in inline copy. */
  noun: string
  /** The "everyone can use it by default" baseline line. */
  baselineHint: string
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
    baselineHint: 'Everyone in the workspace can use it in search and agents by default.',
    levels: {
      read: 'Use in search & agents',
      write: 'Add & manage files',
      full: 'Change settings',
    },
  },
  kb: {
    noun: 'knowledge base',
    baselineHint: 'Everyone in the workspace can read and write its articles by default.',
    levels: {
      read: 'Read articles',
      write: 'Write & publish articles',
      full: 'Manage the KB & its settings',
    },
  },
  dashboard: {
    noun: 'dashboard',
    baselineHint: 'Shared with the workspace by default. Restrict it to make it private.',
    levels: {
      read: 'View',
      write: 'Edit widgets & layout',
      full: 'Manage & delete',
    },
  },
  workflow: {
    noun: 'workflow',
    baselineHint: 'Shared with the workspace by default. Restrict it to lock it down.',
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
    baselineHint: 'Shared with the workspace by default. Restrict it to lock it down.',
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
}

/**
 * The reverse of `INSTANCE_ACCESS_RESOURCES` — which instance-access key (if
 * any) a given L2 area expands into per-instance rows for. Shared by every
 * `renderChildren` host that nests `InstanceBaselineRows` / `GranteeInstanceRows`
 * under an area row (`grantee-overrides-tab.tsx`, `grantee-levels-section.tsx`)
 * so the mapping is defined once.
 */
export const AREA_TO_INSTANCE_KEY: Partial<Record<Area, InstanceAccessKey>> = Object.fromEntries(
  INSTANCE_ACCESS_KEYS.map((key) => [INSTANCE_ACCESS_RESOURCES[key].area, key])
)

/**
 * Row copy for the two per-instance row scopes (capability layer v2 §B.2.6):
 * the **baseline** scope ("everyone in the workspace") and a **grantee**
 * scope (a specific member/team's own access), which must never borrow the
 * area grid's raise-only framing — instance grants can restrict as well as
 * raise.
 */
export const INSTANCE_ROW_COPY = {
  baseline: {
    description:
      'The default access every member starts with for each item. Expand an item to see or ' +
      'change who else can reach it.',
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
 */
export function deadGrantWarning(areaLabel: string): string {
  return `No effect — their profile already has no ${areaLabel} access to take away.`
}
