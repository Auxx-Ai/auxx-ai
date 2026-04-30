// apps/web/src/components/kb/ui/editor/kb-tab-panel.tsx
'use client'

import { DrawerHeader } from '@auxx/ui/components/drawer'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { cn } from '@auxx/ui/lib/utils'
import { Loader2 } from 'lucide-react'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import type { KnowledgeBase } from '../../store/knowledge-base-store'
import { useKnowledgeBaseStore } from '../../store/knowledge-base-store'
import { GeneralTab } from '../settings/general/general-tab'
import { LayoutTab } from '../settings/layout/layout-tab'
import { KBArticlesPanel } from '../sidebar/kb-articles-panel'
import { KBArticlesHeaderActions } from './kb-articles-header-actions'

const PANEL_VALUES = ['general', 'layout', 'articles'] as const

const PANEL_TITLES: Record<(typeof PANEL_VALUES)[number], string> = {
  general: 'General',
  layout: 'Layout',
  articles: 'Articles',
}

interface KBTabPanelProps {
  knowledgeBaseId: string
  knowledgeBase: KnowledgeBase
}

/**
 * Body of the small left panel in the KB editor. Hosts the active settings
 * tab (General / Layout) or the article tree (Articles). Reads `?panel=` from
 * the URL and renders the matching content; the autosave registry handles
 * persistence per section, so this component owns no save state of its own.
 */
export function KBTabPanel({ knowledgeBaseId, knowledgeBase }: KBTabPanelProps) {
  const [activePanel] = useQueryState(
    'panel',
    parseAsStringLiteral(PANEL_VALUES).withDefault('general')
  )

  const isSaving = useKnowledgeBaseStore((s) => Boolean(s.pendingDraftPatches[knowledgeBaseId]))

  const headerActions =
    activePanel === 'articles' ? (
      <KBArticlesHeaderActions knowledgeBaseId={knowledgeBaseId} />
    ) : (
      <SavingIndicator isSaving={isSaving} />
    )

  return (
    <div className='flex flex-1 flex-col overflow-hidden'>
      <DrawerHeader
        title={<span className='text-sm font-medium'>{PANEL_TITLES[activePanel]}</span>}
        actions={headerActions}
      />

      <ScrollArea className='flex min-h-0 flex-1 flex-col'>
        {activePanel === 'general' && (
          <GeneralTab knowledgeBaseId={knowledgeBaseId} knowledgeBase={knowledgeBase} />
        )}
        {activePanel === 'layout' && (
          <LayoutTab knowledgeBaseId={knowledgeBaseId} knowledgeBase={knowledgeBase} />
        )}
        {activePanel === 'articles' && <KBArticlesPanel knowledgeBaseId={knowledgeBaseId} />}
      </ScrollArea>
    </div>
  )
}

function SavingIndicator({ isSaving }: { isSaving: boolean }) {
  return (
    <span
      className={cn(
        'flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs text-muted-foreground transition-opacity',
        isSaving ? 'opacity-100' : 'opacity-0'
      )}
      aria-live='polite'>
      <Loader2 className='size-3 animate-spin' />
      Saving…
    </span>
  )
}
