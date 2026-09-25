// apps/web/src/components/mrp/ui/rows/mrp-bulk-bar.tsx

'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import { ActionBar } from '@auxx/ui/components/action-bar'
import { Hammer, ShoppingCart } from 'lucide-react'
import { useMemo } from 'react'
import {
  type BulkBatchRefusal,
  useBulkMode,
  useBulkRunner,
  useListSelection,
  useSelectionIds,
} from '~/components/list-selection'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import type { MrpListRow } from './mrp-row'

export interface MrpBulkBarProps {
  /** The rows currently listed; the selection's ids are their `partId`s. */
  items: MrpListRow[]
  /** The run the rows were read from, so the drafts carry it. */
  runId: string | undefined
}

/** Refusals grouped by reason, each naming its parts, in `useBulkRunner`'s shape. */
export function refusalsByName(
  refused: ReadonlyArray<{ partId: string; reason: string }>,
  nameOf: (partId: string) => string
): BulkBatchRefusal[] {
  const byReason = new Map<string, string[]>()
  for (const refusal of refused) {
    const names = byReason.get(refusal.reason) ?? []
    names.push(nameOf(refusal.partId))
    byReason.set(refusal.reason, names)
  }
  return [...byReason.entries()].map(([reason, names]) => ({
    reason,
    count: names.length,
    label: `refused (${reason}): ${names.join(', ')}`,
  }))
}

/** "Create draft POs" (one per distinct supplier) and "Create draft builds" for the selected rows. */
export function MrpBulkBar({ items, runId }: MrpBulkBarProps) {
  const utils = api.useUtils()
  const { can } = useAccess()
  const canManage = can(PermissionKey.mrpManage)
  const selecting = useBulkMode()
  const selectedIds = useSelectionIds()
  const exitSelection = useListSelection((state) => state.exit)
  const { runBatch, ConfirmDialog, isRunning } = useBulkRunner()
  const createPos = api.mrp.createDraftPurchaseOrders.useMutation()
  const createBuilds = api.mrp.createDraftBuilds.useMutation()

  const byId = useMemo(() => new Map(items.map((item) => [item.partId, item])), [items])
  const nameOf = (partId: string) => byId.get(partId)?.partName ?? 'Unnamed part'

  const purchaseIds = selectedIds.filter((id) => byId.get(id)?.suggestionKind === 'purchase')
  const buildIds = selectedIds.filter((id) => byId.get(id)?.suggestionKind === 'build')
  const supplierCount = new Set(
    purchaseIds.map((id) => byId.get(id)?.suggestedSupplierId).filter(Boolean)
  ).size

  const done = () => {
    void utils.mrp.list.invalidate()
    void utils.mrp.summary.invalidate()
    exitSelection()
  }

  const runPos = () =>
    runBatch(
      purchaseIds,
      async (ids) => {
        const result = await createPos.mutateAsync({
          runId,
          items: ids.map((partId) => ({ partId })),
        })
        return {
          revoked: result.created.reduce((sum, po) => sum + po.partIds.length, 0),
          refused: refusalsByName(result.refused, nameOf),
        }
      },
      {
        title: `Create ${supplierCount} draft ${supplierCount === 1 ? 'PO' : 'POs'}?`,
        description: `One draft purchase order per supplier, from ${purchaseIds.length} selected ${
          purchaseIds.length === 1 ? 'part' : 'parts'
        } at the suggested quantities. Nothing is sent to a supplier.`,
        confirmText: 'Create drafts',
        destructive: false,
        pendingLabel: 'Drafting…',
        removesItem: false,
        failureTitle: 'Some parts were not drafted',
        onDone: done,
      }
    )

  const runBuilds = () =>
    runBatch(
      buildIds,
      async (ids) => {
        const result = await createBuilds.mutateAsync({
          runId,
          items: ids.map((partId) => ({ partId })),
        })
        return {
          revoked: result.created.length,
          refused: refusalsByName(result.refused, nameOf),
        }
      },
      {
        title: `Create ${buildIds.length} draft ${buildIds.length === 1 ? 'build' : 'builds'}?`,
        description: 'One draft build per selected part, at the suggested quantity.',
        confirmText: 'Create drafts',
        destructive: false,
        pendingLabel: 'Drafting…',
        removesItem: false,
        failureTitle: 'Some builds were not drafted',
        onDone: done,
      }
    )

  const busy = isRunning || createPos.isPending || createBuilds.isPending

  return (
    <>
      <ActionBar
        open={selecting}
        onOpenChange={(open) => !open && exitSelection()}
        duration={Number.POSITIVE_INFINITY}
        position='bottom-center'
        selectedCount={selectedIds.length}
        selectedLabel='selected'
        showClose
        actions={[
          {
            id: 'draft-builds',
            label: `Create draft builds (${buildIds.length})`,
            icon: Hammer,
            tooltip: canManage ? 'One draft build per selected build row' : 'Needs MRP manage',
            hidden: buildIds.length === 0,
            disabled: busy || !canManage,
            onClick: () => void runBuilds(),
          },
          {
            id: 'draft-pos',
            label: `Create draft POs (${supplierCount})`,
            icon: ShoppingCart,
            tooltip: canManage
              ? `One draft PO per supplier, from ${purchaseIds.length} purchase rows`
              : 'Needs MRP manage',
            hidden: purchaseIds.length === 0,
            disabled: busy || !canManage,
            onClick: () => void runPos(),
          },
        ]}
      />
      <ConfirmDialog />
    </>
  )
}
