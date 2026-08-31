// apps/web/src/components/drawers/tabs/part-subparts-tab.tsx
'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { getInstanceId, isRecordId, parseRecordId, type RecordId } from '@auxx/lib/resources/client'
import type { ResourceFieldId } from '@auxx/types/field'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { toastError } from '@auxx/ui/components/toast'
import { pluralize } from '@auxx/utils'
import { formatCurrency } from '@auxx/utils/currency'
import { CircleAlert, Edit, MoreHorizontal, Package, PlusCircle, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { SubpartDialog } from '~/components/manufacturing/parts/subpart-dialog'
import { toRecordId, useRecordList, useResourceProperty } from '~/components/resources'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useSystemValuesForRecords } from '~/components/resources/hooks/use-system-values-for-records'
import { RecordLink } from '~/components/resources/ui/record-link'
import { useConfirm } from '~/hooks/use-confirm'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import type { DrawerTabProps } from '../drawer-tab-registry'

/**
 * Page size for both directions of the BOM.
 *
 * A page size, NOT a cap — the effects below drain every page, the same call
 * `line-builder.tsx` makes for document lines. Both lists are bounded (an
 * assembly has tens of components, a part is used in tens of assemblies), and
 * the previous default of 50 truncated silently: the section headers counted
 * the loaded rows, so a 60-component BOM read "Subparts (50)" and looked right.
 */
const BOM_PAGE_SIZE = 100

/** What the assembly-level unpriced check reads off each subpart row. */
const SUBPART_CHILD_ATTRIBUTES = ['subpart_child_part'] as const
/** ...and off each child part it points at. */
const CHILD_COST_ATTRIBUTES = ['part_cost'] as const
/** The assembly's own cost — a blank one is what the banner explains. */
const ASSEMBLY_COST_ATTRIBUTES = ['part_cost'] as const

/** Unwrap a RELATIONSHIP value into the related instance id. */
function relatedInstanceId(raw: unknown): string | undefined {
  const first = Array.isArray(raw) ? raw[0] : raw
  if (typeof first !== 'string') return undefined
  return isRecordId(first) ? getInstanceId(first) : first
}

