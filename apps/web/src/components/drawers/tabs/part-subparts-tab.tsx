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
import { formatCurrency } from '@auxx/utils/currency'
import { Edit, MoreHorizontal, Package, PlusCircle, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useMemo, useState } from 'react'
import { SubpartDialog } from '~/components/manufacturing/parts/subpart-dialog'
import { toRecordId, useRecordList, useResourceProperty } from '~/components/resources'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import type { DrawerTabProps } from '../drawer-tab-registry'

/** Subparts tab content for parts drawer */
export function PartSubpartsTab({ recordId }: DrawerTabProps) {
  const [isSubpartDialogOpen, setIsSubpartDialogOpen] = useState(false)
  const [editingRecordId, setEditingRecordId] = useState<RecordId | null>(null)
  const [confirmDelete, ConfirmDeleteDialog] = useConfirm()

  // Extract partId from recordId
  const { entityInstanceId: partId } = parseRecordId(recordId)

  // Resolve subpart entity definition ID
  const subpartDefId = useResourceProperty('subpart', 'id')

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
    records: subpartRecords,
    isLoading: isLoadingSubparts,
    refresh: refreshSubparts,
  } = useRecordList({
    entityDefinitionId: subpartDefId ?? '',
    filters: subpartFilters,
    enabled: !!partId && !!subpartDefId,
  })

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
    records: parentRecords,
    isLoading: isLoadingParents,
    refresh: refreshParents,
  } = useRecordList({
    entityDefinitionId: subpartDefId ?? '',
    filters: parentFilters,
    enabled: !!partId && !!subpartDefId,
  })

  const isLoading = isLoadingSubparts || isLoadingParents

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
        title={`Subparts (${subpartRecords.length})`}
        initialOpen
        actions={
          <Button variant='ghost' size='xs' onClick={() => setIsSubpartDialogOpen(true)}>
            <PlusCircle />
            Add Subpart
          </Button>
        }>
        {subpartRecords.length === 0 ? (
          <div className='flex h-24 flex-col items-center justify-center text-center border rounded-lg bg-muted/30'>
            <Package className='mb-2 h-6 w-6 text-muted-foreground' />
            <p className='text-sm text-muted-foreground'>No subparts added yet</p>
            <p className='text-xs text-muted-foreground'>Add components that make up this part</p>
          </div>
        ) : (
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
                {subpartRecords.map((record) => (
                  <SubpartRow
                    key={record.id}
                    recordId={toRecordId(subpartDefId!, record.id)}
                    relatedPartField='subpart_child_part'
                    linkTab='subparts'
                    showActions
                    onEdit={() => handleEditSubpart(record.id)}
                    onDelete={() => handleDeleteSubpart(record.id)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      {/* Parent Parts Section */}
      {parentRecords.length > 0 && (
        <Section title={`Used In (${parentRecords.length})`} initialOpen>
          <div className='rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Assembly</TableHead>
                  <TableHead className='text-right'>Qty Used</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parentRecords.map((record) => (
                  <SubpartRow
                    key={record.id}
                    recordId={toRecordId(subpartDefId!, record.id)}
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
  onEdit?: () => void
  onDelete?: () => void
}

function SubpartRow({
  recordId,
  relatedPartField,
  linkTab,
  showActions,
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
            {relatedPartId ? <PartCostCell partId={relatedPartId} /> : '—'}
          </TableCell>
          <TableCell>
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
      <Link href={`/app/parts?p=${partId}&tab=${linkTab}`} className='truncate hover:underline'>
        {title ?? 'Loading...'}
      </Link>
      {sku && <span className='text-xs text-muted-foreground'>{sku}</span>}
    </div>
  )
}

/** Resolves and displays part cost from entity system */
function PartCostCell({ partId }: { partId: string }) {
  const partDefId = useResourceProperty('part', 'id')
  const partRecordId = partDefId ? toRecordId(partDefId, partId) : ('' as RecordId)
  const { values } = useSystemValues(partRecordId || undefined, PART_COST_ATTRIBUTES, {
    autoFetch: true,
    enabled: !!partRecordId,
  })
  const cost = values.part_cost as number | null | undefined

  return cost ? formatCurrency(cost) : <span className='text-muted-foreground'>—</span>
}
