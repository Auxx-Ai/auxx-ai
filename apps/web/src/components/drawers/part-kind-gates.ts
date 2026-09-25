// apps/web/src/components/drawers/part-kind-gates.ts

import { PartKind } from '@auxx/lib/resources/client'

/** Part tabs and cards that describe stock, which a service never carries (107 D10). */
const STOCK_ONLY_PART_SURFACES: ReadonlySet<string> = new Set([
  'inventory',
  'costing',
  'subparts',
  'vendors',
  'mrp',
])

/** Whether a stored `part_kind` is `service`; some read paths return a SINGLE_SELECT as an array. */
export function isServiceKind(partKind: unknown): boolean {
  const kind = Array.isArray(partKind) ? partKind[0] : partKind
  return kind === PartKind.SERVICE
}

/** Whether a part tab or card (by its registry value) is hidden for a part of this kind. */
export function isHiddenForPartKind(surfaceId: string, partKind: unknown): boolean {
  return isServiceKind(partKind) && STOCK_ONLY_PART_SURFACES.has(surfaceId)
}
