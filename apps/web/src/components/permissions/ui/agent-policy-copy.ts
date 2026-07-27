// apps/web/src/components/permissions/ui/agent-policy-copy.ts

import type { AgentAccessLevel } from '@auxx/database'
import { agentLevelLabel } from './level-labels'

/**
 * Every user-facing string the agent-profile editor renders, in one place — the
 * `instance-share-copy.ts` precedent. Wording here is load-bearing, not
 * decoration: plan 19 §7 fails this surface specifically on labelling, so the
 * strings are reviewed as part of the feature rather than typed inline next to a
 * component.
 *
 * The three rules the copy must never break:
 *  1. Agent `None` is a **deliberate deny**, never "inherit"/"not set" (§7).
 *  2. Permissions do not enable tools and tools do not grant permission (§0.5a/§2.4).
 *  3. Editing reaches **bound drafts only**; production changes on publish (§0.3/§0.16).
 */

/** Ascending ladder order — the segment order of every control on this surface. */
export const AGENT_LEVEL_ORDER: readonly AgentAccessLevel[] = ['none', 'read', 'read_write', 'full']

/** Numeric rank, so "would this be reduced?" is a comparison and not a lookup table. */
export const AGENT_LEVEL_RANK: Record<AgentAccessLevel, number> = {
  none: 0,
  read: 1,
  read_write: 2,
  full: 3,
}

/**
 * What each rung means, in the agent's own terms. `none` deliberately says
 * "deliberate deny" — the one thing this editor must never let a reader mistake
 * for an absent value.
 */
export const AGENT_LEVEL_DESCRIPTIONS: Record<AgentAccessLevel, string> = {
  none: 'No access. A deliberate deny, not an absent value, and nothing raises it back.',
  read: 'View, list and search.',
  read_write: 'Read, plus create, update and delete.',
  full: 'Read and write, plus administration and settings.',
}

/** Header explainer for the whole editor. */
export const POLICY_INTRO = {
  title: 'This policy is exact',
  body:
    'Every area, record type and resource resolves to exactly one of four levels. There is no ' +
    '"not set" at run time. A rule you leave alone follows the collection default shown above ' +
    'it, and that default is itself one of the four levels, so anything created later has a ' +
    'deterministic posture too.',
} as const

/**
 * §0.5a / §2.4 — the distinction the whole feature rests on. Rendered next to the
 * grids and repeated on the definitions grid, because "I gave it Full and it
 * still can't do X" is the predictable support ticket.
 */
export const TOOLS_VS_PERMISSIONS = {
  title: 'Permissions and tools are separate',
  body:
    'Permissions decide what an agent is allowed to reach. Tools decide what it can call. ' +
    'Neither implies the other: granting Full here enables no tool, and enabling a tool grants ' +
    'no permission. What the agent can actually do is the intersection: a tool it holds, ' +
    'pointed at a target this policy allows.',
  link: 'Tools live on the agent’s Tools tab.',
} as const

/**
 * §2.4 + §11a — `canAdministerDef` has zero native agent-tool callers today, so
 * the `Full` rung on a definition is inert across the board, not merely for
 * schema. Say that plainly rather than shipping a rung that quietly does
 * nothing.
 */
export const DEFINITION_FULL_IS_INERT =
  'Full adds definition administration on top of Read and write. No native agent tool creates or ' +
  'alters entity definitions or fields today, and none checks the administration rung at all, ' +
  'so on this grid Full currently behaves like Read and write. It is stored exactly as you set ' +
  'it and starts biting the day such a tool ships.'

/** §11a — mail is outside the four-level model; the areas grid must not imply otherwise. */
export const MAIL_IS_OUTSIDE =
  'Mail is outside this model. There is no mail area, and mail tools are authorized by the ' +
  'mailbox the agent is given. This grid neither opens nor closes them.'

/** Why threads/inboxes/datasets/KBs/dashboards are absent from the definitions grid. */
export const DEFINITIONS_EXCLUSIONS =
  'Threads, inboxes, messages and other mail records are not listed. They are not governed by ' +
  'this keyspace. Datasets, knowledge bases and dashboards have their own grid below.'

/** The resources grid's intersection rule — an instance rule can never beat its area. */
export const RESOURCE_AREA_CLAMP =
  'A resource rule is intersected with its area: setting Knowledge Base to None on the Areas ' +
  'grid closes every knowledge base here, whatever these rows say.'

/** Publication semantics (§0.3/§0.16) — shown whether or not there are pending edits. */
export const PUBLICATION_NOTE =
  'Saving reaches bound agent drafts only: their builder Chat and draft evals. Live agents keep ' +
  'the policy they were published with until someone republishes them.'

/** The state after a save, before a republish. */
export const UNPUBLISHED_TITLE = 'Unpublished changes'

/** Local, unwritten edits. Deliberately distinct wording from {@link UNPUBLISHED_TITLE}. */
export const UNSAVED_TITLE = 'Unsaved changes'

/** OWNER/ADMIN-only rule for agent-side profile editing (doc 14 §0.9). */
export const ADMIN_ONLY_NOTE =
  'Agent permission profiles can be edited by owners and admins only. You can review this policy, ' +
  'but not change it.'

/** §0.26 — writes are plan-gated; reads never are. */
export const PLAN_GATED_NOTE =
  'Editing permission profiles needs the granular-permissions entitlement. This policy is shown ' +
  'read-only on your current plan.'

/** A profile that has never carried an agent policy. Fail-closed is the safe start. */
export const NO_POLICY_YET =
  'This profile carries no agent policy yet. It starts fail-closed at None everywhere, and is ' +
  'written the first time you save.'

/**
 * §2.4a — the author clamp, in the exact shape the plan requires: name the key,
 * both rungs, and the authority that bounded it. Never a silent downgrade.
 *
 * @example clampSentence('Deals', 'full', 'read') // 'Deals reduced from Full to Read (you hold Read)'
 */
export function clampSentence(label: string, from: AgentAccessLevel, to: AgentAccessLevel): string {
  return `${label} reduced from ${agentLevelLabel(from)} to ${agentLevelLabel(to)} (you hold ${agentLevelLabel(to)})`
}

/** Heading for the clamp preview block. */
export const CLAMP_PREVIEW = {
  title: 'Publishing would reduce this policy',
  body:
    'A published agent can never exceed the person who published it. These rules would be lowered ' +
    'to your own access at publish time. The agent would run with the reduced rung, and the ' +
    'reduction is recorded on the published version. An owner or admin publishing the same ' +
    'profile may keep more of it.',
  clear: 'You hold everything this policy asks for, so publishing it would reduce nothing.',
} as const

/** Tooltip on the "follow the default" reset affordance of an override row. */
export function followDefaultTooltip(fallback: AgentAccessLevel): string {
  return `Follow the default (${agentLevelLabel(fallback)})`
}

/** Muted text beside a row that carries no override of its own. */
export function usesDefaultLabel(fallback: AgentAccessLevel): string {
  return `Default · ${agentLevelLabel(fallback)}`
}
