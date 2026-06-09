// apps/web/src/components/agents/ui/detail/agent-docked-chat.tsx
'use client'

import { agentTemplates } from '@auxx/lib/agents/client'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { FlaskConical, MessageSquare, MessageSquareOff, Settings2 } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { useEffect, useState } from 'react'
import { SimulationsTab } from '~/components/evals/ui/simulations-tab'
import { KopilotContext } from '~/components/kopilot/context'
import { KopilotChatProvider } from '~/components/kopilot/options'
import { KopilotSuggestion } from '~/components/kopilot/suggestions/kopilot-suggestion'
import { KopilotChat } from '~/components/kopilot/ui/kopilot-chat'
import { api } from '~/trpc/react'
import { useAgent } from '../../hooks/use-agent'

interface AgentDockedChatProps {
  agentId: string
}

type Panel = 'build' | 'chat' | 'simulations'
const PANELS: readonly Panel[] = ['build', 'chat', 'simulations'] as const

/**
 * Docked Kopilot chat scoped to one agent. Two tabs:
 * - **Build** — the agent builder thread (session `(userId, agentId,
 *   type='builder')`, builder persona + tools). This is the configuration
 *   surface.
 * - **Chat** — a direct-message thread with the agent itself (session
 *   `(userId, agentId, type='kopilot')` plus `triggerKind='dm'` so the
 *   DM AgentTrigger gates the run and layers in DM trigger-instructions).
 *
 * Default tab follows `setupCompletedAt`: agents that finished setup land
 * on Chat (first instinct is to test); agents mid-setup land on Build.
 * The current panel is persisted in `?panel=` so a refresh round-trips.
 *
 * Build-tab specifics (preserved from the pre-tabs implementation):
 * fresh agents get two seed-prompt suggestion chips, and a templated
 * prompt (`?template=<id>`) is auto-submitted as the first user turn.
 */
export function AgentDockedChat({ agentId }: AgentDockedChatProps) {
  const { agent, detail } = useAgent(agentId)

  const isFreshAgent = detail?.setupCompletedAt == null
  const defaultPanel: Panel = isFreshAgent ? 'build' : 'chat'

  const [panel, setPanel] = useQueryState(
    'panel',
    parseAsStringLiteral(PANELS).withDefault(defaultPanel)
  )

  return (
    <Tabs
      value={panel}
      onValueChange={(v) => setPanel(v as Panel)}
      className='flex h-full flex-col'>
      {!isFreshAgent && (
        <TabsList variant='outline'>
          <TabsTrigger value='build' variant='outline'>
            <Settings2 />
            Build
          </TabsTrigger>
          <TabsTrigger value='chat' variant='outline'>
            <MessageSquare />
            Chat
          </TabsTrigger>
          <TabsTrigger value='simulations' variant='outline'>
            <FlaskConical />
            Simulations
          </TabsTrigger>
        </TabsList>
      )}
      <TabsContent value='build' className='flex-1 overflow-hidden'>
        <BuildPanel agentId={agentId} isFreshAgent={isFreshAgent} agentName={agent?.name ?? null} />
      </TabsContent>
      <TabsContent value='chat' className='flex-1 overflow-hidden'>
        <ChatPanel
          agentId={agentId}
          agentName={agent?.name ?? null}
          agentDescription={detail?.description ?? null}
          isFreshAgent={isFreshAgent}
          onJumpToBuild={() => setPanel('build')}
        />
      </TabsContent>
      <TabsContent value='simulations' className='flex-1 overflow-hidden'>
        <SimulationsTab agentId={agentId} />
      </TabsContent>
    </Tabs>
  )
}

// ── Build tab ──────────────────────────────────────────────────────────────

interface BuildPanelProps {
  agentId: string
  isFreshAgent: boolean
  agentName: string | null
}

