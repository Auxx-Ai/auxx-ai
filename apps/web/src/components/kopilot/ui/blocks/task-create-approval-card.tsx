// apps/web/src/components/kopilot/ui/blocks/task-create-approval-card.tsx

'use client'

import type { ActorId } from '@auxx/types/actor'
import { cn } from '@auxx/ui/lib/utils'
import { Calendar, Flag, ListTodo, User } from 'lucide-react'
import { ActorBadge } from '~/components/resources/ui/actor-badge'
import { ItemsListView } from '~/components/ui/items-list-view'
import type { ApprovalCardProps } from './approval-card-registry'
import { BlockCard, type BlockCardAction, StatusIndicator } from './block-card'

const PRIORITY_STYLES = {
  high: 'bg-destructive/10 text-destructive',
  medium: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  low: 'bg-muted text-muted-foreground',
} as const

export function TaskCreateApprovalCard({ args, status, onApprove, onReject }: ApprovalCardProps) {
  const title = args.title as string
  const description = args.description as string | undefined
  const deadline = args.deadline as string | undefined
  const priority = args.priority as 'low' | 'medium' | 'high' | undefined
  const assigneeIds = args.assigneeIds as string[] | undefined
  const linkedRecordIds = args.linkedRecordIds as string[] | undefined

  const isPending = status === 'pending'

  const actions: BlockCardAction[] = isPending
    ? [
        { label: 'Deny', onClick: onReject },
        { label: 'Create Task', onClick: () => onApprove(), primary: true },
      ]
    : []

  return (
    <BlockCard
      data-slot='task-create-approval-card'
      indicator={<StatusIndicator status={status} />}
      primaryText='Create Task'
      hasFooter={isPending}
      actionLabel={isPending ? 'Create this task?' : undefined}
      actions={actions}>
      <div className='space-y-2'>
        {/* Title */}
        <div className='flex items-start gap-2'>
          <ListTodo className='mt-0.5 size-3.5 shrink-0 text-muted-foreground' />
          <span className='text-sm font-medium'>{title}</span>
        </div>

        {/* Description */}
        {description && <p className='pl-5.5 text-xs text-muted-foreground'>{description}</p>}

        {/* Metadata row */}
        <div className='flex flex-wrap items-center gap-3 pl-5.5'>
          {/* Priority */}
          {priority && (
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase',
                PRIORITY_STYLES[priority]
              )}>
              {priority}
            </span>
          )}

          {/* Deadline */}
          {deadline && (
            <span className='flex items-center gap-1 text-xs text-muted-foreground'>
              <Calendar className='size-3' />
              {deadline}
            </span>
          )}

          {/* Assignees */}
          {assigneeIds && assigneeIds.length > 0 && (
            <div className='flex items-center gap-1'>
              <User className='size-3 text-muted-foreground' />
              <ItemsListView
                className='w-auto'
                items={assigneeIds}
                renderItem={(id) => <ActorBadge actorId={id as ActorId} />}
                maxDisplay={3}
              />
            </div>
          )}
        </div>

        {/* Linked records count */}
        {linkedRecordIds && linkedRecordIds.length > 0 && (
          <p className='pl-5.5 text-xs text-muted-foreground'>
            {linkedRecordIds.length} linked record{linkedRecordIds.length > 1 ? 's' : ''}
          </p>
        )}
      </div>
    </BlockCard>
  )
}
