// apps/web/src/components/agents/ui/detail/agent-docked-chat.tsx
'use client'

import { agentTemplates } from '@auxx/lib/agents/client'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@auxx/ui/components/resizable'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@auxx/ui/components/tooltip'
import {
  FlaskConical,
  MessageSquare,
  MessageSquareOff,
  MoreHorizontal,
  Rows2,
  Settings2,
  SquarePen,
} from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { parseAsBoolean, parseAsStringLiteral, useQueryState } from 'nuqs'
import { useCallback, useEffect, useState } from 'react'
import { useActiveSuite } from '~/components/evals/hooks/use-active-suite'
import { SimulationsTab } from '~/components/evals/ui/simulations-tab'
import { KopilotContext } from '~/components/kopilot/context'
import { KopilotChatProvider } from '~/components/kopilot/options'
import { useKopilotStore } from '~/components/kopilot/stores/kopilot-store'
import { KopilotSuggestion } from '~/components/kopilot/suggestions/kopilot-suggestion'
import { KopilotChat } from '~/components/kopilot/ui/kopilot-chat'
import { api } from '~/trpc/react'
import { useAgent } from '../../hooks/use-agent'
import { resolveDockLayout } from '../../utils/dock-layout'

interface AgentDockedChatProps {
  agentId: string
}

type Panel = 'build' | 'chat' | 'simulations'
const PANELS: readonly Panel[] = ['build', 'chat', 'simulations'] as const

type ChatTab = Exclude<Panel, 'simulations'>

/**
 * Per-tab "start new chat" state. `epoch` keys the KopilotChat instance so a
 * bump forces the remount its ref-guarded mount effect requires; `pending`
 * means the fresh chat hasn't received its server-created session yet, so the
 * panel passes `initialSessionId={null}` instead of the latest thread.
 */
type FreshChatState = Record<ChatTab, { epoch: number; pending: boolean }>

