// apps/web/src/components/kb/ui/editor/kb-tab-panel.tsx
'use client'

import { DrawerHeader } from '@auxx/ui/components/drawer'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { cn } from '@auxx/ui/lib/utils'
import { Loader2, Sparkles } from 'lucide-react'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { LAYOUT_TAB_ENABLED } from '../../constant'
import type { KnowledgeBase } from '../../store/knowledge-base-store'
import { useKnowledgeBaseStore } from '../../store/knowledge-base-store'
import { GeneralTab } from '../settings/general/general-tab'
import { LayoutTab } from '../settings/layout/layout-tab'
import { KBArticlesPanel } from '../sidebar/kb-articles-panel'
import { KBArticlesHeaderActions } from './kb-articles-header-actions'
import { useKBEditorAccess } from './kb-editor-access-context'

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
  const [panelParam] = useQueryState(
    'panel',
    parseAsStringLiteral(PANEL_VALUES).withDefault('general')
  )
  // The learned KB ("AI Memory") has no settings tabs — the panel is always
  // the article tree, retitled "Memory". Same for an Edit-level (non-admin)
  // member — settings/layout are Full-only (doc 24 §A.2.4) — so General/Layout
  // never mount and their autosave hooks never run for them.
  const { canAdmin } = useKBEditorAccess()
  const isLearned = knowledgeBase.kind === 'learned'
  const activePanel = isLearned || !canAdmin ? 'articles' : panelParam

  const isSaving = useKnowledgeBaseStore((s) => Boolean(s.pendingDraftPatches[knowledgeBaseId]))

  const headerActions =
    activePanel === 'articles' ? (
      <KBArticlesHeaderActions knowledgeBaseId={knowledgeBaseId} />
    ) : (
      <SavingIndicator isSaving={isSaving} />
    )

  const title = isLearned ? (
    <span className='flex items-center gap-1.5 text-sm font-medium'>
      <Sparkles className='size-3.5 text-primary' />
      Memory
    </span>
  ) : (
    <span className='text-sm font-medium'>{PANEL_TITLES[activePanel]}</span>
  )

  return (
    <div className='flex flex-1 flex-col overflow-hidden'>
      <DrawerHeader title={title} actions={headerActions} />

      <ScrollArea className='flex min-h-0 flex-1 flex-col'>
        {activePanel === 'general' && (
          <GeneralTab knowledgeBaseId={knowledgeBaseId} knowledgeBase={knowledgeBase} />
        )}
        {LAYOUT_TAB_ENABLED && activePanel === 'layout' && (
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
