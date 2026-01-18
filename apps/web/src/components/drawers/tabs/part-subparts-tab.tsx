// apps/web/src/components/drawers/tabs/part-subparts-tab.tsx
'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { Package, MoreHorizontal, Edit, Trash2, PlusCircle } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { Section } from '@auxx/ui/components/section'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { useConfirm } from '~/hooks/use-confirm'
import { parseRecordId } from '@auxx/lib/resources/client'
import { api } from '~/trpc/react'
import { formatMoney } from '~/utils/strings'
import { SubpartDialog } from '~/components/manufacturing/parts/subpart-dialog'
import type { SubpartEntity as Subpart } from '@auxx/database/models'
import type { DrawerTabProps } from '../drawer-tab-registry'

/** Subparts tab content for parts drawer */
export function PartSubpartsTab({ recordId }: DrawerTabProps) {
  const utils = api.useUtils()
  const [isSubpartDialogOpen, setIsSubpartDialogOpen] = useState(false)
  const [editingSubpart, setEditingSubpart] = useState<Subpart | null>(null)
  const [confirmDelete, ConfirmDeleteDialog] = useConfirm()

  // Extract partId from recordId
  const { entityInstanceId: partId } = parseRecordId(recordId)

  // Fetch part data
  const { data: part, isLoading } = api.part.byId.useQuery(
    { id: partId },
    { enabled: !!partId }
  )

  // Delete subpart mutation
  const deleteSubpart = api.subpart.delete.useMutation({
    onSuccess: () => {
      utils.part.byId.invalidate({ id: partId })
    },
    onError: (error) => {
      toastError({ title: 'Error removing subpart', description: error.message })
    },
  })

  /** Handle delete subpart with confirmation */
  const handleDeleteSubpart = useCallback(
    async (subpart: Subpart) => {
      const confirmed = await confirmDelete({
        title: 'Remove Subpart',
        description: 'Are you sure you want to remove this subpart from the assembly?',
        confirmText: 'Remove',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (confirmed) {
        deleteSubpart.mutate({
          parentPartId: subpart.parentPartId,
          childPartId: subpart.childPartId,
        })
      }
    },
    [confirmDelete, deleteSubpart]
  )

  /** Handle edit subpart */
  const handleEditSubpart = useCallback((subpart: Subpart) => {
    setEditingSubpart(subpart)
    setIsSubpartDialogOpen(true)
  }, [])

  /** Handle dialog close */
  const handleDialogOpenChange = useCallback((open: boolean) => {
    setIsSubpartDialogOpen(open)
    if (!open) {
      setEditingSubpart(null)
    }
  }, [])

  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (!part) {
    return <div className="p-4 text-center text-muted-foreground">Part not found</div>
  }

  const subparts = part.subparts ?? []
  const parentParts = part.parentParts ?? []

  return (
    <>
      {/* Subparts Section */}
      <Section
        title={`Subparts (${subparts.length})`}
        initialOpen
        actions={
          <Button variant="ghost" size="xs" onClick={() => setIsSubpartDialogOpen(true)}>
            <PlusCircle />
            Add Subpart
          </Button>
        }>
        {subparts.length === 0 ? (
          <div className="flex h-24 flex-col items-center justify-center text-center border rounded-lg bg-muted/30">
            <Package className="mb-2 h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No subparts added yet</p>
            <p className="text-xs text-muted-foreground">Add components that make up this part</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Part</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subparts.map((subpart: any) => (
                  <TableRow key={subpart.id}>
                    <TableCell className="font-medium">
                      <div className="flex flex-col">
                        <Link
                          href={`/app/parts?p=${subpart.childPartId}&tab=subparts`}
                          className="truncate hover:underline">
                          {subpart.childPart?.title ?? 'Unknown'}
                        </Link>
                        <span className="text-xs text-muted-foreground">
                          {subpart.childPart?.sku}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium">{subpart.quantity}</TableCell>
                    <TableCell className="text-right">
                      {subpart.childPart?.cost
                        ? formatMoney(subpart.childPart.cost, '${{amount}}')
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm">
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleEditSubpart(subpart)}>
                            <Edit />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => handleDeleteSubpart(subpart)}>
                            <Trash2 />
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      {/* Parent Parts Section */}
      {parentParts.length > 0 && (
        <Section title={`Used In (${parentParts.length})`} initialOpen>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Assembly</TableHead>
                  <TableHead className="text-right">Qty Used</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parentParts.map((parentPart: any) => (
                  <TableRow key={parentPart.id}>
                    <TableCell className="font-medium">
                      <div className="flex flex-col">
                        <Link
                          href={`/app/parts?p=${parentPart.parentPartId}&tab=subparts`}
                          className="truncate hover:underline">
                          {parentPart.parentPart?.title ?? 'Unknown'}
                        </Link>
                        <span className="text-xs text-muted-foreground">
                          {parentPart.parentPart?.sku}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium">{parentPart.quantity}</TableCell>
                  </TableRow>
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
        subpart={editingSubpart}
        onSuccess={() => {
          utils.part.byId.invalidate({ id: partId })
        }}
      />

      <ConfirmDeleteDialog />
    </>
  )
}
