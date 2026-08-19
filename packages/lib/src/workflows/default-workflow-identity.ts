// packages/lib/src/workflows/default-workflow-identity.ts

import { incrementTitle } from '@auxx/utils'

/**
 * Base name given to a workflow created from scratch. `create` appends the
 * lowest free number via {@link incrementTitle}, so the first one is
 * "Untitled workflow", the next "Untitled workflow 1", and so on.
 */
export const UNTITLED_WORKFLOW_NAME = 'Untitled workflow'

/**
 * Icon ids offered to a brand-new workflow, drawn at random.
 *
 * Deliberately a curated subset of `ICON_DATA` (`@auxx/ui/components/icon-data`)
 * rather than the whole catalog — that catalog carries UI chrome like `x` and
 * `menu`, which would read as broken when it lands on a workflow tile. Every id
 * here must exist in `ICON_DATA` or `getIcon` renders nothing.
 */
export const DEFAULT_WORKFLOW_ICON_IDS = [
  'zap',
  'git-branch',
  'bot',
  'play',
  'repeat',
  'send',
  'filter',
  'refresh',
  'sparkles',
  'activity',
  'webhook',
  'layers',
  'plug',
  'gauge',
  'target',
  'merge',
  'boxes',
  'list-checks',
  'rotate',
  'terminal',
] as const

/**
 * Colour ids cycled across new workflows, mirroring `ICON_COLORS`
 * (`@auxx/ui/components/icons`) in order. Kept as a local literal because
 * `@auxx/lib` sits below `@auxx/ui` in the dependency tiers; `getIconColor`
 * falls back to the first entry for an unknown id, so a drift here degrades to
 * grey rather than breaking.
 */
const WORKFLOW_ICON_COLOR_IDS = [
  'gray',
  'red',
  'orange',
  'amber',
  'green',
  'emerald',
  'teal',
  'blue',
  'indigo',
  'purple',
  'pink',
] as const

/** Icon stored on `WorkflowApp.icon`. */
export interface WorkflowIdentityIcon {
  iconId: string
  color: string
}

/**
 * Pick the icon for a new workflow: a random glyph from the curated pool, and a
 * colour *cycled* by how many workflows the org already has. Cycling the colour
 * rather than randomising it keeps the grid visually distinct — random picks
 * clump on 12 colours long before the pool is exhausted.
 *
 * @param existingCount - How many workflows the org already has.
 */
export function pickDefaultWorkflowIcon(existingCount: number): WorkflowIdentityIcon {
  const iconId =
    DEFAULT_WORKFLOW_ICON_IDS[Math.floor(Math.random() * DEFAULT_WORKFLOW_ICON_IDS.length)]!
  const color = WORKFLOW_ICON_COLOR_IDS[existingCount % WORKFLOW_ICON_COLOR_IDS.length]!
  return { iconId, color }
}

/**
 * Next free "Untitled workflow" name given the names already taken.
 *
 * @param existingNames - Names already in use in the organization.
 */
export function nextUntitledWorkflowName(existingNames: Iterable<string>): string {
  return incrementTitle(UNTITLED_WORKFLOW_NAME, new Set(existingNames))
}