/** Subparts tab content for parts drawer */
export function PartSubpartsTab({ recordId }: DrawerTabProps) {
  const [isSubpartDialogOpen, setIsSubpartDialogOpen] = useState(false)
  const [editingRecordId, setEditingRecordId] = useState<RecordId | null>(null)
  const [confirmDelete, ConfirmDeleteDialog] = useConfirm()

  // Extract partId from recordId
  const { entityInstanceId: partId } = parseRecordId(recordId)

  // Resolve subpart entity definition ID
  const subpartDefId = useResourceProperty('subpart', 'id')
  // The tab is gated on READ of subpart (drawer config `recordResource`);
  // adding one additionally needs WRITE.
  const { canEditEntity } = useAccess()
  const canCreate = !!subpartDefId && canEditEntity(subpartDefId)

  // Subparts section: children of this part
  const subpartFilters: ConditionGroup[] = useMemo(
    () => [
      {
        id: 'parent-filter',
        logicalOperator: 'AND' as const,
        conditions: [
          {
            id: 'parent-match',
            fieldId: 'subpart:parentPart' as ResourceFieldId,
            operator: 'is' as const,
            value: partId,
          },
        ],
      },
    ],
    [partId]
  )

  const {
    recordIds: subpartIds,
    total: subpartTotal,
    isLoading: isLoadingSubparts,
    hasNextPage: hasMoreSubparts,
    isFetchingNextPage: isFetchingMoreSubparts,
    fetchNextPage: fetchMoreSubparts,
    refresh: refreshSubparts,
  } = useRecordList({
    entityDefinitionId: subpartDefId ?? '',
    filters: subpartFilters,
    limit: BOM_PAGE_SIZE,
    enabled: !!partId && !!subpartDefId,
  })

  useEffect(() => {
    if (hasMoreSubparts && !isFetchingMoreSubparts && !isLoadingSubparts) fetchMoreSubparts()
  }, [hasMoreSubparts, isFetchingMoreSubparts, isLoadingSubparts, fetchMoreSubparts])

  // Used In Assemblies section: parents of this part
  const parentFilters: ConditionGroup[] = useMemo(
    () => [
      {
        id: 'child-filter',
        logicalOperator: 'AND' as const,
        conditions: [
          {
            id: 'child-match',
            fieldId: 'subpart:childPart' as ResourceFieldId,
            operator: 'is' as const,
            value: partId,
          },
        ],
      },
    ],
    [partId]
  )

  const {
    recordIds: parentIds,
    total: parentTotal,
    isLoading: isLoadingParents,
    hasNextPage: hasMoreParents,
    isFetchingNextPage: isFetchingMoreParents,
    fetchNextPage: fetchMoreParents,
    refresh: refreshParents,
  } = useRecordList({
    entityDefinitionId: subpartDefId ?? '',
    filters: parentFilters,
    limit: BOM_PAGE_SIZE,
    enabled: !!partId && !!subpartDefId,
  })

  useEffect(() => {
    if (hasMoreParents && !isFetchingMoreParents && !isLoadingParents) fetchMoreParents()
  }, [hasMoreParents, isFetchingMoreParents, isLoadingParents, fetchMoreParents])

  const isLoading = isLoadingSubparts || isLoadingParents

  const partDefId = useResourceProperty('part', 'id')

  // ── Which direct components have no cost ──────────────────────────────
  //
  // Two lifted reads, because the answer spans the list: the subpart rows say
  // WHICH parts are components, and those parts say whether they are priced.
  // A row subscribing to its own values can only ever answer for itself.
  //
  // 🛑 Keyed on `recordIds`, never on `records`. `useRecordList` resolves
  // `records` from the record store in a SECOND wave, and the list is served
  // from the store cache (5-min TTL) with `isLoading: false` — so on a cached
  // open the ids are known while `records` is still empty. Everything that
  // decides what renders reads ids for that reason; only a row that needs
  // `RecordMeta` itself (a `createdAt`, a `displayName`) may read `records`.
  const subpartRecordIds = useMemo(
    () => (subpartDefId ? subpartIds.map((id) => toRecordId(subpartDefId, id)) : []),
    [subpartIds, subpartDefId]
  )

  const { valuesById: subpartValues } = useSystemValuesForRecords(
    subpartRecordIds,
    SUBPART_CHILD_ATTRIBUTES,
    { autoFetch: true, enabled: subpartRecordIds.length > 0 }
  )

  const childPartRecordIds = useMemo(() => {
    if (!partDefId) return []
    const ids: RecordId[] = []
    for (const subpartRecordId of subpartRecordIds) {
      const childId = relatedInstanceId(subpartValues[subpartRecordId]?.subpart_child_part)
      if (childId) ids.push(toRecordId(partDefId, childId))
    }
    return ids
  }, [subpartRecordIds, subpartValues, partDefId])

  const { valuesById: childCosts, loadedById: childCostsLoaded } = useSystemValuesForRecords(
    childPartRecordIds,
    CHILD_COST_ATTRIBUTES,
    { autoFetch: true, enabled: childPartRecordIds.length > 0 }
  )

  const { values: assemblyValues } = useSystemValues(recordId, ASSEMBLY_COST_ATTRIBUTES, {
    autoFetch: true,
  })
  const assemblyCost = assemblyValues.part_cost as number | null | undefined

  /**
   * Direct components with no cost of their own.
   *
   * **Direct children only.** The calculator tracks the transitive set of
   * unpriced leaves, which is the right thing for it — but here the user is
   * looking at one assembly's component list, and pointing at a part three
   * levels down that is not on this screen would be worse than saying nothing.
   * The copy says "component" to match what is listed.
   *
   * Only children whose cost has actually been READ are counted. An unfetched
   * value and a genuinely absent one both surface as `undefined`, so counting
   * without `loadedById` would report every component as uncosted on first
   * paint and then correct itself — a wrong number is worse than a late one.
   */
  const unpricedChildIds = useMemo(() => {
    const unpriced = new Set<string>()
    for (const childRecordId of childPartRecordIds) {
      if (!childCostsLoaded[childRecordId]?.part_cost) continue
      if (childCosts[childRecordId]?.part_cost == null) unpriced.add(childRecordId)
    }
    return unpriced
  }, [childPartRecordIds, childCosts, childCostsLoaded])

  // Only explains a blank assembly cost. A costed assembly with an unpriced
  // component is a real state (a vendor price won), but it is not this
  // banner's job — nothing is missing from the number on screen.
  const showUnpricedBanner = assemblyCost == null && unpricedChildIds.size > 0

  // Delete via entity system
  const deleteRecord = api.record.delete.useMutation({
    onSuccess: () => {
      refreshSubparts()
      refreshParents()
    },
    onError: (error) => {
      toastError({ title: 'Error removing subpart', description: error.message })
    },
  })

  /** Handle delete subpart with confirmation */
  const handleDeleteSubpart = useCallback(
    async (instanceId: string) => {
      const confirmed = await confirmDelete({
        title: 'Remove Subpart',
        description: 'Are you sure you want to remove this subpart from the assembly?',
        confirmText: 'Remove',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (confirmed && subpartDefId) {
        deleteRecord.mutate({ recordId: toRecordId(subpartDefId, instanceId) })
      }
    },
    [confirmDelete, deleteRecord, subpartDefId]
  )

  /** Handle edit subpart */
  const handleEditSubpart = useCallback(
    (instanceId: string) => {
      if (!subpartDefId) return
      setEditingRecordId(toRecordId(subpartDefId, instanceId))
      setIsSubpartDialogOpen(true)
    },
    [subpartDefId]
  )

  /** Handle dialog close */
  const handleDialogOpenChange = useCallback((open: boolean) => {
    setIsSubpartDialogOpen(open)
    if (!open) {
      setEditingRecordId(null)
    }
  }, [])

  const handleRefresh = useCallback(() => {
    refreshSubparts()
    refreshParents()
  }, [refreshSubparts, refreshParents])

  if (isLoading) {
    return (
      <div className='p-4 space-y-4'>
        <Skeleton className='h-6 w-32' />
        <Skeleton className='h-40 w-full' />
      </div>
    )
  }

  return (
    <ScrollArea className='flex-1'>
      {/* Subparts Section */}
      <Section
        title={`Subparts (${subpartTotal})`}
        initialOpen
        actions={
          canCreate ? (
            <Button variant='ghost' size='xs' onClick={() => setIsSubpartDialogOpen(true)}>
              <PlusCircle />
              Add Subpart
            </Button>
          ) : undefined
        }>
        {subpartIds.length === 0 ? (
          <div className='flex h-24 flex-col items-center justify-center text-center border rounded-lg bg-muted/30'>
            <Package className='mb-2 h-6 w-6 text-muted-foreground' />
            <p className='text-sm text-muted-foreground'>No subparts added yet</p>
            <p className='text-xs text-muted-foreground'>Add components that make up this part</p>
          </div>
        ) : (
          <div className='space-y-2'>
            {showUnpricedBanner && (
              <div className='flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5'>
                <CircleAlert className='mt-0.5 size-4 shrink-0 text-amber-600' />
                <p className='text-xs text-muted-foreground'>
                  <span className='font-medium text-foreground'>
                    {unpricedChildIds.size} {pluralize(unpricedChildIds.size, 'component')}{' '}
                    {unpricedChildIds.size === 1 ? 'has' : 'have'} no cost
                  </span>
                  , so this assembly has none either. Add a supplier price or a bill of materials to
                  each one below.
                </p>
              </div>
            )}
            <div className='rounded-md border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Part</TableHead>
                    <TableHead className='text-right'>Qty</TableHead>
                    <TableHead className='text-right'>Cost</TableHead>
                    <TableHead className='w-10'></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subpartIds.map((id) => (
                    <SubpartRow
                      key={id}
                      recordId={toRecordId(subpartDefId!, id)}
                      relatedPartField='subpart_child_part'
                      linkTab='subparts'
                      showActions
                      unpricedChildIds={unpricedChildIds}
                      onEdit={() => handleEditSubpart(id)}
                      onDelete={() => handleDeleteSubpart(id)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </Section>

      {/* Parent Parts Section */}
      {parentIds.length > 0 && (
        <Section title={`Used In (${parentTotal})`} initialOpen>
          <div className='rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Assembly</TableHead>
                  <TableHead className='text-right'>Qty Used</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parentIds.map((id) => (
                  <SubpartRow
                    key={id}
                    recordId={toRecordId(subpartDefId!, id)}
                    relatedPartField='subpart_parent_part'
                    linkTab='subparts'
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </Section>
      )}

      {/* Subpart Dialog */}
      <SubpartDialog
        open={isSubpartDialogOpen}
        onOpenChange={handleDialogOpenChange}
        parentPartId={partId}
        recordId={editingRecordId ?? undefined}
        onSuccess={handleRefresh}
      />

      <ConfirmDeleteDialog />
    </ScrollArea>
  )
}

// ─── Row Components ─────────────────────────────────────────────────────

const SUBPART_ROW_ATTRIBUTES = ['subpart_quantity'] as const
const PART_NAME_ATTRIBUTES = ['part_title', 'part_sku'] as const
const PART_COST_ATTRIBUTES = ['part_cost'] as const

interface SubpartRowProps {
  recordId: RecordId
  /** Which relationship field to resolve for the part name */
  relatedPartField: 'subpart_child_part' | 'subpart_parent_part'
  linkTab: string
  showActions?: boolean
  /**
   * Component part `RecordId`s the assembly found to have no cost. Computed
   * once by the tab so every row agrees with the banner above them, rather
   * than each row deciding for itself.
   */
  unpricedChildIds?: ReadonlySet<string>
  onEdit?: () => void
  onDelete?: () => void
}

function SubpartRow({
  recordId,
  relatedPartField,
  linkTab,
  showActions,
  unpricedChildIds,
  onEdit,
  onDelete,
}: SubpartRowProps) {
  const attributes = useMemo(
    () => [relatedPartField, ...SUBPART_ROW_ATTRIBUTES] as const,
    [relatedPartField]
  )
  const { values } = useSystemValues(recordId, attributes, {
    autoFetch: true,
  })
  // Read-only viewers of the subpart definition keep the row (and its column
  // alignment) but lose the actions menu — edit and remove are both writes.
  const { canEditEntity } = useAccess()
  const canEdit = canEditEntity(parseRecordId(recordId).entityDefinitionId)

  // Relationship fields return RecordId[] from formatToRawValue — unwrap and extract instance ID
  const rawPartValue = values[relatedPartField]
  const firstValue = Array.isArray(rawPartValue) ? rawPartValue[0] : rawPartValue
  const relatedPartId =
    typeof firstValue === 'string' && isRecordId(firstValue)
      ? getInstanceId(firstValue)
      : (firstValue as string | undefined)
  const quantity = values.subpart_quantity as number | undefined

  return (
    <TableRow>
      <TableCell className='font-medium'>
        {relatedPartId ? (
          <PartNameCell partId={relatedPartId} linkTab={linkTab} />
        ) : (
          <span className='text-muted-foreground'>Unknown</span>
        )}
      </TableCell>
      <TableCell className='text-right font-medium'>{quantity ?? '—'}</TableCell>
      {showActions && (
        <>
          <TableCell className='text-right'>
            {relatedPartId ? (
              <PartCostCell partId={relatedPartId} unpricedChildIds={unpricedChildIds} />
            ) : (
              '—'
            )}
          </TableCell>
          <TableCell>
            {canEdit && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant='ghost' size='icon-sm'>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end'>
                  <DropdownMenuItem onClick={onEdit}>
                    <Edit />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem variant='destructive' onClick={onDelete}>
                    <Trash2 />
                    Remove
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </TableCell>
        </>
      )}
    </TableRow>
  )
}

/** Resolves and displays part title + SKU from entity system */
function PartNameCell({ partId, linkTab }: { partId: string; linkTab: string }) {
  const partDefId = useResourceProperty('part', 'id')
  const partRecordId = partDefId ? toRecordId(partDefId, partId) : ('' as RecordId)
  const { values } = useSystemValues(partRecordId || undefined, PART_NAME_ATTRIBUTES, {
    autoFetch: true,
    enabled: !!partRecordId,
  })
  const title = values.part_title as string | undefined
  const sku = values.part_sku as string | undefined

  return (
    <div className='flex flex-col'>
      <RecordLink
        recordId={partRecordId || undefined}
        link={{ tab: linkTab }}
        className='truncate'
        openInStack>
        {title ?? 'Loading...'}
      </RecordLink>
      {sku && <span className='text-xs text-muted-foreground'>{sku}</span>}
    </div>
  )
}

/**
 * A component's cost, marked when it has none.
 *
 * A blank cell already said "no cost"; what it never said is that this blank is
 * why the assembly above has no cost either. The marker only appears for parts
 * the tab counted, so a row can never disagree with the banner.
 */
function PartCostCell({
  partId,
  unpricedChildIds,
}: {
  partId: string
  unpricedChildIds?: ReadonlySet<string>
}) {
  const partDefId = useResourceProperty('part', 'id')
  const partRecordId = partDefId ? toRecordId(partDefId, partId) : ('' as RecordId)
  const { values } = useSystemValues(partRecordId || undefined, PART_COST_ATTRIBUTES, {
    autoFetch: true,
    enabled: !!partRecordId,
  })
  const cost = values.part_cost as number | null | undefined

  if (cost != null) return <>{formatCurrency(cost)}</>

  if (partRecordId && unpricedChildIds?.has(partRecordId)) {
    return (
      <Tooltip content='This component has no cost, so it contributes nothing to the assembly'>
        <span className='inline-flex items-center gap-1 text-amber-600'>
          <CircleAlert className='size-3.5' />
          No cost
        </span>
      </Tooltip>
    )
  }

  return <span className='text-muted-foreground'>—</span>
}
