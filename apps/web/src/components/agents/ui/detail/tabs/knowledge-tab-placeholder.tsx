// apps/web/src/components/agents/ui/detail/tabs/knowledge-tab-placeholder.tsx
'use client'

import type { AgentDetail } from '../../../store/agent-store'
import type { AutosaveState } from '../../shared/autosave-indicator'
import { KnowledgeSectionContent as KnowledgeContent } from '../knowledge/knowledge-section-content'

interface KnowledgeSectionContentProps {
  agent: AgentDetail
  onAutosaveChange?: (state: AutosaveState) => void
}

export function KnowledgeSectionContent(props: KnowledgeSectionContentProps) {
  return <KnowledgeContent {...props} />
}
