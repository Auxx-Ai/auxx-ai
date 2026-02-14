// apps/web/src/components/ai/ui/quota-exceeded-dialog.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Progress } from '@auxx/ui/components/progress'
import { formatDate } from '@auxx/utils/date'
import { AlertTriangle, Calendar, CreditCard, Key } from 'lucide-react'

interface QuotaInfo {
  /** Current usage amount */
  used: number
  /** Maximum quota limit */
  limit: number
  /** Quota type (trial, free, paid) */
  type: string
  /** When the quota period resets */
  periodEnd: Date | null
}

interface QuotaExceededDialogProps {
  /** Whether the dialog is open */
  open: boolean
  /** Callback to close the dialog */
  onOpenChange: (open: boolean) => void
  /** Provider name (e.g., 'OpenAI', 'Anthropic') */
  provider: string
  /** Quota information */
  quotaInfo: QuotaInfo
  /** Whether the user has configured custom credentials */
  hasCustomCredentials: boolean
  /** Callback when user chooses to switch to custom credentials */
  onSwitchToCustom?: () => void
  /** Callback when user chooses to upgrade */
  onUpgrade?: () => void
}

/**
 * QuotaExceededDialog - Dialog shown when user hits their AI usage quota limit
 *
 * Offers options to:
 * - Switch to custom API key (if available)
 * - Upgrade to a higher plan
 * - Wait for quota reset
 */
export function QuotaExceededDialog({
  open,
  onOpenChange,
  provider,
  quotaInfo,
  hasCustomCredentials,
  onSwitchToCustom,
  onUpgrade,
}: QuotaExceededDialogProps) {
  const usagePercent = Math.round((quotaInfo.used / quotaInfo.limit) * 100)
  const resetDateStr = quotaInfo.periodEnd ? formatDate(quotaInfo.periodEnd, 'MMM d, yyyy') : 'soon'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <div className='flex items-center gap-2'>
            <div className='p-2 rounded-full bg-destructive/10'>
              <AlertTriangle className='h-5 w-5 text-destructive' />
            </div>
            <DialogTitle>Usage Limit Reached</DialogTitle>
          </div>
          <DialogDescription className='pt-2'>
            You&apos;ve used all your AI credits for {provider} this period.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4 py-4'>
          {/* Usage progress */}
          <div className='space-y-2'>
            <div className='flex justify-between text-sm'>
              <span className='text-muted-foreground'>Credits used</span>
              <span className='font-medium'>
                {quotaInfo.used.toLocaleString()} / {quotaInfo.limit.toLocaleString()}
              </span>
            </div>
            <Progress value={usagePercent} className='h-2' />
          </div>

          {/* Reset date */}
          <div className='flex items-center gap-2 text-sm text-muted-foreground'>
            <Calendar className='h-4 w-4' />
            <span>Quota resets on {resetDateStr}</span>
          </div>

          {/* Options */}
          <div className='space-y-2 pt-2'>
            <p className='text-sm font-medium'>What would you like to do?</p>

            {hasCustomCredentials && (
              <Button
                variant='outline'
                className='w-full justify-start'
                onClick={() => {
                  onSwitchToCustom?.()
                  onOpenChange(false)
                }}>
                <Key className='mr-2 h-4 w-4' />
                Switch to your own API key
              </Button>
            )}

            <Button
              variant='default'
              className='w-full justify-start'
              onClick={() => {
                onUpgrade?.()
                onOpenChange(false)
              }}>
              <CreditCard className='mr-2 h-4 w-4' />
              Upgrade for more credits
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant='ghost' onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default QuotaExceededDialog
