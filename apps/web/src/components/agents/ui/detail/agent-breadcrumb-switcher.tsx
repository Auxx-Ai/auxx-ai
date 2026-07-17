// apps/web/src/components/agents/ui/detail/agent-breadcrumb-switcher.tsx
'use client'

import { MainPageBreadcrumbDropdown } from '@auxx/ui/components/main-page'
import type { AgentDetail, AgentListItem } from '../../store/agent-store'
import { AgentAvatar } from '../shared/agent-avatar'
import { AgentSwitcherDropdownContent } from './agent-switcher-dropdown-content'

interface AgentBreadcrumbSwitcherProps {
  activeAgent: Pick<AgentDetail | AgentListItem, 'id' | 'name' | 'avatarUrl' | 'slug'>
}

export function AgentBreadcrumbSwitcher({ activeAgent }: AgentBreadcrumbSwitcherProps) {
  return (
    <MainPageBreadcrumbDropdown
      label={activeAgent.name ?? 'Untitled agent'}
      icon={<AgentAvatar agent={activeAgent} size={5} className='mr-1' />}>
      <AgentSwitcherDropdownContent activeAgentId={activeAgent.id} />
    </MainPageBreadcrumbDropdown>
  )
}