const INITIAL_FRESH_STATE: FreshChatState = {
  build: { epoch: 0, pending: false },
  chat: { epoch: 0, pending: false },
}

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
 * Each chat tab resolves its thread as the latest `(user, agent, type)`
 * session (`listSessions` limit 1, `updatedAt` desc) — nothing stores a
 * session id on the agent. The tab-bar menu's "Start new chat" simply stops
 * pointing at that thread: the panel passes `initialSessionId={null}` and the
 * stream route creates a new session on the first send, which then wins the
 * latest-first lookup. Old threads stay in the DB as history.
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
  // Opt-in vertical split (Phase 3): Simulations (top) + Build (bottom) at once.
  // `panel` records which pane the user came from so exiting restores it.
  const [split, setSplit] = useQueryState('split', parseAsBoolean.withDefault(false))
  const layout = resolveDockLayout({ panel, split, isFreshAgent })

  // Tabs are the split's exit, the toggle is its entrance. A tab click always
  // drops the split and selects that panel (covers clicking the already-active
  // tab, where onValueChange wouldn't fire).
  const exitToPanel = useCallback(
    (next: Panel) => {
      void setSplit(false)
      void setPanel(next)
    },
    [setSplit, setPanel]
  )
  const toggleSplit = useCallback(() => void setSplit((s) => !s), [setSplit])

  const [freshChats, setFreshChats] = useState<FreshChatState>(INITIAL_FRESH_STATE)

  const startNewChat = useCallback((tab: ChatTab) => {
    setFreshChats((s) => ({ ...s, [tab]: { epoch: s[tab].epoch + 1, pending: true } }))
  }, [])

  const settleFreshChat = useCallback((tab: ChatTab) => {
    setFreshChats((s) => (s[tab].pending ? { ...s, [tab]: { ...s[tab], pending: false } } : s))
  }, [])

  const settleBuild = useCallback(() => settleFreshChat('build'), [settleFreshChat])
  const settleChat = useCallback(() => settleFreshChat('chat'), [settleFreshChat])

  // Same input as ChatPanel's query — React Query dedupes the fetch. Used only
  // to disable "Start new chat" on the Chat tab when DMs are off.
  const triggersQuery = api.agentTrigger.list.useQuery(
    { agentId },
    { staleTime: 30_000, enabled: !isFreshAgent }
  )
  const dmEnabled = triggersQuery.data?.find((t) => t.kind === 'dm')?.enabled ?? false

  // Pulse the Simulations trigger while a suite runs, so the state is visible
  // from the Build/Chat tabs (Phase 2.4). Only the tab bar (and thus this) is
  // present once setup is done.
  const activeSuite = useActiveSuite(agentId, !isFreshAgent)

  // "Fix with Kopilot" (evals 5D.1): queue the seed for the builder chat. In
  // split mode the build pane is already mounted and consumes it in place
  // (Phase 3.3 payoff — the failure list stays visible); otherwise switch to
  // Build so its KopilotChat mounts and picks up the seed.
  const handleFix = useCallback(
    (seed: string) => {
      useKopilotStore.getState().setPendingSeed({ page: 'agents.builder', text: seed })
      if (layout.mode !== 'split') void setPanel('build')
    },
    [layout.mode, setPanel]
  )

  // Same elements in both the tab and split branches (extracted so they're
  // identical). Toggling split remounts them (different parent) — acceptable:
  // session state is server-persisted and reloads fast.
  const buildPanelElement = (
    <BuildPanel
      agentId={agentId}
      isFreshAgent={isFreshAgent}
      agentName={agent?.name ?? null}
      fresh={freshChats.build.pending}
      epoch={freshChats.build.epoch}
      onSessionEstablished={settleBuild}
    />
  )
  const simulationsElement = <SimulationsTab agentId={agentId} onFixWithKopilot={handleFix} />

  return (
    <Tabs
      value={panel}
      onValueChange={(v) => exitToPanel(v as Panel)}
      className='flex h-full flex-col'>
      {!isFreshAgent && (
        <TabsList variant='outline'>
          <TabsTrigger value='build' variant='outline' onClick={() => exitToPanel('build')}>
            <Settings2 />
            Build
          </TabsTrigger>
          <TabsTrigger value='chat' variant='outline' onClick={() => exitToPanel('chat')}>
            <MessageSquare />
            Chat
          </TabsTrigger>
          <TabsTrigger
            value='simulations'
            variant='outline'
            onClick={() => exitToPanel('simulations')}>
            <FlaskConical />
            Simulations
            {activeSuite && (
              <span
                className='size-1.5 shrink-0 rounded-full bg-blue-500 animate-pulse'
                aria-label='Suite running'
              />
            )}
          </TabsTrigger>
          <div className='ml-auto flex items-center'>
            {layout.panel !== 'chat' && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={split ? 'secondary' : 'ghost'}
                    size='icon-xs'
                    className='rounded-md shrink-0'
                    aria-label='Split Simulations and Build'
                    aria-pressed={split}
                    onClick={toggleSplit}>
                    <Rows2 />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side='bottom'>
                  {split ? 'Exit split view' : 'Split Simulations + Build'}
                </TooltipContent>
              </Tooltip>
            )}
            {panel !== 'simulations' && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant='ghost'
                    size='icon-xs'
                    className='rounded-md shrink-0'
                    aria-label='Chat actions'>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end'>
                  <DropdownMenuItem
                    disabled={panel === 'chat' && !dmEnabled}
                    onClick={() => startNewChat(panel)}>
                    <SquarePen />
                    Start new chat
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </TabsList>
      )}
      {layout.mode === 'split' ? (
        <ResizablePanelGroup
          direction='vertical'
          autoSaveId='agent-eval-split'
          className='flex-1 overflow-hidden'>
          <ResizablePanel minSize={25} defaultSize={45} className='overflow-hidden'>
            {simulationsElement}
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel minSize={30} className='overflow-hidden'>
            {buildPanelElement}
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <>
          <TabsContent value='build' className='flex-1 overflow-hidden'>
            {buildPanelElement}
          </TabsContent>
          <TabsContent value='chat' className='flex-1 overflow-hidden'>
            <ChatPanel
              agentId={agentId}
              agentName={agent?.name ?? null}
              agentDescription={detail?.description ?? null}
              isFreshAgent={isFreshAgent}
              onJumpToBuild={() => setPanel('build')}
              fresh={freshChats.chat.pending}
              epoch={freshChats.chat.epoch}
              onSessionEstablished={settleChat}
            />
          </TabsContent>
          <TabsContent value='simulations' className='flex-1 overflow-hidden'>
            {simulationsElement}
          </TabsContent>
        </>
      )}
    </Tabs>
  )
}

