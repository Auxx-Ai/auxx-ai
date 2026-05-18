// apps/web/src/components/agents/ui/detail/agent-docked-chat.tsx
'use client'

import { agentTemplates } from '@auxx/lib/agents/client'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { KopilotContext } from '~/components/kopilot/context'
import { KopilotChatProvider } from '~/components/kopilot/options'
import { KopilotSuggestion } from '~/components/kopilot/suggestions/kopilot-suggestion'
import { KopilotChat } from '~/components/kopilot/ui/kopilot-chat'
import { api } from '~/trpc/react'
import { useAgent } from '../../hooks/use-agent'

interface AgentDockedChatProps {
  agentId: string
}

/**
 * Docked Kopilot chat scoped to one agent. The session is bound to
 * `(userId, agentId, type='builder')` — each admin gets their own persistent
 * builder thread per agent. On mount we look up the most recent builder
 * session and load it; if none exists, the chat starts fresh and the first
 * message creates a new builder-tagged session.
 *
 * Fresh agents (no prompt body, no enabled toolsets) get two seed-prompt
 * chips in the empty state — the builder persona expects the admin to either
 * pick one or describe what they want, and these chips make the first turn
 * trivial. Populated agents hide the chips entirely; the chat reads as edit-
 * in-place.
 *
 * If the URL carries `?template=<id>`, the templated prompt is submitted
 * directly as the first user turn (no chip rendered). The capture is frozen
 * at mount so the param-strip can't change the message after the chat has
 * already dispatched it.
 */
export function AgentDockedChat({ agentId }: AgentDockedChatProps) {
  const { data, isLoading } = api.kopilot.listSessions.useQuery(
    { type: 'builder', agentId, limit: 1 },
    { staleTime: 30_000 }
  )
  const { agent, detail } = useAgent(agentId)

  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  // Show seed-prompt chips while the agent is mid-setup — drafts created
  // through the new "Create agent" button start with auto-default toolsets
  // (which used to defeat the fresh-agent check), but `setupCompletedAt`
  // null is the authoritative signal that the admin hasn't finished
  // chatting through the build yet.
  const isFreshAgent = detail?.setupCompletedAt == null

  // Freeze the template at first render. Subsequent param changes are
  // ignored, so the param-strip effect below can't yank the suggestion
  // before autoSubmit runs. Stale ids resolve to null → falls through to
  // the default chips silently.
  const [capturedTemplate] = useState(() => {
    const templateId = searchParams.get('template')
    if (!templateId) return null
    return agentTemplates.find((t) => t.id === templateId) ?? null
  })

  // Strip `?template=<id>` after capture so a refresh doesn't fire the
  // prompt twice. Runs once on mount.
  useEffect(() => {
    if (searchParams.get('template')) {
      router.replace(pathname, { scroll: false })
    }
  }, [pathname, router, searchParams])

  if (isLoading) return <div className='h-full' />

  const initialSessionId = data?.items[0]?.id ?? null
  const hasTemplate = isFreshAgent && capturedTemplate !== null

  return (
    <KopilotChatProvider
      options={{
        allowModelPicker: false,
        allowSlashCommands: false,
        hideSuggestions: !isFreshAgent,
        emptyStateDescription: isFreshAgent
          ? 'Tell me what this agent should do, or pick one below.'
          : 'Send a message to test this agent.',
      }}>
      <KopilotContext
        page='agents.builder'
        activeAgentId={agentId}
        activeAgentLabel={agent?.name ?? 'Untitled agent'}
      />
      {isFreshAgent && !hasTemplate && (
        <>
          <KopilotSuggestion
            text='Build me a customer support triage agent'
            icon='sparkle'
            priority={2}
            autoSubmit={true}
          />
          <KopilotSuggestion
            text='Help me set up a scheduled report agent'
            icon='workflow'
            priority={1}
            autoSubmit={true}
          />
        </>
      )}
      <div className='h-full flex flex-col'>
        <KopilotChat
          page='agents.builder'
          agentId={agentId}
          sessionType='builder'
          initialSessionId={initialSessionId}
          initialMessage={hasTemplate ? capturedTemplate!.prompt : null}
        />
      </div>
    </KopilotChatProvider>
  )
}
