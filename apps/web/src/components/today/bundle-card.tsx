// apps/web/src/components/today/bundle-card.tsx

'use client'

import type { ProposedAction, StoredBundle } from '@auxx/lib/approvals'
import { Button } from '@auxx/ui/components/button'
import { Card } from '@auxx/ui/components/card'
import { toastError } from '@auxx/ui/components/toast'
import { api } from '~/trpc/react'

export interface BundleCardData {
  id: string
  entityInstanceId: string
  entityDefinitionId: string
  actionCount: number
  bundle: StoredBundle
  computedForActivityAt: Date | string
  status: string
}

/**
 * Bundle card. Shows the AI's proposed-action summary and a Yes/No pair. Per-
 * action expansion is read-only — v1 doesn't support inline edits or partial
 * approval (Choose mode deferred per Phase 3e v3 cuts).
 */
export function BundleCard({ bundle }: { bundle: BundleCardData }) {
  const utils = api.useUtils()
  const approve = api.approvals.approve.useMutation({
    onSuccess: () => {
      utils.approvals.list.invalidate()
      utils.approvals.listPending.invalidate()
    },
    onError: (error) => {
      toastError({
        title: error.data?.code === 'CONFLICT' ? 'Out of date' : 'Approve failed',
        description: error.message,
      })
      utils.approvals.list.invalidate()
    },
  })
  const reject = api.approvals.reject.useMutation({
    onSuccess: () => {
      utils.approvals.list.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Reject failed', description: error.message })
    },
  })

  const summary =
    bundle.bundle.summary ?? `${bundle.actionCount} action${bundle.actionCount === 1 ? '' : 's'}`
  const actions = bundle.bundle.actions ?? []
  const pending = approve.isPending || reject.isPending

  return (
    <Card className='p-4 flex flex-col gap-3'>
      <div className='flex items-start justify-between gap-4'>
        <div className='flex-1 min-w-0'>
          <div className='text-sm text-muted-foreground'>
            Suggestion · {actions.length} action{actions.length === 1 ? '' : 's'}
          </div>
          <div className='text-base font-medium mt-1'>{summary}</div>
        </div>
        <div className='flex gap-2 shrink-0'>
          <Button
            variant='outline'
            size='sm'
            disabled={pending}
            loading={reject.isPending}
            onClick={() => reject.mutate({ bundleId: bundle.id })}>
            No
          </Button>
          <Button
            size='sm'
            disabled={pending}
            loading={approve.isPending}
            onClick={() => approve.mutate({ bundleId: bundle.id })}>
            Yes
          </Button>
        </div>
      </div>
      {actions.length > 0 && (
        <details className='text-sm'>
          <summary className='cursor-pointer text-muted-foreground hover:text-foreground'>
            View actions
          </summary>
          <ul className='mt-2 space-y-1 pl-4 list-disc'>
            {actions.map((a) => (
              <ActionRow key={a.localIndex} action={a} />
            ))}
          </ul>
        </details>
      )}
    </Card>
  )
}

function ActionRow({ action }: { action: ProposedAction }) {
  return (
    <li className='text-foreground'>
      <span className='font-mono text-xs text-muted-foreground mr-2'>{action.toolName}</span>
      <span>{action.summary}</span>
    </li>
  )
}
