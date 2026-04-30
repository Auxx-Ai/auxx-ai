// apps/web/src/components/kb/ui/editor/kb-editor-frame.tsx
'use client'

import { MainPage, MainPageContent } from '@auxx/ui/components/main-page'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import type React from 'react'
import { useMemo } from 'react'
import { LoadingSpinner } from '~/components/global/loading-content'
import { useKnowledgeBase } from '../../hooks/use-knowledge-base'
import { KBEditorHeader } from './kb-editor-header'
import { KBTabPanel } from './kb-tab-panel'

const PANEL_VALUES = ['general', 'layout', 'articles'] as const

interface KBEditorFrameProps {
  knowledgeBaseId: string
  children: React.ReactNode
}

/**
 * Persistent chrome for the KB editor: header + small left panel + main
 * content frame. Lives in the route segment layout so slug-level navigations
 * don't remount the panel (which would lose its scroll position / form state).
 */
export function KBEditorFrame({ knowledgeBaseId, children }: KBEditorFrameProps) {
  const { knowledgeBase, isLoading } = useKnowledgeBase(knowledgeBaseId)
  const [activePanel] = useQueryState(
    'panel',
    parseAsStringLiteral(PANEL_VALUES).withDefault('general')
  )

  const leftPanels = useMemo(() => {
    if (!knowledgeBase) return []
    return [
      {
        key: 'kb-tab-panel',
        content: <KBTabPanel knowledgeBaseId={knowledgeBaseId} knowledgeBase={knowledgeBase} />,
        width: activePanel === 'articles' ? 320 : 512,
      },
    ]
  }, [knowledgeBase, knowledgeBaseId, activePanel])

  if (isLoading || !knowledgeBase) {
    return <LoadingSpinner />
  }

  return (
    <MainPage>
      <KBEditorHeader knowledgeBaseId={knowledgeBaseId} knowledgeBase={knowledgeBase} />
      <MainPageContent leftPanels={leftPanels}>{children}</MainPageContent>
    </MainPage>
  )
}
