// apps/web/src/components/manufacturing/parts/inventory-dialog.tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import { AlertTriangle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { useDialogSubmit } from '@auxx/ui/hooks'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Button } from '@auxx/ui/components/button'
import { Separator } from '@auxx/ui/components/separator'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { ConstantInputAdapter } from '~/components/workflow/ui/input-editor/constant-input-adapter'
import { BaseType } from '~/components/workflow/types'
import { api } from '~/trpc/react'
import { toastError } from '@auxx/ui/components/toast'
import type { InventoryEntity as Inventory } from '@auxx/database/models'

/** Props for InventoryDialog component */
interface InventoryDialogProps {
  /** Whether the dialog is open */
  open: boolean
  /** Callback when open state changes */
  onOpenChange: (open: boolean) => void
  /** Part ID */
  partId: string
  /** Inventory to edit (null for create mode) */
  inventory?: Inventory | null
  /** Callback on successful save */
  onSuccess?: () => void
}

/** Dialog for creating/editing inventory */
export function InventoryDialog({
  open,
  onOpenChange,
  partId,
  inventory,
  onSuccess,
}: InventoryDialogProps) {
  const utils = api.useUtils()
  const isEditMode = !!inventory

  // State
  const [values, setValues] = useState({
    quantity: 0,
    location: '',
    reorderPoint: null as number | null,
    reorderQty: null as number | null,
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Low stock warning
  const showLowStockWarning =
    values.reorderPoint !== null &&
    values.reorderPoint !== undefined &&
    values.quantity <= values.reorderPoint

  // Initialize/reset values when dialog opens
  useEffect(() => {
    if (open) {
      setValues({
        quantity: inventory?.quantity ?? 0,
        location: inventory?.location ?? '',
        reorderPoint: inventory?.reorderPoint ?? null,
        reorderQty: inventory?.reorderQty ?? null,
      })
      setErrors({})
    }
  }, [open, inventory])

  // Field change handler
  const handleChange = useCallback((field: string, value: any) => {
    setValues((prev) => ({ ...prev, [field]: value }))
    // Clear error when user edits
    setErrors((prev) => {
      if (prev[field]) {
        const next = { ...prev }
        delete next[field]
        return next
      }
      return prev
    })
  }, [])

  // Validation
  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}
    if (values.quantity < 0) newErrors.quantity = 'Quantity cannot be negative'
    if (values.reorderPoint !== null && values.reorderPoint < 0) {
      newErrors.reorderPoint = 'Reorder point cannot be negative'
    }
    if (values.reorderQty !== null && values.reorderQty < 1) {
      newErrors.reorderQty = 'Reorder quantity must be at least 1'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // Mutations
  const createInventory = api.inventory.create.useMutation({
    onSuccess: () => {
      utils.part.byId.invalidate({ id: partId })
      utils.part.all.invalidate()
      onSuccess?.()
      onOpenChange(false)
    },
    onError: (error) => {
      toastError({ title: 'Failed to create inventory', description: error.message })
    },
  })

  const updateInventory = api.inventory.update.useMutation({
    onSuccess: () => {
      utils.part.byId.invalidate({ id: partId })
      utils.part.all.invalidate()
      onSuccess?.()
      onOpenChange(false)
    },
    onError: (error) => {
      toastError({ title: 'Failed to update inventory', description: error.message })
    },
  })

  const isPending = createInventory.isPending || updateInventory.isPending

  // Submit
  const handleSubmit = async () => {
    if (!validate()) return

    const payload = {
      partId,
      quantity: values.quantity,
      location: values.location || null,
      reorderPoint: values.reorderPoint,
      reorderQty: values.reorderQty,
    }

    if (isEditMode) {
      await updateInventory.mutateAsync(payload)
    } else {
      await createInventory.mutateAsync(payload)
    }
  }

  // Register Meta+Enter submit handler
  useDialogSubmit({ onSubmit: handleSubmit, disabled: isPending })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]" position="tc">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Edit Inventory' : 'Add Inventory'}</DialogTitle>
          <DialogDescription>
            {isEditMode
              ? 'Update the inventory configuration for this part'
              : 'Set up inventory tracking for this part'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <VarEditorField className="p-0">
            {/* Current Quantity */}
            <VarEditorFieldRow
              title="Current Quantity"
              description="The current number of units in stock"
              type={BaseType.NUMBER}
              showIcon
              isRequired
              validationError={errors.quantity}
              validationType="error">
              <ConstantInputAdapter
                value={values.quantity}
                onChange={(_, val) => handleChange('quantity', val ?? 0)}
                varType={BaseType.NUMBER}
                placeholder="0"
                disabled={isPending}
              />
            </VarEditorFieldRow>

            {/* Storage Location */}
            <VarEditorFieldRow
              title="Storage Location"
              description="Where this part is physically stored"
              type={BaseType.STRING}
              showIcon>
              <ConstantInputAdapter
                value={values.location}
                onChange={(_, val) => handleChange('location', val ?? '')}
                varType={BaseType.STRING}
                placeholder="e.g., Warehouse A, Shelf B3"
                disabled={isPending}
              />
            </VarEditorFieldRow>
          </VarEditorField>

          <Separator />

          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-medium">Reordering Settings</h3>
            <p className="text-xs text-muted-foreground">Configure when and how much to reorder</p>
          </div>

          <VarEditorField className="p-0">
            {/* Reorder Point */}
            <VarEditorFieldRow
              title="Reorder Point"
              description="Minimum stock level"
              type={BaseType.NUMBER}
              showIcon
              validationError={errors.reorderPoint}
              validationType="error">
              <ConstantInputAdapter
                value={values.reorderPoint}
                onChange={(_, val) => handleChange('reorderPoint', val)}
                varType={BaseType.NUMBER}
                placeholder="Optional"
                disabled={isPending}
              />
            </VarEditorFieldRow>

            {/* Reorder Quantity */}
            <VarEditorFieldRow
              title="Reorder Quantity"
              description="Units to order"
              type={BaseType.NUMBER}
              showIcon
              validationError={errors.reorderQty}
              validationType="error">
              <ConstantInputAdapter
                value={values.reorderQty}
                onChange={(_, val) => handleChange('reorderQty', val)}
                varType={BaseType.NUMBER}
                placeholder="Optional"
                disabled={isPending}
              />
            </VarEditorFieldRow>
          </VarEditorField>

          {/* Low stock warning */}
          {showLowStockWarning && (
            <Alert variant="warning">
              <AlertTriangle />
              <AlertTitle>Low Stock Alert</AlertTitle>
              <AlertDescription>
                Current quantity ({values.quantity}) is at or below the reorder point (
                {values.reorderPoint}). You may want to restock this item.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isPending}>
            Cancel <Kbd shortcut="esc" variant="ghost" size="sm" />
          </Button>
          <Button
            onClick={handleSubmit}
            size="sm"
            variant="outline"
            loading={isPending}
            loadingText={isEditMode ? 'Updating...' : 'Creating...'}>
            {isEditMode ? 'Update Inventory' : 'Create Inventory'} <KbdSubmit variant="outline" size="sm" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
