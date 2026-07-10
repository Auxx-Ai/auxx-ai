// apps/web/src/components/kb/ui/editor/kb-editor-header.tsx
'use client'

import { mergeDraftOverLive } from '@auxx/lib/kb/client'
import { Avatar, AvatarFallback } from '@auxx/ui/components/avatar'
import {
  MainPageBreadcrumb,
  MainPageBreadcrumbDropdown,
  MainPageBreadcrumbItem,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { Book, Cog, Layout, Sparkles } from 'lucide-react'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { useEffect, useMemo } from 'react'
import { LAYOUT_TAB_ENABLED } from '../../constant'
import type { KnowledgeBase } from '../../store/knowledge-base-store'
import { useKBPreviewHint } from '../preview/preview-hint-context'
import { KBSwitcherDropdownContent } from '../sidebar/kb-switcher'
import { KBPublishCluster } from './kb-publish-cluster'

const PANEL_VALUES = ['general', 'layout', 'articles'] as const
export type KBEditorPanel = (typeof PANEL_VALUES)[number]

interface KBEditorHeaderProps {
  knowledgeBaseId: string
  knowledgeBase: KnowledgeBase
}

function getInitials(name?: string): string {
  if (!name) return 'KB'
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .substring(0, 2)
}

/**
 * Persistent KB editor header — breadcrumb [Knowledge Bases ▸ KB-name dropdown],
 * action [KBPublishCluster + RadioTab General/Layout/Articles]. Sits inside
 * `MainPage` in the editor route segment layout.
 *
 * The learned KB ("AI Memory") gets trimmed chrome: no settings tabs (the
 * panel is forced to the article tree), no publish cluster (it is INTERNAL
 * and never site-published), and a plain breadcrumb instead of the KB
 * switcher (the learned KB is excluded from `kb.list`, so the switcher
 * neither names it nor offers it).
 */
export function KBEditorHeader({ knowledgeBaseId, knowledgeBase }: KBEditorHeaderProps) {
  const [panel, setPanel] = useQueryState(
    'panel',
    parseAsStringLiteral(PANEL_VALUES).withDefault('general')
  )
  const { lockSession } = useKBPreviewHint()
  const isLearned = knowledgeBase.kind === 'learned'

  // Once the user has reached the Articles panel they've found the answer the
  // hint was pointing at — never show it again this session.
  useEffect(() => {
    if (panel === 'articles') lockSession()
  }, [panel, lockSession])

  const merged = useMemo(
    () => mergeDraftOverLive(knowledgeBase as Record<string, unknown>) as KnowledgeBase,
    [knowledgeBase]
  )

  return (
    <MainPageHeader
      action={
        isLearned ? undefined : (
          <div className='flex items-center gap-2'>
            <KBPublishCluster kbId={knowledgeBaseId} />
          </div>
        )
      }>
      <MainPageBreadcrumb>
        <MainPageBreadcrumbItem
          title='Knowledge Bases'
          href='/app/kb'
          className='hidden sm:inline-flex '
        />
        {isLearned ? (
          <MainPageBreadcrumbItem
            title={merged.name ?? 'AI Memory'}
            icon={<Sparkles className='size-4 text-primary' />}
            last
          />
        ) : (
          <MainPageBreadcrumbDropdown
            label={merged.name ?? 'Knowledge Base'}
            icon={
              <Avatar className='size-5 rounded'>
                <AvatarFallback className='rounded bg-primary/10 text-[10px] text-primary'>
                  {getInitials(merged.name)}
                </AvatarFallback>
              </Avatar>
            }
            last
            contentClassName='w-72'>
            <KBSwitcherDropdownContent />
          </MainPageBreadcrumbDropdown>
        )}
      </MainPageBreadcrumb>
      {!isLearned && (
        <RadioTab value={panel} onValueChange={(v) => setPanel(v as KBEditorPanel)} size='sm'>
          <RadioTabItem value='general' tooltip='General'>
            <Cog />
            <span className='hidden sm:inline'>General</span>
          </RadioTabItem>
          {LAYOUT_TAB_ENABLED && (
            <RadioTabItem value='layout' tooltip='Layout'>
              <Layout />
              <span className='hidden sm:inline'>Layout</span>
            </RadioTabItem>
          )}
          <RadioTabItem value='articles' tooltip='Articles' data-kb-articles-tab=''>
            <Book />
            <span className='hidden sm:inline'>Articles</span>
          </RadioTabItem>
        </RadioTab>
      )}
    </MainPageHeader>
  )
}
