// apps/web/src/components/kb/ui/editor/kb-editor-frame.tsx
'use client'

import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { Skeleton } from '@auxx/ui/components/skeleton'
import type React from 'react'
import { useKnowledgeBase } from '../../hooks/use-knowledge-base'
import { KBSidebar } from '../sidebar/kb-sidebar'

interface KBEditorFrameProps {
  knowledgeBaseId: string
  children: React.ReactNode
}

/**
 * Persistent chrome for the KB editor: header, sidebar, and the content
 * frame. Lives in the route segment layout so slug-level navigations don't
 * remount the sidebar (which would lose its scroll position).
 */
export function KBEditorFrame({ knowledgeBaseId, children }: KBEditorFrameProps) {
  const { knowledgeBase, isLoading } = useKnowledgeBase(knowledgeBaseId)

  if (isLoading || !knowledgeBase) {
    return (
      <div className='p-8'>
        <Skeleton className='h-8 w-64' />
        <Skeleton className='mt-4 h-4 w-full' />
        <Skeleton className='mt-2 h-4 w-full' />
      </div>
    )
  }

  return (
    <MainPage>
      <MainPageHeader>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem
            title='Knowledge base '
            href={`/app/kb/${knowledgeBaseId}/editor/general`}
            last
          />
        </MainPageBreadcrumb>
      </MainPageHeader>
      <MainPageContent>
        <div className='flex flex-row w-full h-full'>
          <KBSidebar knowledgeBaseId={knowledgeBaseId} knowledgeBase={knowledgeBase} />
          <div className='flex min-h-0 max-lg:shrink-0 lg:flex-1'>{children}</div>
        </div>
      </MainPageContent>
    </MainPage>
  )
}
