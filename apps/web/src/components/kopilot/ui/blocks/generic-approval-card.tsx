// apps/web/src/components/kopilot/ui/blocks/generic-approval-card.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Check, ShieldAlert, X } from 'lucide-react'
import type { ApprovalCardProps } from './approval-card-registry'

export function GenericApprovalCard({
  toolName,
  args,
  status,
  onApprove,
  onReject,
}: ApprovalCardProps) {
  return (
    <div className='rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30'>
      <div className='flex items-start gap-2'>
        <ShieldAlert className='mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400' />
        <div className='min-w-0 flex-1 space-y-2'>
          <p className='text-sm font-medium text-amber-900 dark:text-amber-200'>
            Approval required
          </p>
          <p className='text-xs text-amber-700 dark:text-amber-300'>
            <span className='font-mono'>{toolName}</span>
            {Object.keys(args).length > 0 && (
              <span className='ml-1 text-amber-600 dark:text-amber-400'>
                — {summarizeArgs(args)}
              </span>
            )}
          </p>

          {status === 'pending' ? (
            <div className='flex items-center gap-2'>
              <Button size='sm' variant='outline' className='h-7' onClick={() => onApprove()}>
                <Check />
                Approve
              </Button>
              <Button size='sm' variant='ghost' className='h-7' onClick={onReject}>
                <X />
                Reject
              </Button>
            </div>
          ) : (
            <Badge variant={status === 'approved' ? 'default' : 'destructive'}>
              {status === 'approved' ? 'Approved' : 'Rejected'}
            </Badge>
          )}
        </div>
      </div>
    </div>
  )
}

function summarizeArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .slice(0, 3)
    .map(([k, v]) => {
      const str = typeof v === 'string' ? v : JSON.stringify(v)
      return `${k}: ${str.length > 60 ? `${str.slice(0, 60)}...` : str}`
    })
    .join(', ')
}
