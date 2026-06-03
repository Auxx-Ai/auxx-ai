// apps/web/src/components/kb/ui/sources/sources-grid-view.tsx
'use client'

import { useRouter } from 'next/navigation'
import { SourceCard } from './source-card'
import { useSources } from './sources-provider'

/** Card grid for the Sources tab. A source is its own container; KB links live inside. */
export function SourcesGridView() {
  const { items, refetch } = useSources()
  const router = useRouter()

  return (
    <div className='grid gap-4 @md:grid-cols-2 @lg:grid-cols-3 @xl:grid-cols-4 p-3'>
      {items.map((source) => (
        <SourceCard
          key={source.id}
          source={source}
          onClick={() => router.push(`/app/kb/sources/${source.id}`)}
          onActionComplete={refetch}
        />
      ))}
    </div>
  )
}
