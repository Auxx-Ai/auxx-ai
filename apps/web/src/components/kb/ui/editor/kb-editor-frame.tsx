// apps/web/src/components/kb/ui/editor/kb-editor-frame.tsx
'use client'

import { MainPage, MainPageContent } from '@auxx/ui/components/main-page'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import type React from 'react'
import { useMemo } from 'react'
import { MainPageLoading } from '~/components/global/main-page-states'
import { KopilotContext } from '~/components/kopilot/context/kopilot-context'
import { useKnowledgeBase } from '../../hooks/use-knowledge-base'
import type { KnowledgeBase } from '../../store/knowledge-base-store'
import { ArticlesTabArrow } from '../preview/articles-tab-arrow'
import { KBPreviewHintProvider } from '../preview/preview-hint-context'
import { KBEditorAccessProvider, useKBEditorAccess } from './kb-editor-access-context'
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

  if (isLoading || !knowledgeBase) {
    return (
      <MainPage>
        <MainPageLoading />
      </MainPage>
    )
  }

  return (
    <KBEditorAccessProvider knowledgeBaseId={knowledgeBaseId}>
      <KBEditorFrameBody knowledgeBaseId={knowledgeBaseId} knowledgeBase={knowledgeBase}>
        {children}
      </KBEditorFrameBody>
    </KBEditorAccessProvider>
  )
}

interface KBEditorFrameBodyProps {
  knowledgeBaseId: string
  knowledgeBase: KnowledgeBase
  children: React.ReactNode
}

function KBEditorFrameBody({ knowledgeBaseId, knowledgeBase, children }: KBEditorFrameBodyProps) {
  const { canAdmin } = useKBEditorAccess()
  const [panelParam] = useQueryState(
    'panel',
    parseAsStringLiteral(PANEL_VALUES).withDefault('general')
  )
  // The learned KB ("AI Memory") is always on the article tree; so is any KB
  // the member can't administer — settings/layout are Full-only (doc 24 §A.2.4).
  const activePanel = knowledgeBase.kind === 'learned' || !canAdmin ? 'articles' : panelParam

  const leftPanels = useMemo(() => {
    return [
      {
        key: 'kb-tab-panel',
        content: <KBTabPanel knowledgeBaseId={knowledgeBaseId} knowledgeBase={knowledgeBase} />,
        width: activePanel === 'articles' ? 320 : 512,
      },
    ]
  }, [knowledgeBase, knowledgeBaseId, activePanel])

  return (
    <KBPreviewHintProvider>
      <KopilotContext
        page='kb'
        activeKnowledgeBaseId={knowledgeBaseId}
        activeKnowledgeBaseLabel={knowledgeBase.name ?? undefined}
      />
      <MainPage>
        <KBEditorHeader knowledgeBaseId={knowledgeBaseId} knowledgeBase={knowledgeBase} />
        <MainPageContent leftPanels={leftPanels}>{children}</MainPageContent>
        <ArticlesTabArrow />
      </MainPage>
    </KBPreviewHintProvider>
  )
}
