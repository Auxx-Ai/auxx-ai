// apps/web/src/components/subscriptions/limit-reached-dialog.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Dialog, DialogContent, DialogTitle } from '@auxx/ui/components/dialog'
import { Sparkles } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { PlanChangeSummary } from './plan-change-summary'

interface LimitReachedDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Icon to display */
  icon?: React.ElementType
  /** e.g. "Workflow Limit Reached" */
  title: string
  /** e.g. "You've reached the maximum of 5 workflows on your current plan." */
  description: string
}

export function LimitReachedDialog({
  open,
  onOpenChange,
  icon,
  title,
  description,
}: LimitReachedDialogProps) {
  const [upgradeOpen, setUpgradeOpen] = useState(false)

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className='max-w-sm' position='tc'>
          <DialogTitle className='sr-only'>{title}</DialogTitle>
          <EmptyState
            icon={icon}
            title={title}
            description={description}
            button={
              <Button
                onClick={() => {
                  onOpenChange(false)
                  setUpgradeOpen(true)
                }}>
                <Sparkles />
                Upgrade Plan
              </Button>
            }
          />
        </DialogContent>
      </Dialog>

      <PlanChangeSummary open={upgradeOpen} onOpenChange={setUpgradeOpen} />
    </>
  )
}
