// apps/web/src/app/admin/organizations/[id]/_components/credit-adjustment-button.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@auxx/ui/components/dialog'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError } from '@auxx/ui/components/toast'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

interface CreditAdjustmentButtonProps {
  organizationId: string
  organizationName: string | null
  currentBalance: number
}

/**
 * Inline admin control for adjusting an organization's bonus credit balance
 * (`PlanSubscription.creditsBalance`). Positive adds, negative deducts —
 * matches the billing-tab adjustment form's semantics so both entry points
 * hit the same `api.admin.billing.applyCreditAdjustment` mutation.
 */
export function CreditAdjustmentButton({
  organizationId,
  organizationName,
  currentBalance,
}: CreditAdjustmentButtonProps) {
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()

  const applyCredit = api.admin.billing.applyCreditAdjustment.useMutation({
    onSuccess: () => {
      utils.admin.getOrganization.invalidate({ id: organizationId })
      setAmount('')
      setReason('')
      setOpen(false)
    },
    onError: (error) =>
      toastError({ title: 'Failed to apply credit adjustment', description: error.message }),
  })

  const parsedAmount = Number.parseInt(amount, 10)
  const amountValid = !Number.isNaN(parsedAmount) && parsedAmount !== 0
  const reasonValid = reason.trim().length >= 10
  const canSubmit = amountValid && reasonValid && !applyCredit.isPending

  const handleApply = async () => {
    if (!canSubmit) return

    const confirmed = await confirm({
      title: 'Apply credit adjustment?',
      description: `This will ${parsedAmount > 0 ? 'add' : 'deduct'} ${Math.abs(parsedAmount)} credits ${parsedAmount > 0 ? 'to' : 'from'} "${organizationName ?? 'this organization'}". Current balance: ${currentBalance}.`,
      confirmText: 'Apply',
      cancelText: 'Cancel',
    })

    if (confirmed) {
      applyCredit.mutate({
        organizationId,
        amount: parsedAmount,
        reason: reason.trim(),
      })
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant='outline' size='sm' className='ml-auto'>
            <Plus />
            Adjust
          </Button>
        </DialogTrigger>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>Adjust credits — {organizationName ?? 'Organization'}</DialogTitle>
            <DialogDescription>
              Current balance: <span className='font-mono'>{currentBalance}</span>. Positive amounts
              add credits, negative amounts deduct.
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-1.5'>
              <Label htmlFor='credit-amount'>Amount</Label>
              <Input
                id='credit-amount'
                type='number'
                step={1}
                placeholder='e.g. 100 or -50'
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={applyCredit.isPending}
              />
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='credit-reason'>Reason</Label>
              <Textarea
                id='credit-reason'
                placeholder='At least 10 characters — shown in the admin audit log.'
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={applyCredit.isPending}
                rows={3}
              />
              {reason.length > 0 && !reasonValid && (
                <p className='text-xs text-destructive'>
                  Reason must be at least 10 characters ({reason.trim().length}/10).
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setOpen(false)}
              disabled={applyCredit.isPending}>
              Cancel
            </Button>
            <Button
              onClick={handleApply}
              disabled={!canSubmit}
              loading={applyCredit.isPending}
              loadingText='Applying...'>
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </>
  )
}
