// apps/web/src/components/manufacturing/parts/parts-drawer-overview.tsx
'use client'

import { useState } from 'react'
import { Blocks, Edit, PlusCircle } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import EntityFields from '~/components/fields/entity-fields'
import { InventoryDialog } from './inventory-dialog'
import type { RouterOutputs } from '~/trpc/react'

/** Part type from the API */
type Part = NonNullable<RouterOutputs['part']['byId']>

/** Props for PartsDrawerOverview component */
interface PartsDrawerOverviewProps {
  partId: string
  part: Part | null | undefined
  isLoading: boolean
}

/** Overview tab content for parts drawer */
export function PartsDrawerOverview({ partId, part, isLoading }: PartsDrawerOverviewProps) {
  const [isInventoryDialogOpen, setIsInventoryDialogOpen] = useState(false)

  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-20 w-full" />
      </div>
    )
  }

  if (!part) {
    return <div className="p-4 text-center text-muted-foreground">Part not found</div>
  }

  return (
    <>
      {/* Part Fields using EntityFields */}
      <EntityFields entityDefinitionId="part" entityInstanceId={part.id} className="m-4" />

      {/* Inventory Section */}
      <Section
        title="Inventory"
        initialOpen
        actions={
          <Button variant="ghost" size="xs" onClick={() => setIsInventoryDialogOpen(true)}>
            {part.inventory ? (
              <>
                <Edit />
                Update
              </>
            ) : (
              <>
                <PlusCircle />
                Add
              </>
            )}
          </Button>
        }>
        {part.inventory ? (
          <dl className="space-y-3">
            <div className="flex items-end justify-between">
              <dt className="text-xs font-medium text-muted-foreground">Current Quantity</dt>
              <dd
                className={`text-xl font-bold ${
                  part.inventory.quantity <= (part.inventory.reorderPoint || 0)
                    ? 'text-red-500'
                    : ''
                }`}>
                {part.inventory.quantity}
              </dd>
            </div>

            <div className="flex flex-col">
              <dt className="text-xs font-medium text-muted-foreground">Location</dt>
              <dd className="text-sm">
                {part.inventory.location || <span className="text-muted-foreground">—</span>}
              </dd>
            </div>

            <div className="flex flex-col">
              <dt className="text-xs font-medium text-muted-foreground">Reorder Point</dt>
              <dd className="text-sm">
                {part.inventory.reorderPoint !== null &&
                part.inventory.reorderPoint !== undefined ? (
                  part.inventory.reorderPoint
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </dd>
            </div>

            <div className="flex flex-col">
              <dt className="text-xs font-medium text-muted-foreground">Reorder Quantity</dt>
              <dd className="text-sm">
                {part.inventory.reorderQty !== null && part.inventory.reorderQty !== undefined ? (
                  part.inventory.reorderQty
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </dd>
            </div>
          </dl>
        ) : (
          <div className="flex h-24 flex-col items-center justify-center text-center border rounded-lg bg-muted/30">
            <Blocks className="mb-2 h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No inventory information</p>
            <p className="text-xs text-muted-foreground">
              Add inventory details to track stock levels
            </p>
          </div>
        )}
      </Section>

      {/* Inventory Dialog */}
      <InventoryDialog
        open={isInventoryDialogOpen}
        onOpenChange={setIsInventoryDialogOpen}
        partId={partId}
        inventory={part.inventory}
      />
    </>
  )
}
