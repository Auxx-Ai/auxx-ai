// apps/web/src/components/sequences/ui/detail/sequence-recipients.tsx
'use client'

import type { SequenceRunStatus } from '@auxx/lib/sequences/client'
import { Badge, type Variant } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { LastUpdated } from '@auxx/ui/components/last-updated'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { UserRound, UserRoundPlus, UserRoundX } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { useConfirm } from '~/hooks/use-confirm'
import { api, type RouterOutputs } from '~/trpc/react'
import { SequenceEnrollDialog } from './sequence-enroll-dialog'

type SequenceRun = RouterOutputs['sequence']['listRuns'][number]

const STATUS_META: Record<SequenceRunStatus, { label: string; variant: Variant }> = {
  active: { label: 'Active', variant: 'blue' },
  completed: { label: 'Completed', variant: 'green' },
  exited: { label: 'Exited', variant: 'gray' },
  failed: { label: 'Failed', variant: 'red' },
}

const EXIT_REASON_LABEL: Record<string, string> = {
  reply: 'Replied',
  bounce: 'Bounced',
  unsubscribe: 'Unsubscribed',
  manual: 'Removed manually',
}

const STATUS_FILTERS = ['all', 'active', 'completed', 'exited', 'failed'] as const

interface SequenceRecipientsProps {
  sequenceId: string
  /** Total step count — powers the "Step 2/4" progress readout. */
  totalSteps: number
}

/**
 * The Recipients tab: status filter + "Enroll contacts", then the run list —
 * one TreeRow per enrollment with the recipient's name/email, status badge,
 * exit reason, step progress, enrolled-at, and a manual-exit action for
 * active runs.
 */
export function SequenceRecipients({ sequenceId, totalSteps }: SequenceRecipientsProps) {
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('all')
  const [enrollOpen, setEnrollOpen] = useState(false)
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()

  const runs = api.sequence.listRuns.useQuery({
    sequenceId,
    status: statusFilter === 'all' ? undefined : statusFilter,
  })

  const exitRun = api.sequence.exitRun.useMutation({
    onSuccess: () => {
      utils.sequence.listRuns.invalidate({ sequenceId })
      utils.sequence.stats.invalidate({ sequenceId })
    },
    onError: (error) =>
      toastError({ title: 'Failed to remove recipient', description: error.message }),
  })

  const handleExit = async (run: SequenceRun) => {
    const confirmed = await confirm({
      title: 'Remove from sequence?',
      description: `${run.recipientDisplayName ?? run.recipientEmail} will stop receiving emails from this sequence.`,
      confirmText: 'Remove',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) exitRun.mutate({ sequenceRunId: run.id })
  }

  const rows = runs.data ?? []

  return (
    <div className='mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4'>
      <ConfirmDialog />

      {/* Toolbar */}
      <div className='flex items-center gap-2'>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as (typeof STATUS_FILTERS)[number])}>
          <SelectTrigger className='h-8 w-36'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>All</SelectItem>
            <SelectItem value='active'>Active</SelectItem>
            <SelectItem value='completed'>Completed</SelectItem>
            <SelectItem value='exited'>Exited</SelectItem>
            <SelectItem value='failed'>Failed</SelectItem>
          </SelectContent>
        </Select>
        <Button variant='outline' size='sm' className='ml-auto' onClick={() => setEnrollOpen(true)}>
          <UserRoundPlus />
          Enroll contacts
        </Button>
      </div>

      {/* Runs */}
      {!runs.isLoading && rows.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title={statusFilter === 'all' ? 'No recipients yet' : 'No matching recipients'}
          description={
            statusFilter === 'all'
              ? 'Enroll contacts to start sending this sequence.'
              : 'No enrollments have this status.'
          }
          button={statusFilter === 'all' ? undefined : <div className='h-12' />}
        />
      ) : (
        <TreeRowList
          items={rows}
          getKey={(run) => run.id}
          loading={runs.isLoading}
          renderRow={(run) => {
            const meta = STATUS_META[run.status as SequenceRunStatus] ?? STATUS_META.active
            const stepProgress = `Step ${Math.min(run.lastCompletedStep, totalSteps)}/${totalSteps}`
            const exitReason = run.exitReason ? EXIT_REASON_LABEL[run.exitReason] : null
            return (
              <TreeRow
                icon={<UserRound className='size-4 text-muted-foreground' />}
                title={
                  <span className='truncate text-sm'>
                    {run.recipientDisplayName ?? run.recipientEmail}
                  </span>
                }
                description={run.recipientEmail}
                secondary={
                  <span className='flex items-center gap-2 whitespace-nowrap'>
                    <Badge variant={meta.variant} size='sm'>
                      {meta.label}
                    </Badge>
                    {exitReason && (
                      <span className='text-xs text-muted-foreground'>{exitReason}</span>
                    )}
                    <span className='text-xs text-muted-foreground'>{stepProgress}</span>
                    <span className='text-xs text-muted-foreground'>
                      <LastUpdated timestamp={run.enrolledAt} />
                    </span>
                  </span>
                }
                rowClassName='hover:bg-primary-100'
                actions={
                  run.status === 'active' ? (
                    <TreeRowButton
                      variant='destructive'
                      tooltipText='Remove from sequence'
                      onClick={() => void handleExit(run)}>
                      <UserRoundX />
                    </TreeRowButton>
                  ) : undefined
                }
              />
            )
          }}
        />
      )}

      <SequenceEnrollDialog
        sequenceId={sequenceId}
        open={enrollOpen}
        onOpenChange={setEnrollOpen}
      />
    </div>
  )
}
