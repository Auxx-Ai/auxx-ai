// apps/web/src/components/workflow/panels/kopilot/workflow-kopilot-panel.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Loader2, MoreHorizontal, SquarePen } from 'lucide-react'
import { useCallback, useEffect } from 'react'
import { KopilotContext } from '~/components/kopilot/context'
import { useFreshSessionEstablished } from '~/components/kopilot/hooks/use-fresh-session-established'
import { KopilotChatProvider } from '~/components/kopilot/options'
import { KopilotChat } from '~/components/kopilot/ui/kopilot-chat'
import { SparkleIcon } from '~/components/kopilot/ui/sparkle-icon'
import { PanelFrameHeader } from '~/components/workflow/panels/panel-frame-chrome'
import { usePanelStore } from '~/components/workflow/store/panel-store'
import { useWorkflowStore } from '~/components/workflow/store/workflow-store'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'

/**
 * `WORKFLOW_BUILDER_PAGE` from `@auxx/lib/ai/kopilot` — hardcoded here for the
 * same reason every other builder page hardcodes its key (KB's 'kb', the agent
 * builder's 'agents.builder'): the constant only lives on a server-side barrel.
 * The stream route gates the graph tools on this exact value.
 */
const WORKFLOW_BUILDER_PAGE = 'workflow.builder'

interface WorkflowKopilotPanelProps {
  /** WorkflowApp id — the subject of every graph tool. */
  workflowAppId?: string
}

/**
 * The `kopilot` panel frame — a Kopilot chat scoped to the open workflow.
 *
 * This is the builder's own chat surface, not the global dock: it registers
 * `page='workflow.builder'` (which is what makes the graph tools exist at all)
 * plus the pinned `workflow` session ref, and it resolves its own thread rather
 * than inheriting whatever session the global Kopilot was last on.
 *
 * The global dock is hidden for the whole workflow page, not just while this
 * frame is up — the page calls `useEmbeddedKopilotSurface()`. The store is a
 * singleton (one `activeSessionId`, one message list, one SSE runner), so two
 * chat surfaces would render the same conversation and fight over its session.
 *
 * Body only: the drawer, width and header slot belong to `WorkflowPanelDrawer`,
 * and the header portals into it via `PanelFrameHeader`.
 *
 * See `plans/kopilot/workflow/13-builder-panel.md`.
 */
export function WorkflowKopilotPanel({ workflowAppId }: WorkflowKopilotPanelProps) {
  // Name and dirty flag come from the canvas store, not a query: the panel can
  // only be opened from a mounted editor, so the workflow is already loaded —
  // no extra fetch, and a rename in the Settings frame updates the chip live.
  const workflowName = useWorkflowStore((state) => state.workflow?.name)
  const isDirty = useWorkflowStore((state) => state.isDirty)

  const startNewKopilotChat = usePanelStore((state) => state.startNewKopilotChat)

  // The toolbar hides its entry point without the feature, but the `B` shortcut
  // has no plan awareness — so the frame owns its own availability. Mounting
  // `KopilotChat` here would 403 twice: once on the session lookup, once on send.
  const kopilotEnabled = useFeatureFlags().hasAccess(FeatureKey.kopilot)

  return (
    <KopilotChatProvider
      options={{
        allowModelPicker: false,
        allowSlashCommands: false,
        allowSenderPicker: false,
        emptyStateDescription: 'Describe what this workflow should do, or ask about the graph.',
      }}>
      {workflowAppId && (
        <KopilotContext
          page={WORKFLOW_BUILDER_PAGE}
          activeWorkflowId={workflowAppId}
          activeWorkflowLabel={workflowName}
          activeWorkflowIsDirty={isDirty}
        />
      )}
      <PanelFrameHeader
        icon={<SparkleIcon className='shrink-0' />}
        title='Kopilot'
        actions={
          kopilotEnabled ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant='ghost' size='icon-sm' aria-label='Chat actions'>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                <DropdownMenuItem
                  disabled={!workflowAppId}
                  onClick={() => workflowAppId && startNewKopilotChat(workflowAppId)}>
                  <SquarePen />
                  Start new chat
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : undefined
        }
      />
      {!kopilotEnabled ? (
        <PanelNotice>Kopilot is not available on your plan.</PanelNotice>
      ) : workflowAppId ? (
        <WorkflowKopilotChat workflowAppId={workflowAppId} />
      ) : (
        <PanelNotice>Save this workflow to build it with Kopilot.</PanelNotice>
      )}
    </KopilotChatProvider>
  )
}

function PanelNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className='flex-1 flex items-center justify-center px-6 text-center'>
      <p className='text-xs text-muted-foreground max-w-xs'>{children}</p>
    </div>
  )
}

/**
 * Thread resolution + the chat itself, split out so every hook below can take
 * `workflowAppId` as required rather than threading `enabled` flags through.
 *
 * There is no eager session creation: an unsaved chat is a real state here, and
 * the stream route writes the `AiAgentSession` row on the first send (tagged
 * with this workflow). Creating one on open would litter the history with empty
 * threads every time the panel is toggled.
 */
function WorkflowKopilotChat({ workflowAppId }: { workflowAppId: string }) {
  const utils = api.useUtils()

  const kopilotSession = usePanelStore((state) => state.kopilotSession)
  const setKopilotSession = usePanelStore((state) => state.setKopilotSession)
  const epoch = usePanelStore((state) => state.kopilotChatEpoch)

  // The stored target only counts for THIS workflow — the panel store is a
  // module singleton and survives client-side navigation between workflows.
  const stored = kopilotSession?.workflowAppId === workflowAppId ? kopilotSession : null

  // Stays enabled even once resolved: `latestSessionId` is how the fresh-chat
  // watcher tells a newly created session from the thread we already knew.
  // `retry: false` so a failure settles into "no thread yet" immediately —
  // three backed-off retries would hold the panel on its loading state for
  // several seconds with nothing to show for it.
  const sessionsQuery = api.kopilot.listSessions.useQuery(
    { workflowAppId, limit: 1 },
    { staleTime: 30_000, retry: false }
  )
  const latestSessionId = sessionsQuery.data?.items[0]?.id ?? null

  // Resolved in the SAME render the query settles in — not after a store
  // round-trip. `isPending` covers success and error alike, so a failed lookup
  // opens a fresh chat rather than leaving the panel blank.
  //
  // A workflow with no thread yet resolves to `sessionId: null`, which both
  // starts an empty chat AND arms the watcher below — so the session the server
  // creates on the first send is captured exactly like after "Start new chat".
  const target =
    stored ?? (sessionsQuery.isPending ? null : { workflowAppId, sessionId: latestSessionId })

  useEffect(() => {
    if (stored || !target) return
    setKopilotSession(target)
  }, [stored, target, setKopilotSession])

  const handleEstablished = useCallback(
    (sessionId: string) => {
      setKopilotSession({ workflowAppId, sessionId })
      // The SSE cache patch only covers the global session list, so the scoped
      // lookup would otherwise stay stale for its whole staleTime.
      void utils.kopilot.listSessions.invalidate({ workflowAppId, limit: 1 })
    },
    [workflowAppId, setKopilotSession, utils]
  )

  useFreshSessionEstablished({
    fresh: target?.sessionId === null,
    latestSessionId,
    onEstablished: handleEstablished,
  })

  // `KopilotChat` latches `initialSessionId` on its first mount, so it must not
  // mount before the lookup settles — a provisional `null` would start a new
  // session on top of an existing thread.
  if (!target) {
    return (
      <div className='flex-1 flex items-center justify-center'>
        <Loader2 className='size-4 animate-spin text-muted-foreground' />
      </div>
    )
  }

  return (
    <div className='flex-1 min-h-0 flex flex-col'>
      <KopilotChat key={epoch} page={WORKFLOW_BUILDER_PAGE} initialSessionId={target.sessionId} />
    </div>
  )
}
