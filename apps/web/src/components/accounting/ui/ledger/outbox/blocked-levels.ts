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

interface CountedGroup {
  reasonCode: string
  count: number
  sourceKinds: string[]
}

/** The reason level's words for a `groupsByExternalRef` code (106 §6.1). */
const REASON_LABEL: Record<string, { label: string; ref: readonly [string, string] }> = {
  STANDARD_COST_MISSING: { label: 'Standard cost missing', ref: ['part', 'parts'] },
  GATEWAY_UNMAPPED: { label: 'Gateway not mapped', ref: ['handle', 'handles'] },
}

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
  const label =
    sourceKinds.length === 1 ? WORK_SOURCE_LABEL[sourceKinds[0] as WorkItemSourceKind] : undefined
  if (!label) return ['item', 'items']
  const singular = label.toLowerCase()
  return [singular, singular.endsWith('s') ? singular : `${singular}s`]
}

function reasonLabel(reasonCode: string): string {
  const known = REASON_LABEL[reasonCode]?.label
  if (known) return known
  const words = reasonCode.toLowerCase().replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** "Standard cost missing · 27 parts · 1,481 shipments" */
export function reasonTitle(group: CountedGroup & { refCount: number | null }): string {
  const ref = REASON_LABEL[group.reasonCode]?.ref ?? ['group', 'groups']
  return [
    reasonLabel(group.reasonCode),
    counted(group.refCount ?? 0, ref),
    counted(group.count, itemNoun(group.sourceKinds)),
  ].join(' · ')
}

/** "The Attic-Lift - Standard · 446 shipments" */
export function refTitle(
  group: CountedGroup & { refLabel: string | null; externalRef: string | null }
): string {
  const name =
    group.refLabel ??
    group.externalRef ??
    (group.reasonCode === 'GATEWAY_UNMAPPED' ? 'No gateway linked' : 'Unnamed')
  return `${name} · ${counted(group.count, itemNoun(group.sourceKinds))}`
}
