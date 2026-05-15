// apps/web/src/components/agents/ui/detail/agent-docked-chat.tsx
'use client'

import { KopilotChat } from '~/components/kopilot/ui/kopilot-chat'
import { api } from '~/trpc/react'

interface AgentDockedChatProps {
  agentId: string
}

/**
 * Docked Kopilot chat scoped to one agent. The session is bound to
 * `(userId, agentId, type='builder')` — each admin gets their own persistent
 * builder thread per agent. On mount we look up the most recent builder
 * session and load it; if none exists, the chat starts fresh and the first
 * message creates a new builder-tagged session.
 */
export function AgentDockedChat({ agentId }: AgentDockedChatProps) {
  const { data, isLoading } = api.kopilot.listSessions.useQuery(
    { type: 'builder', agentId, limit: 1 },
    { staleTime: 30_000 }
  )

  if (isLoading) return <div className='h-full' />

  const initialSessionId = data?.items[0]?.id ?? null

  return (
    <div className='h-full flex flex-col'>
      <KopilotChat
        page='agents.builder'
        agentId={agentId}
        sessionType='builder'
        initialSessionId={initialSessionId}
      />
    </div>
  )
}
