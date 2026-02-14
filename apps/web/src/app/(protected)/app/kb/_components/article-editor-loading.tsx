// src/app/(protected)/app/kb/_components/article-editor-loading.tsx
'use client'

import { Skeleton } from '@auxx/ui/components/skeleton'
import type React from 'react'

const ArticleEditorLoading: React.FC = () => {
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

      {/* Editor toolbar */}
      <Skeleton className='mb-6 h-10 w-full' />

      {/* Editor content */}
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

export default ArticleEditorLoading
