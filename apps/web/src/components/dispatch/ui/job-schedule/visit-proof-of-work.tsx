// apps/web/src/components/dispatch/ui/job-schedule/visit-proof-of-work.tsx
//
// The visit-detail panel's proof-of-work block (plan 17 Part A) — the dispatcher's view of what
// the worker captured on the visit's quality checklist. Checks and per-item notes stay READ-ONLY
// (worker attestations); PHOTOS are editable here (37d §4 office capture) via the org-scoped
// `*Visit*` mutations, so a dispatcher can add/caption/remove proof-of-work photos. Backed by
// `dispatch.listVisitQcItems`, which is org-scoped and non-materializing: an untouched visit
// shows the empty state (no checklist rows to attach photos to yet — v1 hangs photos off items).
//
// Layout mirrors the billing blocks: a `TuckedLabel` header the content tucks into, with
// `EmptySection` covering the loading + empty states.

'use client'

import { EmptySection } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import { TREE_SECONDARY_NOTRUNCATE } from '@auxx/ui/components/tree-row'
import { TuckedSection } from '@auxx/ui/components/tucked-label'
import { ClipboardList } from 'lucide-react'
import { QcItemDisplay, type QcItemPhotoEditing } from '~/components/schedule/ui/qc/qc-item-display'
import { api } from '~/trpc/react'

interface VisitProofOfWorkProps {
  visitId: string
}

export function VisitProofOfWork({ visitId }: VisitProofOfWorkProps) {
  const utils = api.useUtils()
  const { data, isLoading } = api.dispatch.listVisitQcItems.useQuery({ visitId })

  const invalidate = () => utils.dispatch.listVisitQcItems.invalidate({ visitId })
  const addPhoto = api.dispatch.addVisitQcItemPhoto.useMutation({
    onSuccess: invalidate,
    onError: (error) => toastError({ title: 'Error attaching photo', description: error.message }),
  })
  const removePhoto = api.dispatch.removeVisitQcItemPhoto.useMutation({
    onSuccess: invalidate,
    onError: (error) => toastError({ title: 'Error removing photo', description: error.message }),
  })
  const setCaption = api.dispatch.setVisitQcItemPhotoCaption.useMutation({
    onSuccess: invalidate,
    onError: (error) => toastError({ title: 'Error saving caption', description: error.message }),
  })

  const photoEditing: QcItemPhotoEditing = {
    onAddPhoto: (itemId, assetId) => addPhoto.mutate({ itemId, assetId }),
    onRemovePhoto: (itemId, attachmentId) => removePhoto.mutate({ itemId, attachmentId }),
    onSetCaption: (itemId, attachmentId, caption) =>
      setCaption.mutate({ itemId, attachmentId, caption }),
  }

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
            <QcItemDisplay key={item.id} item={item} photoEditing={photoEditing} />
          ))}
        </div>
      )}
    </TuckedSection>
  )
}
