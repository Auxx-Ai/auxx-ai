// apps/web/src/components/kb/ui/settings/general/general-tab.tsx
'use client'

import type { KnowledgeBase } from '../../../store/knowledge-base-store'
import { BrandingSection } from './branding-section'
import { ColorsSection } from './colors-section'
import { IdentitySection } from './identity-section'
import { LogosSection } from './logos-section'
import { ModesSection } from './modes-section'
import { StylingSection } from './styling-section'
import { ThemeSection } from './theme-section'

interface GeneralTabProps {
  knowledgeBaseId: string
  knowledgeBase: KnowledgeBase
}

export function GeneralTab({ knowledgeBaseId, knowledgeBase }: GeneralTabProps) {
  return (
    <div className='relative pb-16 [&_[data-slot=section]]:pr-5'>
      <IdentitySection knowledgeBaseId={knowledgeBaseId} knowledgeBase={knowledgeBase} />
      <BrandingSection knowledgeBaseId={knowledgeBaseId} knowledgeBase={knowledgeBase} />
      <LogosSection knowledgeBaseId={knowledgeBaseId} knowledgeBase={knowledgeBase} />
      <ThemeSection knowledgeBaseId={knowledgeBaseId} knowledgeBase={knowledgeBase} />
      <ColorsSection knowledgeBaseId={knowledgeBaseId} knowledgeBase={knowledgeBase} />
      <ModesSection knowledgeBaseId={knowledgeBaseId} knowledgeBase={knowledgeBase} />
      <StylingSection knowledgeBaseId={knowledgeBaseId} knowledgeBase={knowledgeBase} />
    </div>
  )
}
