// apps/web/src/components/kopilot/ui/messages/approval-message.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Check, ShieldAlert, X } from 'lucide-react'
import type { KopilotMessage } from '../../stores/kopilot-store'

interface ApprovalMessageProps {
  message: KopilotMessage
  onApprove: () => void
  onReject: () => void
}

export function ApprovalMessage({ message, onApprove, onReject }: ApprovalMessageProps) {
  const tool = message.tool
  const status = message.approvalStatus

  return (
    <div className='rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30'>
      <div className='flex items-start gap-2'>
        <ShieldAlert className='mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400' />
        <div className='min-w-0 flex-1 space-y-2'>
          <p className='text-sm font-medium text-amber-900 dark:text-amber-200'>
            Approval required
          </p>
          {tool && (
            <p className='text-xs text-amber-700 dark:text-amber-300'>
              <span className='font-mono'>{tool.name}</span>
              {Object.keys(tool.args).length > 0 && (
                <span className='ml-1 text-amber-600 dark:text-amber-400'>
                  — {summarizeArgs(tool.args)}
                </span>
              )}
            </p>
          )}

          {status === 'pending' ? (
            <div className='flex items-center gap-2'>
              <Button size='sm' variant='outline' className='h-7' onClick={onApprove}>
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
              {status === 'approved' ? 'Approved ✓' : 'Rejected ✗'}
            </Badge>
          )}
        </div>
      </div>
    </div>
  )
}

/** Show a one-line summary of tool args */
function summarizeArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args)
  if (entries.length === 0) return ''
  return entries
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(', ')
}
