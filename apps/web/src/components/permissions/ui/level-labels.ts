// apps/web/src/components/permissions/ui/level-labels.ts

import type { AgentAccessLevel } from '@auxx/database'
import { ResourcePermission } from '@auxx/database/enums'
import { Level } from '@auxx/lib/permissions/client'

/**
 * The single display vocabulary for the four-rung access ladder (plan 26 §2.1).
 *
 * Three type-level spellings of the SAME ladder ship today — numeric {@link Level},
 * the `none/view/edit/admin` {@link ResourcePermission} strings, and the agent
 * policy's `none/read/read_write/full` — and each grew its own label map, so
 * rung 2 was named four different ways on four adjacent surfaces ("Edit", "Read
 * and write", a plus-signed variant, and the misleading bare "Write"). Those four
 * maps are gone. Every rung string a permissions surface renders now comes
 * from here, keyed by {@link Level}; the conversion tables exist purely so the
 * other two spellings can reach it — and, since each is a bijection onto the
 * same four rungs, so that a widget typed in one spelling can be driven by a
 * caller holding the other. "Write" is deliberately gone — rung 2
 * has always included read, and naming it "Write" read as write-only.
 */

/** Short label per rung — segmented controls and compact chips. */
export const RUNG_LABELS: Record<Level, string> = {
  [Level.None]: 'None',
  [Level.Read]: 'Read',
  [Level.Edit]: 'Edit',
  [Level.Full]: 'Full',
}

/** Long label per rung — dropdown options and prose, where a bare "Edit" is thin. */
export const RUNG_LABELS_LONG: Record<Level, string> = {
  [Level.None]: 'No access',
  [Level.Read]: 'Read only',
  [Level.Edit]: 'Read and write',
  [Level.Full]: 'Full access',
}

/** Which form of the label a caller wants. */
export type LabelForm = 'short' | 'long'

function labelOf(level: Level, form: LabelForm): string {
  return form === 'long' ? RUNG_LABELS_LONG[level] : RUNG_LABELS[level]
}

/** The `ResourcePermission` spelling of the ladder, as rungs. */
export const LEVEL_OF_PERMISSION: Record<ResourcePermission, Level> = {
  [ResourcePermission.none]: Level.None,
  [ResourcePermission.view]: Level.Read,
  [ResourcePermission.edit]: Level.Edit,
  [ResourcePermission.admin]: Level.Full,
}

/** The agent-policy spelling of the ladder, as rungs. */
export const LEVEL_OF_AGENT_LEVEL: Record<AgentAccessLevel, Level> = {
  none: Level.None,
  read: Level.Read,
  read_write: Level.Edit,
  full: Level.Full,
}

/** Exact inverse of {@link LEVEL_OF_AGENT_LEVEL} — total, so no fallback rung is invented. */
const AGENT_LEVEL_OF_LEVEL: Record<Level, AgentAccessLevel> = {
  [Level.None]: 'none',
  [Level.Read]: 'read',
  [Level.Edit]: 'read_write',
  [Level.Full]: 'full',
}

/** Exact inverse of {@link LEVEL_OF_PERMISSION} — total, so no fallback rung is invented. */
export const PERMISSION_OF_LEVEL: Record<Level, ResourcePermission> = {
  [Level.None]: ResourcePermission.none,
  [Level.Read]: ResourcePermission.view,
  [Level.Edit]: ResourcePermission.edit,
  [Level.Full]: ResourcePermission.admin,
}

/** The agent-policy spelling of a rung — the exact inverse of {@link LEVEL_OF_AGENT_LEVEL}. */
export function agentLevelOfLevel(level: Level): AgentAccessLevel {
  return AGENT_LEVEL_OF_LEVEL[level]
}

/** The `ResourcePermission` spelling of a rung — the exact inverse of {@link LEVEL_OF_PERMISSION}. */
export function permissionOfLevel(level: Level): ResourcePermission {
  return PERMISSION_OF_LEVEL[level]
}

/**
 * Agent rung → `ResourcePermission`, via the shared ladder.
 *
 * Exists so agent policy can drive the `ResourcePermission`-typed
 * `AccessLevelSelect` (plan 26 §2.2) without either side learning the other's
 * spelling. Lossless in both directions — the two tables are bijections onto
 * the same four rungs, so a round trip is the identity and no agent value is
 * ever widened or clamped by the conversion itself.
 */
export function permissionOfAgentLevel(level: AgentAccessLevel): ResourcePermission {
  return PERMISSION_OF_LEVEL[LEVEL_OF_AGENT_LEVEL[level]]
}

/** `ResourcePermission` → agent rung. The exact inverse of {@link permissionOfAgentLevel}. */
export function agentLevelOfPermission(permission: ResourcePermission): AgentAccessLevel {
  return AGENT_LEVEL_OF_LEVEL[LEVEL_OF_PERMISSION[permission]]
}

/** Display label for a `ResourcePermission`, on the shared rung vocabulary. */
export function permissionLabel(permission: ResourcePermission, form: LabelForm = 'short'): string {
  return labelOf(LEVEL_OF_PERMISSION[permission], form)
}

/** Display label for an `AgentAccessLevel`, on the shared rung vocabulary. */
export function agentLevelLabel(level: AgentAccessLevel, form: LabelForm = 'short'): string {
  return labelOf(LEVEL_OF_AGENT_LEVEL[level], form)
}
