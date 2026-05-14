// apps/web/src/components/agents/ui/detail/agent-docked-chat.tsx
'use client'

import { KopilotChat } from '~/components/kopilot/ui/kopilot-chat'

interface AgentDockedChatProps {
  agentId: string
}

/**
 * Docked Kopilot chat scoped to one agent. New sessions created from this
 * surface carry `agentId` so the engine resolves the agent's toolset / prompt
 * config end-to-end (see /api/kopilot/stream + process-agent-job).
 *
 * v1 always starts a fresh session — no session history is surfaced. Admins
 * who want chat history can still visit /app/kopilot directly.
 */
export function AgentDockedChat({ agentId }: AgentDockedChatProps) {
  return (
    <div className='h-full flex flex-col'>
      <KopilotChat page='agent-detail' agentId={agentId} initialSessionId={null} />
    </div>
  )
}
