// apps/web/src/components/dispatch/ui/setup-wizard/wizard-workers-page.tsx
'use client'

import { type ActorId, parseActorId, toActorId } from '@auxx/types/actor'
import { toastError } from '@auxx/ui/components/toast'
import { useState } from 'react'
import { ActorPickerContent } from '~/components/pickers/actor-picker/actor-picker-content'
import { ORG_STATIC_STALE_TIME } from '~/trpc/query-client'
import { api } from '~/trpc/react'
import { WorkerCard } from '../worker-card'

/**
 * Page 2 of `DispatchSetupWizard` — the same member picker + upsert mutation as
 * `WorkerDialog`'s create-mode member page, rendered inline as a wizard page instead of a
 * nested dialog, plus a read-only grid of already-added workers. Each pick immediately upserts a `DispatchWorker`
 * row — there's no page-local draft, so leaving the page (forward or back) never loses anything.
 */
export function WizardWorkersPage() {
  const utils = api.useUtils()
  const [selected, setSelected] = useState<ActorId[]>([])

  const { data: workers, isLoading } = api.dispatch.listWorkers.useQuery(undefined, {
    staleTime: ORG_STATIC_STALE_TIME,
  })

  const upsertWorker = api.dispatch.upsertWorker.useMutation({
    onSuccess: () => {
      utils.dispatch.listWorkers.invalidate()
      setSelected([])
    },
    onError: (error) => toastError({ title: 'Error adding worker', description: error.message }),
  })

  // Team rows carry no `userId` — only individuals map onto a user actor id.
  const excludeIds = (workers ?? []).flatMap((worker) =>
    worker.userId ? [toActorId('user', worker.userId)] : []
  )

  return (
    <div className='flex flex-col gap-4 p-4'>
      <p className='text-muted-foreground text-sm'>
        Add the people who&apos;ll be scheduled on the board.
      </p>

      {!isLoading && (workers?.length ?? 0) > 0 && (
        <div className='@container'>
          <div className='grid gap-2 @md:grid-cols-2'>
            {(workers ?? []).map((worker) => (
              <WorkerCard key={worker.id} worker={worker} />
            ))}
          </div>
        </div>
      )}

      <div className='overflow-hidden rounded-xl border'>
        <ActorPickerContent
          value={selected}
          onChange={setSelected}
          target='user'
          multi={false}
          excludeIds={excludeIds}
          placeholder='Search members to add...'
          disabled={upsertWorker.isPending}
          onSelectSingle={(actorId) => {
            const { id: userId } = parseActorId(actorId)
            upsertWorker.mutate({ userId })
          }}
        />
      </div>
    </div>
  )
}
