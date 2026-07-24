// apps/web/src/components/kb/ui/editor/kb-editor-header.tsx
'use client'

import { mergeDraftOverLive } from '@auxx/lib/kb/client'
import { toRecordId } from '@auxx/types/resource'
import { Avatar, AvatarFallback } from '@auxx/ui/components/avatar'
import { Button } from '@auxx/ui/components/button'
import {
  MainPageBreadcrumb,
  MainPageBreadcrumbDropdown,
  MainPageBreadcrumbItem,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { MainPageTabs } from '@auxx/ui/components/main-page-tabs'
import { Book, Cog, Layout, Share2, Sparkles } from 'lucide-react'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { useEffect, useMemo, useState } from 'react'
import { InstanceShareDialog } from '~/components/permissions/ui/instance-share-dialog'
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
 * action [KBPublishCluster + MainPageTabs General/Layout/Articles]. Sits inside
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
  const [shareOpen, setShareOpen] = useState(false)
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
            <Button variant='outline' size='sm' onClick={() => setShareOpen(true)}>
              <Share2 />
              Share
            </Button>
            <InstanceShareDialog
              recordId={toRecordId('kb', knowledgeBaseId)}
              open={shareOpen}
              onOpenChange={setShareOpen}
            />
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
            contentClassName='w-72'>
            <KBSwitcherDropdownContent />
          </MainPageBreadcrumbDropdown>
        )}
      </MainPageBreadcrumb>
      {!isLearned && (
        <MainPageTabs
          value={panel}
          onValueChange={(v) => setPanel(v as KBEditorPanel)}
          items={[
            { value: 'general', label: 'General', icon: <Cog />, tooltip: 'General' },
            {
              value: 'layout',
              label: 'Layout',
              icon: <Layout />,
              tooltip: 'Layout',
              hidden: !LAYOUT_TAB_ENABLED,
            },
            {
              value: 'articles',
              label: 'Articles',
              icon: <Book />,
              tooltip: 'Articles',
              'data-kb-articles-tab': '',
            },
          ]}
        />
      )}
    </MainPageHeader>
  )
}
