// apps/web/src/components/kb/ui/editor/article-editor-loading.tsx
'use client'

import { Skeleton } from '@auxx/ui/components/skeleton'

export function ArticleEditorLoading() {
  return (
    <div className='h-full w-full p-6 animate-in fade-in'>
      <div className='mb-6 flex items-center justify-between'>
        <Skeleton className='h-8 w-1/3' />
        <Skeleton className='h-10 w-32' />
      </div>

      <div className='mb-8 space-y-2'>
        <Skeleton className='h-6 w-1/4' />
        <Skeleton className='h-5 w-1/3' />
      </div>

      <Skeleton className='mb-6 h-10 w-full' />

      <div className='space-y-4'>
        <Skeleton className='h-6 w-full' />
        <Skeleton className='h-6 w-4/5' />
        <Skeleton className='h-6 w-5/6' />
        <Skeleton className='h-6 w-2/3' />
        <Skeleton className='h-6 w-3/4' />
        <Skeleton className='h-6 w-4/5' />
      </div>
    </div>
  )
}
