// apps/web/src/components/kb/ui/knowledge-bases/knowledge-bases-list.tsx
'use client'

import { ListCard } from '@auxx/ui/components/list-card'
import { Library, Search } from 'lucide-react'
import { useEffect } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { useListSelection } from '~/components/list-selection'
import { CreateKnowledgeBaseButton } from '../landing/create-knowledge-base-button'
import { KnowledgeBaseCard } from './knowledge-base-card'
import { useKnowledgeBasesList } from './knowledge-bases-provider'

export function KnowledgeBasesList() {
  const { knowledgeBases, isLoading, searchQuery } = useKnowledgeBasesList()
  const setItemIds = useListSelection((s) => s.setItemIds)

  useEffect(() => {
    setItemIds(knowledgeBases.map((kb) => kb.id))
  }, [knowledgeBases, setItemIds])

  if (isLoading) {
    return (
      <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
        {[...Array(8)].map((_, i) => (
          <ListCard key={`skeleton-${i}`} loading descriptionLines={2} />
        ))}
      </div>
    )
  }

  if (knowledgeBases.length === 0) {
    return searchQuery ? (
      <EmptyState
        icon={Search}
        title='No knowledge bases found'
        description='No knowledge bases match your search. Try a different term.'
        button={<div className='h-12' />}
      />
    ) : (
      <EmptyState
        icon={Library}
        title='No knowledge bases yet'
        description='Create your first knowledge base to start publishing articles.'
        button={<CreateKnowledgeBaseButton />}
      />
    )
  }

  return (
    <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
      {knowledgeBases.map((kb) => (
        <KnowledgeBaseCard key={kb.id} knowledgeBase={kb} />
      ))}
    </div>
  )
}
