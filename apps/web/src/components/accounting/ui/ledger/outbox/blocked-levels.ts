// apps/web/src/components/accounting/ui/ledger/outbox/blocked-levels.ts

import type { WorkItemSourceKind } from '@auxx/lib/accounting/work-items/client'
import { WORK_SOURCE_LABEL } from '../type-labels'

/** A Blocked group's identity, as `ledger.retryBlockedGroup` and `listBlockedItems` take it. */
export interface BlockedGroupKey {
  reasonCode: string
  role: string | null
  railId: string | null
  glAccountId: string | null
  externalRef?: string | null
}

/** What a group is counted by; `sourceKindCounts` is optional until the group read carries it. */
export interface CountedGroup {
  count: number
  sourceKinds: readonly string[]
  /** Items per `sourceKind`, so a part row reads "446 shipments · 12 builds · 1 count" (111 §1.2). */
  sourceKindCounts?: Readonly<Record<string, number>> | null
}

/** The reason level's words for a `groupsByExternalRef` code (106 §6.1). */
const REASON_LABEL: Record<string, { label: string; ref: readonly [string, string] }> = {
  STANDARD_COST_MISSING: { label: 'Standard cost missing', ref: ['part', 'parts'] },
  GATEWAY_UNMAPPED: { label: 'Gateway not mapped', ref: ['handle', 'handles'] },
}

/** A parked adjustment or opening row is a count to a person, not a "stock movement". */
const ITEM_NOUN: Partial<Record<WorkItemSourceKind, readonly [string, string]>> = {
  stock_movement: ['count', 'counts'],
}

/** The breakdown's order: what a part parks at `price`, then anything else as it comes. */
const KIND_ORDER: readonly string[] = ['fulfillment', 'build', 'stock_movement']

export const groupId = (group: BlockedGroupKey) =>
  [
    group.reasonCode,
    group.role ?? '',
    group.railId ?? '',
    group.glAccountId ?? '',
    group.externalRef ?? '',
  ].join('|')

/** A reason row's id; lower-case prefix so it never collides with a `groupId`. */
export const reasonId = (reasonCode: string) => `reason:${reasonCode}`

export const toGroupKey = ({
  reasonCode,
  role,
  railId,
  glAccountId,
  externalRef,
}: BlockedGroupKey): BlockedGroupKey => ({
  reasonCode,
  role,
  railId,
  glAccountId,
  externalRef: externalRef ?? null,
})

function counted(count: number, [singular, plural]: readonly [string, string]): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? singular : plural}`
}

/** "shipment"/"shipments" when the group holds one kind of source, else "item"/"items". */
export function itemNoun(sourceKinds: readonly string[]): readonly [string, string] {
  if (sourceKinds.length !== 1) return ['item', 'items']
  const kind = sourceKinds[0] as WorkItemSourceKind
  const own = ITEM_NOUN[kind]
  if (own) return own
  const label = WORK_SOURCE_LABEL[kind]
  if (!label) return ['item', 'items']
  const singular = label.toLowerCase()
  return [singular, singular.endsWith('s') ? singular : `${singular}s`]
}

const kindRank = (kind: string) => {
  const at = KIND_ORDER.indexOf(kind)
  return at === -1 ? KIND_ORDER.length : at
}

/** "446 shipments · 12 builds · 1 count" from per-kind counts (zero kinds omitted); one figure without them. */
export function sourceBreakdown(group: CountedGroup): string {
  const byKind = group.sourceKindCounts
  const kinds = byKind ? Object.keys(byKind).filter((kind) => (byKind[kind] ?? 0) > 0) : []
  if (kinds.length === 0) return counted(group.count, itemNoun(group.sourceKinds))
  return kinds
    .sort((a, b) => kindRank(a) - kindRank(b))
    .map((kind) => counted(byKind?.[kind] ?? 0, itemNoun([kind])))
    .join(' · ')
}

function reasonLabel(reasonCode: string): string {
  const known = REASON_LABEL[reasonCode]?.label
  if (known) return known
  const words = reasonCode.toLowerCase().replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** "Standard cost missing · 27 parts · 1,481 shipments" */
export function reasonTitle(
  group: CountedGroup & { reasonCode: string; refCount: number | null }
): string {
  const ref = REASON_LABEL[group.reasonCode]?.ref ?? ['group', 'groups']
  return [
    reasonLabel(group.reasonCode),
    counted(group.refCount ?? 0, ref),
    sourceBreakdown(group),
  ].join(' · ')
}

/** "The Attic-Lift - Standard · 446 shipments · 12 builds · 1 count" */
export function refTitle(
  group: CountedGroup & { reasonCode: string; refLabel: string | null; externalRef: string | null }
): string {
  const name =
    group.refLabel ??
    group.externalRef ??
    (group.reasonCode === 'GATEWAY_UNMAPPED' ? 'No gateway linked' : 'Unnamed')
  return `${name} · ${sourceBreakdown(group)}`
}
