// apps/web/src/components/schedule/ui/qc/qc-checklist.tsx
//
// The Notes tab's quality checklist (08-worker-surface.md §5) — the worker's per-visit checklist,
// lazily materialized server-side from the org's active `QcItemTemplate` rows on first read.
// Every row is a `QcItemRow` (`TreeRow`, user-locked decision); an inline "Add a check…" row at
// the bottom appends a worker-authored ad-hoc item with no source template.

'use client'

import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { toastError } from '@auxx/ui/components/toast'
import { TREE_SECONDARY_NOTRUNCATE } from '@auxx/ui/components/tree-row'
import { ClipboardList, Plus } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { LoadingSpinner } from '~/components/global/loading-content'
import { api } from '~/trpc/react'
import { QcItemRow } from './qc-item-row'

interface QcChecklistProps {
  visitId: string
}

export function QcChecklist({ visitId }: QcChecklistProps) {
  const [draftTitle, setDraftTitle] = useState('')
  const utils = api.useUtils()

  const { data, isLoading } = api.dispatch.listMyVisitQcItems.useQuery({ visitId })

  const addItem = api.dispatch.addMyAdhocQcItem.useMutation({
    onSuccess: () => utils.dispatch.listMyVisitQcItems.invalidate({ visitId }),
    onError: (error) => toastError({ title: 'Error adding check', description: error.message }),
  })

  const handleAdd = () => {
    const title = draftTitle.trim()
    if (!title) return
    addItem.mutate({ visitId, title })
    setDraftTitle('')
  }

  if (isLoading) return <LoadingSpinner />

  const items = data?.items ?? []

  return (
    <div className='flex flex-col gap-1 p-3'>
      {items.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title='No checks for this visit'
          description='Add one below to get started.'
        />
      ) : (
        <div className={TREE_SECONDARY_NOTRUNCATE}>
          {items.map((item) => (
            <QcItemRow key={item.id} visitId={visitId} item={item} />
          ))}
        </div>
      )}

      <div className='flex items-center gap-2 pt-2'>
        <Input
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleAdd()
            }
          }}
          placeholder='Add a check…'
          className='flex-1'
        />
        <Button
          type='button'
          variant='outline'
          size='icon'
          disabled={!draftTitle.trim() || addItem.isPending}
          onClick={handleAdd}
          aria-label='Add check'>
          <Plus />
        </Button>
      </div>
    </div>
  )
}
