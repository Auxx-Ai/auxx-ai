// apps/web/src/components/manufacturing/stock-setup/fix-accounts-copy.ts

import { partKindLabel } from '~/components/manufacturing/hooks/use-opening-stock'
import type { RouterOutputs } from '~/trpc/react'

export type MovementAccountDrift = RouterOutputs['builds']['movementAccountDrift']

const ROLE_LABELS: Record<string, string> = {
  inventory_raw_materials: 'Raw Materials',
  inventory_finished_goods: 'Finished Goods',
  inventory_wip: 'Work in Process',
}

const KIND_PLURALS: Record<string, string> = {
  component: 'Components',
  subassembly: 'Subassemblies',
  finished_good: 'Finished Goods',
}

/** "Finished Goods" for `inventory_finished_goods`; unknown roles read as themselves. */
export function inventoryRoleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role
}

/** Up to three names, then "and N more". */
export function listPartNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length <= 3) return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
}

/** One label when every value agrees, else null. */
function single<T>(values: T[]): T | null {
  const distinct = [...new Set(values)]
  return distinct.length === 1 ? (distinct[0] ?? null) : null
}

export interface FixAccountsCopy {
  title: string
  /** The sentence before "**Fix accounts**", and the one after it. */
  lead: string
  tail: string
  /** Only when some movements are already in the books. */
  posted: string | null
  confirm: string
}

/** The Fix accounts card's words for a drift read (plans/mrp/17 §5.2). */
export function fixAccountsCopy(drift: MovementAccountDrift): FixAccountsCopy {
  const { parts, movementCount, postedCount } = drift
  const count = parts.length
  const names = listPartNames(parts.map((part) => part.partName))
  const kind = single(parts.map((part) => part.currentKind ?? 'component'))
  const from = single(parts.flatMap((part) => part.fromAccountRoles))
  const to = single(parts.map((part) => part.expectedAccountRole))
  const movements = movementCount.toLocaleString()
  const toLabel = to ? inventoryRoleLabel(to) : 'the account for their new kind'
  const their = count === 1 ? 'its' : 'their'

  const kindText = !kind
    ? 'changed kind'
    : count === 1
      ? `is now a ${partKindLabel(kind)}`
      : `are now ${KIND_PLURALS[kind] ?? partKindLabel(kind)}`
  const fromText = from ? `the ${inventoryRoleLabel(from)} account` : `${their} old account`

  return {
    title: `${count.toLocaleString()} ${count === 1 ? 'part' : 'parts'} changed kind after ${their} movements were recorded`,
    lead: `${names} ${kindText}, but ${movements} of ${their} past movements still carry ${fromText}.`,
    tail: `moves them to ${toLabel}. Quantities, dates and builds stay exactly as they are.`,
    posted:
      postedCount > 0
        ? `${postedCount.toLocaleString()} of them are already in your books. Those stay as they are; one correcting entry per part moves their value instead.`
        : null,
    confirm:
      `Moves ${movements} past movements to ${toLabel}; quantities, dates and builds don't change.` +
      (postedCount > 0
        ? ` The ${postedCount.toLocaleString()} already in your books get one correcting entry per part.`
        : ''),
  }
}