function BuildPanel({ agentId, isFreshAgent, agentName }: BuildPanelProps) {
  const { data, isLoading } = api.kopilot.listSessions.useQuery(
    { type: 'builder', agentId, limit: 1 },
    { staleTime: 30_000 }
  )

  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const [capturedTemplate] = useState(() => {
    const templateId = searchParams.get('template')
    if (!templateId) return null
    return agentTemplates.find((t) => t.id === templateId) ?? null
  })

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
        allowSenderPicker: false,
        hideSuggestions: !isFreshAgent,
        emptyStateDescription: isFreshAgent
          ? 'Tell me what this agent should do, or pick one below.'
          : 'Send a message to test this agent.',
      }}>
      <KopilotContext
        page='agents.builder'
        activeAgentId={agentId}
        activeAgentLabel={agentName ?? 'Untitled agent'}
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

// ── Chat tab ───────────────────────────────────────────────────────────────

interface ChatPanelProps {
  agentId: string
  agentName: string | null
  agentDescription: string | null
  isFreshAgent: boolean
  onJumpToBuild: () => void
}

function ChatPanel({
  agentId,
  agentName,
  agentDescription,
  isFreshAgent,
  onJumpToBuild,
}: ChatPanelProps) {
  // The DM session is a kopilot session bound to (user, agent). One rolling
  // thread per pair in v1; "Start new chat" lands later.
  const sessionsQuery = api.kopilot.listSessions.useQuery(
    { type: 'kopilot', agentId, limit: 1 },
    { staleTime: 30_000, enabled: !isFreshAgent }
  )
  const triggersQuery = api.agentTrigger.list.useQuery(
    { agentId },
    { staleTime: 30_000, enabled: !isFreshAgent }
  )

  if (isFreshAgent) {
    return (
      <EmptyChatState
        icon={<Settings2 className='size-6' />}
        title='Save your agent first'
        description='Complete setup before chatting — testing now would mean testing a half-configured agent.'
        ctaLabel='Finish setup'
        onCta={onJumpToBuild}
      />
    )
  }

  if (sessionsQuery.isLoading || triggersQuery.isLoading) {
    return <div className='h-full' />
  }

  const dmTrigger = triggersQuery.data?.find((t) => t.kind === 'dm')
  if (!dmTrigger?.enabled) {
    return (
      <EmptyChatState
        icon={<MessageSquareOff className='size-6' />}
        title='Direct messages are disabled'
        description='Enable them on the Triggers tab to start chatting with this agent.'
      />
    )
  }

  const initialSessionId = sessionsQuery.data?.items[0]?.id ?? null

  return (
    <KopilotChatProvider
      options={{
        allowModelPicker: false,
        allowSlashCommands: false,
        allowSenderPicker: false,
        hideSuggestions: true,
        emptyStateDescription:
          agentDescription ??
          (agentName
            ? `Say hi to ${agentName} — they have their own toolset and persona.`
            : 'Say hi to this agent.'),
      }}>
      <KopilotContext
        page='agents.dm'
        activeAgentId={agentId}
        activeAgentLabel={agentName ?? 'Untitled agent'}
      />
      <div className='h-full flex flex-col'>
        <KopilotChat
          page='agents.dm'
          agentId={agentId}
          sessionType='kopilot'
          triggerKind='dm'
          initialSessionId={initialSessionId}
        />
      </div>
    </KopilotChatProvider>
  )
}

interface EmptyChatStateProps {
  icon: React.ReactNode
  title: string
  description: string
  ctaLabel?: string
  onCta?: () => void
}

function EmptyChatState({ icon, title, description, ctaLabel, onCta }: EmptyChatStateProps) {
  return (
    <div className='flex h-full flex-col items-center justify-center px-6 text-center'>
      <div className='text-muted-foreground mb-3'>{icon}</div>
      <p className='text-sm font-medium text-foreground'>{title}</p>
      <p className='mt-1 text-xs text-muted-foreground max-w-xs'>{description}</p>
      {ctaLabel && onCta ? (
        <button
          type='button'
          className='mt-4 text-xs font-medium text-primary underline-offset-4 hover:underline'
          onClick={onCta}>
          {ctaLabel}
        </button>
      ) : null}
    </div>
  )
}
