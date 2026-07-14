// apps/web/src/components/sequences/ui/list/sequences-list.tsx
'use client'

import { ListCard } from '@auxx/ui/components/list-card'
import { ListPageScroll } from '@auxx/ui/components/list-page-scroll'
import { toastError } from '@auxx/ui/components/toast'
import { useMemo, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { api } from '~/trpc/react'
import { CreateSequenceButton } from './create-sequence-button'
import { SequenceCard, SequenceFallbackIcon } from './sequence-card'
import { SequencesToolbar } from './sequences-toolbar'

/**
 * Sequences tab body for `/app/workflows` — a card grid (status + last-updated
 * + Open/Delete menu) with client-side name search. No bulk-select for v1:
 * there's no bulk action beyond per-card delete yet, so `ListSelectionProvider`
 * would be pure overhead — see plan §Phase 3 note in the workflows-page diff.
 */
export function SequencesList() {
  const [search, setSearch] = useState('')
  const utils = api.useUtils()
  const sequences = api.sequence.list.useQuery()

  const deleteSequence = api.sequence.delete.useMutation({
    onSuccess: () => void utils.sequence.list.invalidate(),
    onError: (error) => {
      toastError({ title: 'Failed to delete sequence', description: error.message })
    },
  })

  const rows = sequences.data ?? []
  const query = search.trim().toLowerCase()
  const filtered = useMemo(
    () => (query ? rows.filter((s) => s.name.toLowerCase().includes(query)) : rows),
    [rows, query]
  )

  return (
    <ListPageScroll
      toolbar={<SequencesToolbar search={search} onSearchChange={setSearch} />}
      bodyClassName='flex-1 flex flex-col min-h-0'>
      <div className='flex flex-1 flex-col gap-4'>
        {sequences.isLoading ? (
          <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'>
            {[0, 1, 2].map((i) => (
              <ListCard key={i} loading descriptionLines={0} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={SequenceFallbackIcon}
            title='No sequences yet'
            description='Create an outbound email cadence and enroll contacts.'
            button={<CreateSequenceButton />}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={SequenceFallbackIcon}
            title='No matching sequences'
            description={`No sequences match “${search.trim()}”.`}
          />
        ) : (
          <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'>
            {filtered.map((sequence) => (
              <SequenceCard
                key={sequence.id}
                sequence={sequence}
                onDelete={(id) => deleteSequence.mutate({ id })}
              />
            ))}
          </div>
        )}
      </div>
    </ListPageScroll>
  )
}
