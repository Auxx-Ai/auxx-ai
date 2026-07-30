// apps/homepage/src/app/platform/ai/agents/_mocks/agents-browser-demo.tsx

import { ChevronRight, PanelLeft, Plus, Search } from 'lucide-react'
import { MockAppSidebar, MockBrowserChrome, MockMainPage } from '~/app/platform/ai/_mocks'
import { cn } from '~/lib/utils'
import { AGENT_CAST } from '../_components/agent-cast'
import { MockAgentCard } from './mock-agent-card'

const chat = AGENT_CAST.filter((a) => a.kind === 'chat')
const internal = AGENT_CAST.filter((a) => a.kind === 'internal')

/**
 * The hero mock: the real `/app/agents` surface.
 *
 * Mirrors `agents-page-content.tsx` (breadcrumb `Kopilot / Agents` + a
 * `New agent` action, a search toolbar) and `agents-grid-view.tsx` (the
 * `Chat agents` / `Internal agents` sections over a `ListCard` grid).
 */
export function AgentsBrowserDemo({ className }: { className?: string }) {
  return (
    <div className={cn('text-left', className)}>
      <MockBrowserChrome variant='regular' url='app.auxx.ai/app/agents'>
        <div className='flex h-[520px]'>
          <MockAppSidebar activeKey='agents' className='hidden md:flex' />
          <MockMainPage header={<MockAgentsHeader />}>
            <div className='flex h-full min-h-0 flex-col'>
              <div className='flex items-center gap-2 border-b border-mock-window-border px-3 py-2'>
                <span className='inline-flex h-7 flex-1 items-center gap-1.5 rounded-md border border-mock-window-border px-2.5 text-[11px] text-mock-window-muted'>
                  <Search className='size-3.5' />
                  Search agents
                </span>
              </div>

              <div className='flex flex-col gap-6 p-3'>
                <Section title='Chat agents' agents={chat} />
                <Section title='Internal agents' agents={internal} />
              </div>
            </div>
          </MockMainPage>
        </div>
      </MockBrowserChrome>
    </div>
  )
}

function Section({ title, agents }: { title: string; agents: typeof AGENT_CAST }) {
  return (
    <section className='flex flex-col gap-3'>
      <h3 className='text-sm font-semibold text-mock-window-muted'>{title}</h3>
      <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
        {agents.map((agent) => (
          <MockAgentCard key={agent.id} agent={agent} />
        ))}
      </div>
    </section>
  )
}

/** `MainPageHeader` with the `Kopilot / Agents` breadcrumb and the create action. */
function MockAgentsHeader() {
  return (
    <div className='flex items-center justify-between gap-3 pb-2 text-xs text-mock-window-foreground'>
      <div className='flex min-w-0 items-center gap-2 text-mock-window-muted'>
        <PanelLeft className='size-3.5 shrink-0' />
        <span className='hidden items-center gap-2 sm:flex'>
          <span>Kopilot</span>
          <ChevronRight className='size-3' />
        </span>
        <span className='truncate text-mock-window-foreground'>Agents</span>
      </div>

      <span className='inline-flex shrink-0 items-center gap-1 rounded-md bg-foreground px-2 py-1 text-background'>
        <Plus className='size-3' />
        New agent
      </span>
    </div>
  )
}
