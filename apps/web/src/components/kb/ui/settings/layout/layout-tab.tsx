// apps/web/src/components/kb/ui/settings/layout/layout-tab.tsx
'use client'

import type { KnowledgeBase } from '../../../store/knowledge-base-store'
import { FooterSection } from './footer-section'
import { HeaderSection } from './header-section'

interface LayoutTabProps {
  knowledgeBaseId: string
  knowledgeBase: KnowledgeBase
}

export function LayoutTab({ knowledgeBaseId, knowledgeBase }: LayoutTabProps) {
  return (
    <div className='pb-16 [&_[data-slot=section]]:pr-5'>
      <HeaderSection knowledgeBaseId={knowledgeBaseId} knowledgeBase={knowledgeBase} />
      <FooterSection knowledgeBaseId={knowledgeBaseId} knowledgeBase={knowledgeBase} />
    </div>
  )
}
