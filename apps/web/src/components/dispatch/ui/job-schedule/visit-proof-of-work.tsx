// apps/web/src/components/dispatch/ui/job-schedule/visit-proof-of-work.tsx
//
// The visit-detail panel's proof-of-work block (plan 17 Part A) — the dispatcher's READ-ONLY
// view of what the worker captured on the visit's quality checklist (per-item notes + photos,
// authored on the worker surface's Notes tab). Backed by `dispatch.listVisitQcItems`, which is
// org-scoped and non-materializing: an untouched visit shows the empty state, it never authors
// checklist rows. Reviewing is the dispatcher's role; authoring stays worker-side by design.
//
// Layout mirrors the billing blocks: a `TuckedLabel` header the content tucks into, with
// `EmptySection` covering the loading + empty states.

'use client'

import { EmptySection } from '@auxx/ui/components/section'
import { TREE_SECONDARY_NOTRUNCATE } from '@auxx/ui/components/tree-row'
import { TuckedSection } from '@auxx/ui/components/tucked-label'
import { ClipboardList } from 'lucide-react'
import { QcItemDisplay } from '~/components/schedule/ui/qc/qc-item-display'
import { api } from '~/trpc/react'

interface VisitProofOfWorkProps {
  visitId: string
}

export function VisitProofOfWork({ visitId }: VisitProofOfWorkProps) {
  const { data, isLoading } = api.dispatch.listVisitQcItems.useQuery({ visitId })

  const items = data?.items ?? []

  return (
    // The children (EmptySection / items card) bring their own frame, so the
    // wrapper card is stripped and the EmptySection's radius is bumped to match.
    <TuckedSection
      icon={<ClipboardList />}
      label='Proof of work'
      contentClassName='border-0 bg-transparent p-0 [&_[data-slot=empty-section]]:rounded-xl'>
      {isLoading ? (
        <EmptySection loading title='Loading proof of work' />
      ) : items.length === 0 ? (
        <EmptySection
          icon={<ClipboardList className='size-5' />}
          title='No proof of work captured yet'
          description='Checks, notes and photos the assigned worker captures show up here.'
        />
      ) : (
        <div className={`rounded-xl border bg-primary-50 p-2 ${TREE_SECONDARY_NOTRUNCATE}`}>
          {items.map((item) => (
            <QcItemDisplay key={item.id} item={item} />
          ))}
        </div>
      )}
    </TuckedSection>
  )
}
