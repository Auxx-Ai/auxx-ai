// apps/web/src/components/returns/ui/return-salvage-container.tsx
'use client'

// What the drawer registry actually holds for `return:salvage`
// (plans/money/tasks/54-returns.md §6.6).
//
// `ReturnSalvageCard` cannot be registered itself: the registry's value type is
// `ComponentType<DrawerTabProps>` (`{ entityInstanceId, recordId, record? }`)
// and the card takes its tree as a prop. This is the join - it reads the
// return, picks a LINE, runs `return.salvageTree` and the five mutations, and
// hands the card data and callbacks. Keeping the card props-driven is what let
// the tree be built before any of this existed.
//
// 🛑 **THE TREE HANGS OFF A `return_line`, NOT A `return`.** A return is a
// shipment back; a line is one sold line of it, and each line has its own bill
// of materials and therefore its own tree. This card is registered on the
// RETURN drawer, so the line has to be chosen here. It is chosen, not
// stacked:
//
//  - a tree costs four reads including a recursive BOM CTE, so rendering every
//    line's tree at once turns opening a five-line return into twenty reads of
//    a checklist the warehouse works through one lift at a time;
//  - the salvage percentage below is line-grained, and a header control with
//    several trees under it is ambiguous about which one it writes to;
//  - the common case is a single line, where the selector does not render at
//    all and the card looks exactly as it would have.
//
// ⚠️ The percentage control is a HEADER control, and §6.6's "🛑 salvagePercent
// has no editor" is why. §6.4 stores it per `return_part_line` and the salvage
// writer freezes `unitCost = round(standard * pct / 100)` from it, but the
// owner's spec for a row is "a number input and a status badge selector, and
// nothing else". One control per line, applied to the rows marked good,
// respects both: the field gets a home and the row keeps its two inputs.

import { toRecordId } from '@auxx/lib/resources/client'
import {
  DEFAULT_SALVAGE_PERCENT,
  flattenSalvageTree,
  type SalvageNode,
} from '@auxx/lib/returns/client'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { EmptySection } from '@auxx/ui/components/section'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { toastError } from '@auxx/ui/components/toast'
import { PackageX } from 'lucide-react'
import { useCallback, useId, useMemo, useState } from 'react'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { Tooltip } from '~/components/global/tooltip'
import { useRecordDrawerReadOnly } from '~/components/records/use-record-drawer-read-only'
import { useRecords } from '~/components/resources/hooks'
import { api, type RouterInputs, type RouterOutputs } from '~/trpc/react'
import { ReturnSalvageCard } from './return-salvage-card'

/** The whole refreshed tree, which is what every salvage write answers with. */
type SalvageTreeView = RouterOutputs['return']['salvageTree']
/**
 * The salvage query's key, which every mutation's variables also satisfy.
 *
 * `recordIdSchema` is a cast rather than a parsed brand, so tRPC infers the id
 * as `unknown` on the way in. Threading the router's own input type through
 * keeps the cache write keyed identically to the query instead of casting.
 */
type SalvageTreeKey = RouterInputs['return']['salvageTree']
type ReturnLine = NonNullable<RouterOutputs['return']['get']>['lines'][number]

/** Stable identities, so the memos below do not rebuild on every render. */
const NO_LINES: ReturnLine[] = []
const NO_NODES: SalvageNode[] = []

/**
 * The salvage tree for one line of a return, with the line picker and the
 * line's salvage valuation.
 */
