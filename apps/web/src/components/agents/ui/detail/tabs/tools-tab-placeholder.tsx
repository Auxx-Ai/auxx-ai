// apps/web/src/components/agents/ui/detail/tabs/tools-tab-placeholder.tsx
'use client'

import type { AgentDetail } from '../../../store/agent-store'
import type { AutosaveState } from '../../shared/autosave-indicator'
import { ToolsSectionContent as ToolsContent } from '../tools/tools-section-content'

interface ToolsSectionContentProps {
  agent: AgentDetail
  onAutosaveChange?: (state: AutosaveState) => void
}

export function ToolsSectionContent(props: ToolsSectionContentProps) {
  return <ToolsContent {...props} />
}