// ── Fresh-session tracking ─────────────────────────────────────────────────

/**
 * While a "start new chat" is pending, watches the kopilot store for the
 * server-created session id (set by the `session-created` SSE event) and, once
 * it appears, invalidates the panel's `limit: 1` session lookup — the SSE
 * cache patch only covers the master list, so without this the scoped query
 * stays stale for its 30s staleTime — then reports back so the parent clears
 * the pending flag (keeping it set would wipe the new thread on the next
 * remount).
 *
 * The store is read imperatively inside the effect rather than from the
 * subscribed value: at the commit where `fresh` flips on, the subscription
 * still holds whatever session another surface left behind, but KopilotChat's
 * mount effect (a child, so it runs first) has already wiped it by the time
 * this effect executes. Only a genuinely new id — non-null and different from
 * the latest persisted thread — counts as established.
 */
function useFreshSessionEstablished({
  fresh,
  latestSessionId,
  sessionType,
  agentId,
  onEstablished,
}: {
  fresh: boolean
  latestSessionId: string | null
  sessionType: 'kopilot' | 'builder'
  agentId: string
  onEstablished: () => void
}) {
  const utils = api.useUtils()

  useEffect(() => {
    if (!fresh) return
    let done = false
    const check = (current: string | null) => {
      if (done || !current || current === latestSessionId) return
      done = true
      void utils.kopilot.listSessions.invalidate({ type: sessionType, agentId, limit: 1 })
      onEstablished()
    }
    check(useKopilotStore.getState().activeSessionId)
    return useKopilotStore.subscribe((state) => check(state.activeSessionId))
  }, [fresh, latestSessionId, sessionType, agentId, utils, onEstablished])
}

// ── Build tab ──────────────────────────────────────────────────────────────

interface BuildPanelProps {
  agentId: string
  isFreshAgent: boolean
  agentName: string | null
  fresh: boolean
  epoch: number
  onSessionEstablished: () => void
}

function BuildPanel({
  agentId,
  isFreshAgent,
  agentName,
  fresh,
  epoch,
  onSessionEstablished,
}: BuildPanelProps) {
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

  const latestSessionId = data?.items[0]?.id ?? null

  useFreshSessionEstablished({
    fresh,
    latestSessionId,
    sessionType: 'builder',
    agentId,
    onEstablished: onSessionEstablished,
  })

  if (isLoading) return <div className='h-full' />

  const initialSessionId = fresh ? null : latestSessionId
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
          key={epoch}
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
  fresh: boolean
  epoch: number
  onSessionEstablished: () => void
}

function ChatPanel({
  agentId,
  agentName,
  agentDescription,
  isFreshAgent,
  onJumpToBuild,
  fresh,
  epoch,
  onSessionEstablished,
}: ChatPanelProps) {
  // The DM session is a kopilot session bound to (user, agent). The panel
  // shows the latest thread; "Start new chat" in the tab-bar menu rotates it.
  const sessionsQuery = api.kopilot.listSessions.useQuery(
    { type: 'kopilot', agentId, limit: 1 },
    { staleTime: 30_000, enabled: !isFreshAgent }
  )
  const triggersQuery = api.agentTrigger.list.useQuery(
    { agentId },
    { staleTime: 30_000, enabled: !isFreshAgent }
  )

  const latestSessionId = sessionsQuery.data?.items[0]?.id ?? null

  useFreshSessionEstablished({
    fresh,
    latestSessionId,
    sessionType: 'kopilot',
    agentId,
    onEstablished: onSessionEstablished,
  })

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

  const initialSessionId = fresh ? null : latestSessionId

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
          key={epoch}
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
