// app/(protected)/app/settings/plans/_components/plan-comparison-dialog.tsx
'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { useState } from 'react'
import { PlanComparison } from './plan-comparison'

/** Props for PlanComparisonDialog component */
interface PlanComparisonDialogProps {
  /** Controls whether the dialog is open */
  open: boolean
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void
}

/**
 * Dialog wrapper for the plan comparison component
 * Shows all available plans in a modal dialogd
 */
export function PlanComparisonDialog({ open, onOpenChange }: PlanComparisonDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='xxl' className='max-h-screen overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>Choose Your Plan</DialogTitle>
          <DialogDescription>
            Select the plan that best fits your needs. You can upgrade or downgrade at any time.
          </DialogDescription>
        </DialogHeader>
        <PlanComparison inDialog />
      </DialogContent>
    </Dialog>
  )
}