export function ReturnSalvageContainer({ recordId, entityInstanceId }: DrawerTabProps) {
  // The affordance only. The real gate is `edit` on `return_part_line`, which
  // every mutation asserts server-side - a refusal there still surfaces as a
  // toast rather than silently doing nothing.
  const readOnly = useRecordDrawerReadOnly(
    parseRecordId(recordId).entityDefinitionId,
    entityInstanceId
  )

  const returnQuery = api.return.get.useQuery({ returnRecordId: recordId })
  const lines = returnQuery.data?.lines ?? NO_LINES

  const [pickedRecordId, setPickedRecordId] = useState<string | null>(null)
  // A picked line that has since been deleted falls back to the first rather
  // than leaving the card empty.
  const line = useMemo(
    () => lines.find((candidate) => candidate.recordId === pickedRecordId) ?? lines[0] ?? null,
    [lines, pickedRecordId]
  )
  const lineRecordId = line?.recordId ?? null

  const partNames = useLinePartNames(lines)

  const treeQuery = api.return.salvageTree.useQuery(
    { returnLineRecordId: lineRecordId as RecordId },
    { enabled: Boolean(lineRecordId) }
  )
  const nodes = treeQuery.data?.nodes ?? NO_NODES

  const utils = api.useUtils()
  /**
   * Every salvage mutation answers with the WHOLE refreshed tree, so the
   * response is the next state of the query rather than a reason to refetch
   * it. Keyed off the mutation's own variables, not the current selection: a
   * write that lands after the user switched lines belongs to the line it was
   * sent for.
   */
  const applyTree = useCallback(
    (view: SalvageTreeView, variables: SalvageTreeKey) => {
      utils.return.salvageTree.setData({ returnLineRecordId: variables.returnLineRecordId }, view)
    },
    [utils]
  )

  const onWriteError = useCallback(
    (title: string) => (error: { message: string }) =>
      toastError({ title, description: error.message }),
    []
  )

  // `onExpand` is awaited by the card's expansion hook and its rejection is
  // what keeps the row closed, so this one deliberately has no `onError`.
  const expandNode = api.return.expandSalvageNode.useMutation({ onSuccess: applyTree })
  const setNodeQuantity = api.return.setSalvageNodeQuantity.useMutation({
    onSuccess: applyTree,
    onError: onWriteError('Error updating quantity'),
  })
  const setNodeStatus = api.return.setSalvageNodeStatus.useMutation({
    onSuccess: applyTree,
    onError: onWriteError('Error updating condition'),
  })
  const splitNode = api.return.splitSalvageNode.useMutation({
    onSuccess: applyTree,
    onError: onWriteError('Error splitting the row'),
  })

  const handleExpand = useCallback(
    async (node: { key: string }) => {
      if (!lineRecordId) return
      await expandNode.mutateAsync({ returnLineRecordId: lineRecordId, nodeKey: node.key })
    },
    [expandNode, lineRecordId]
  )

  if (returnQuery.isLoading) return <EmptySection loading />

  if (!line || !lineRecordId) {
    return (
      <EmptySection
        icon={<PackageX className='size-5' />}
        title='Nothing to inspect yet'
        description='Add what came back as a return line, and its components appear here.'
      />
    )
  }

  if (treeQuery.error) {
    return (
      <EmptySection
        icon={<PackageX className='size-5' />}
        title='This line cannot be torn down'
        description={treeQuery.error.message}
      />
    )
  }

  return (
    <div className='space-y-2'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        {lines.length > 1 && (
          <Select
            value={line.recordId}
            onValueChange={(next) => setPickedRecordId(next)}
            disabled={treeQuery.isLoading}>
            <SelectTrigger size='sm' className='w-auto min-w-40 max-w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {lines.map((candidate, index) => (
                <SelectItem key={candidate.recordId} value={candidate.recordId}>
                  {lineLabel(
                    candidate.partId ? partNames.get(candidate.partId) : undefined,
                    index,
                    candidate.quantity
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <SalvagePercentControl
          nodes={nodes}
          returnLineRecordId={lineRecordId}
          onApplied={applyTree}
          disabled={readOnly || treeQuery.isLoading}
        />
      </div>

      {/* Keyed by the line: expansion state is local to the card and keyed by
          node, and a node key from the previous line means nothing here. */}
      <ReturnSalvageCard
        key={lineRecordId}
        nodes={nodes}
        isLoading={treeQuery.isLoading}
        readOnly={readOnly}
        onExpand={handleExpand}
        onChangeQuantity={(node, quantity) =>
          setNodeQuantity.mutate({ returnLineRecordId: lineRecordId, nodeKey: node.key, quantity })
        }
        onChangeStatus={(node, status) =>
          setNodeStatus.mutate({ returnLineRecordId: lineRecordId, nodeKey: node.key, status })
        }
        onSplit={(node) =>
          splitNode.mutate({ returnLineRecordId: lineRecordId, nodeKey: node.key })
        }
      />
    </div>
  )
}

/**
 * One percentage of standard cost for everything recovered off this line.
 *
 * Shows the percentage the good rows already agree on, blank when they do not,
 * and 100 when nothing is good yet - so the number on screen is never a claim
 * about rows that do not carry it. Applying resets the draft, which puts the
 * control back under the server's answer.
 */
function SalvagePercentControl({
  nodes,
  returnLineRecordId,
  onApplied,
  disabled,
}: {
  nodes: readonly SalvageNode[]
  returnLineRecordId: RecordId
  onApplied: (view: SalvageTreeView, variables: SalvageTreeKey) => void
  disabled: boolean
}) {
  const inputId = useId()
  const [draft, setDraft] = useState<string | null>(null)

  const goodNodes = useMemo(
    () => flattenSalvageTree(nodes).filter((node) => node.materialized && node.status === 'good'),
    [nodes]
  )
  /** The value they all carry, or null when they disagree. */
  const settled = useMemo(() => {
    if (goodNodes.length === 0) return DEFAULT_SALVAGE_PERCENT
    const first = goodNodes[0]?.salvagePercent ?? DEFAULT_SALVAGE_PERCENT
    return goodNodes.every((node) => node.salvagePercent === first) ? first : null
  }, [goodNodes])

  const setPercent = api.return.setSalvagePercent.useMutation({
    onSuccess: (view, variables) => {
      setDraft(null)
      onApplied(view, variables)
    },
    onError: (error) =>
      toastError({ title: 'Error valuing the recovery', description: error.message }),
  })

  const shown = draft ?? (settled === null ? '' : String(settled))
  const parsed = Number(shown)
  // 0 < pct <= 100 (§6.4). A component worth nothing is `scrap`, which writes
  // no movement at all rather than a zero-valued one.
  const valid = shown.trim() !== '' && Number.isFinite(parsed) && parsed > 0 && parsed <= 100
  const canApply = valid && goodNodes.length > 0 && parsed !== settled && !disabled

  const apply = () => {
    if (!canApply) return
    setPercent.mutate({ returnLineRecordId, salvagePercent: parsed })
  }

  return (
    <div className='ms-auto flex min-w-0 items-center gap-1.5'>
      <label htmlFor={inputId} className='shrink-0 text-muted-foreground text-xs'>
        Salvage
      </label>
      <Tooltip
        content={
          goodNodes.length === 0
            ? 'Mark a component good first. Only a recovery carries a value.'
            : `Values the ${goodNodes.length} component${goodNodes.length === 1 ? '' : 's'} marked good at this percentage of standard cost.`
        }>
        <div className='flex items-center'>
          <Input
            id={inputId}
            size='sm'
            inputMode='numeric'
            className='w-14 text-right tabular-nums'
            placeholder={settled === null ? 'Mixed' : '100'}
            aria-label='Salvage percentage of standard cost'
            aria-invalid={shown.trim() !== '' && !valid}
            value={shown}
            disabled={disabled}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') apply()
            }}
          />
          <span className='pl-1 text-muted-foreground text-xs'>%</span>
        </div>
      </Tooltip>
      <Button
        variant='outline'
        size='sm'
        disabled={!canApply}
        loading={setPercent.isPending}
        loadingText='Applying...'
        onClick={apply}>
        Apply
      </Button>
    </div>
  )
}

/**
 * Display names for the parts the lines returned, for the picker.
 *
 * Batched through the record store like every other id-to-name read, and
 * entirely optional: a name that has not landed falls back to the line's
 * position, so the picker is never blocked on it.
 */
function useLinePartNames(lines: readonly ReturnLine[]): ReadonlyMap<string, string> {
  const partIds = useMemo(() => {
    const seen = new Set<string>()
    for (const line of lines) if (line.partId) seen.add(line.partId)
    return [...seen]
  }, [lines])

  // The `part` alias is normalized to the definition UUID by `useRecords`, so
  // the def id does not have to be resolved here first.
  const recordIds = useMemo(() => partIds.map((partId) => toRecordId('part', partId)), [partIds])
  const { records } = useRecords({ recordIds, enabled: recordIds.length > 0 })

  return useMemo(() => {
    const names = new Map<string, string>()
    records.forEach((record, index) => {
      const partId = partIds[index]
      if (partId && typeof record?.displayName === 'string') names.set(partId, record.displayName)
    })
    return names
  }, [partIds, records])
}

/** "Hydraulic lift x2", or "Line 2 x2" while the part's name is still loading. */
function lineLabel(partName: string | undefined, index: number, quantity: number | null): string {
  const name = partName ?? `Line ${index + 1}`
  return quantity && quantity !== 1 ? `${name} x${quantity}` : name
}
