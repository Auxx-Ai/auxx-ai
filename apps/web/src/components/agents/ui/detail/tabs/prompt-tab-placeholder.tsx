// apps/web/src/components/agents/ui/detail/tabs/prompt-tab-placeholder.tsx
'use client'

import type { AgentDetail } from '../../../store/agent-store'
import type { AutosaveState } from '../../shared/autosave-indicator'
import { PersonaEditor } from '../prompt/persona-editor'

interface PromptSectionContentProps {
  agent: AgentDetail
  onAutosaveChange?: (state: AutosaveState) => void
}

export function PromptSectionContent({ agent, onAutosaveChange }: PromptSectionContentProps) {
  return (
    <div className='px-3 pb-6'>
      <PersonaEditor agent={agent} onAutosaveChange={onAutosaveChange} />
    </div>
  )
}
