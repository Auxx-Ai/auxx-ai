// apps/web/src/components/agents/ui/detail/agent-detail-tabs.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { Tabs, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { BookOpen, Clock, FileText, Plug, Plus, ShieldCheck, Wrench, Zap } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AGENT_TABS, type AgentTab, DEFAULT_AGENT_TAB } from '../../constant'
import type { AgentDetail } from '../../store/agent-store'
import type { AutosaveState } from '../shared/autosave-indicator'
import { AgentHero } from './agent-hero'
import { KnowledgeSectionContent } from './knowledge/knowledge-section-content'
import { PersonaEditor } from './prompt/persona-editor'
import { RestrictionsSectionContent } from './restrictions/restrictions-section-content'
import { ToolSelectDialog } from './tools/tool-select-dialog'
import { ToolsSectionContent } from './tools/tools-section-content'
import { useToolsetMutations } from './tools/use-toolset-mutations'
import { TriggersSectionContent } from './triggers/triggers-section-content'

const SECTION_ICONS: Record<AgentTab, React.ComponentType<{ className?: string }>> = {
  prompt: FileText,
  tools: Wrench,
  restrictions: ShieldCheck,
  knowledge: BookOpen,
  triggers: Zap,
}

const SECTION_LABELS: Record<AgentTab, string> = {
  prompt: 'Prompt',
  tools: 'Tools',
  restrictions: 'Restrictions',
  knowledge: 'Knowledge',
  triggers: 'Triggers',
}

// Sticky tab strip height + small buffer — used as the scroll-spy activation point.
const STICKY_OFFSET = 56

interface AgentDetailTabsProps {
  agent: AgentDetail
  /** Lifted autosave state — feeds the page-header `AutosaveIndicator`. */
  onAutosaveChange?: (state: AutosaveState) => void
}

/**
 * Renders the agent detail page as a single scrollable column with a sticky
 * tab strip on top. Clicking a tab scrolls the matching section into view;
 * scrolling updates the active tab.
 */
export function AgentDetailTabs({ agent, onAutosaveChange }: AgentDetailTabsProps) {
  const [tab, setTab] = useQueryState('tab', { defaultValue: DEFAULT_AGENT_TAB })
  const [addingKind, setAddingKind] = useState<'scheduled' | 'event' | 'app' | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const sectionRefs = useRef<Record<AgentTab, HTMLDivElement | null>>({
    prompt: null,
    tools: null,
    restrictions: null,
    knowledge: null,
    triggers: null,
  })
  const isProgrammaticScrollRef = useRef(false)

  // Chat-kind agents fire from their `ChatWidget.agentId` binding, not from
  // AgentTrigger rows — there are no user-configurable triggers in v5, so the
  // Triggers tab is hidden outright. See plans/chat/v5 phase-2 §7.
  const tabs = useMemo(
    () => (agent.kind === 'chat' ? AGENT_TABS.filter((t) => t !== 'triggers') : AGENT_TABS),
    [agent.kind]
  )

  const scrollToSection = useCallback((value: string) => {
    const target = sectionRefs.current[value as AgentTab]
    const container = scrollContainerRef.current
    if (!target || !container) return
    isProgrammaticScrollRef.current = true
    const targetRect = target.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    container.scrollTo({
      top: container.scrollTop + (targetRect.top - containerRect.top) - STICKY_OFFSET,
      behavior: 'smooth',
    })
    window.setTimeout(() => {
      isProgrammaticScrollRef.current = false
    }, 700)
  }, [])

  const handleTabChange = useCallback(
    (value: string) => {
      setTab(value)
      scrollToSection(value)
    },
    [setTab, scrollToSection]
  )

  // Scroll-spy: as the user scrolls, switch the active tab to whichever
  // section is closest to the top of the viewport.
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    let raf = 0
    let lastActive: AgentTab | null = (tab as AgentTab) ?? null

    const onScroll = () => {
      if (isProgrammaticScrollRef.current) return
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const containerRect = container.getBoundingClientRect()
        const activationY = containerRect.top + STICKY_OFFSET + 8
        let best: AgentTab | null = null
        for (const t of tabs) {
          const el = sectionRefs.current[t]
          if (!el) continue
          const rect = el.getBoundingClientRect()
          if (rect.top <= activationY) best = t
        }
        if (best && best !== lastActive) {
          lastActive = best
          setTab(best)
        }
      })
    }

    container.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [setTab, tab, tabs])

  const assignRef = (value: AgentTab) => (el: HTMLDivElement | null) => {
    sectionRefs.current[value] = el
  }

  return (
    <div className='flex flex-col flex-1 min-h-0'>
      <ScrollArea
        viewportRef={scrollContainerRef}
        className='flex-1 min-h-0'
        scrollbarClassName='w-1.5 z-20'
        noFade>
        <AgentHero agent={agent} />

        <div className='sticky top-0 z-10'>
          <div className='bg-background border-b'>
            <Tabs value={tab} onValueChange={handleTabChange}>
              <TabsList className='w-full justify-start rounded-none bg-primary-150 px-2'>
                {tabs.map((value) => {
                  const Icon = SECTION_ICONS[value]
                  return (
                    <TabsTrigger key={value} value={value} variant='outline'>
                      <Icon />
                      {SECTION_LABELS[value]}
                    </TabsTrigger>
                  )
                })}
              </TabsList>
            </Tabs>
          </div>
          <div className='pointer-events-none h-3 bg-gradient-to-b from-background to-transparent' />
        </div>

        <div ref={assignRef('prompt')}>
          <Section
            title='Prompt'
            icon={<FileText className='size-4' />}
            initialOpen
            collapsible={false}>
            <PersonaEditor agent={agent} onAutosaveChange={onAutosaveChange} />
          </Section>
        </div>

        <div ref={assignRef('tools')}>
          <ToolsSection agent={agent} onAutosaveChange={onAutosaveChange} />
        </div>

        <div ref={assignRef('restrictions')}>
          <RestrictionsSection agent={agent} />
        </div>

        <div ref={assignRef('knowledge')}>
          <Section
            title='Knowledge'
            icon={<BookOpen className='size-4' />}
            className='[&>[data-slot=section]>[data-slot=section-content]]:-mx-3'
            initialOpen
            collapsible={false}>
            <KnowledgeSectionContent agent={agent} onAutosaveChange={onAutosaveChange} />
          </Section>
        </div>

        {agent.kind !== 'chat' ? (
          <div ref={assignRef('triggers')}>
            <Section
              title='Triggers'
              icon={<Zap className='size-4' />}
              className='[&>[data-slot=section]>[data-slot=section-content]]:-mx-3'
              initialOpen
              description='Autonomous triggers fire this agent on a schedule, on a record event, or on an app event.'
              collapsible={false}
              actions={
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant='ghost' size='xs'>
                      <Plus />
                      Add trigger
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end'>
                    <DropdownMenuItem onClick={() => setAddingKind('scheduled')}>
                      <Clock />
                      Scheduled
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setAddingKind('event')}>
                      <Zap />
                      Event
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setAddingKind('app')}>
                      <Plug />
                      App
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              }>
              <TriggersSectionContent
                agent={agent}
                addingKind={addingKind}
                onAddingKindChange={setAddingKind}
              />
            </Section>
          </div>
        ) : null}

        {/* Spacer so the last section can scroll up to the activation line. */}
        <div className='h-[40vh]' />
      </ScrollArea>
    </div>
  )
}

/**
 * Restrictions tab wrapper. Owns the add/edit dialog state so the "Add
 * restriction" trigger can sit in `<Section actions>` alongside Tools and
 * Triggers, while the dialog itself renders inside the section content.
 */
function RestrictionsSection({ agent }: { agent: AgentDetail }) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<{ registeredName: string; arg: string } | null>(null)
  return (
    <Section
      title='Restrictions'
      icon={<ShieldCheck className='size-4' />}
      className='[&>[data-slot=section]>[data-slot=section-content]]:-mx-3'
      initialOpen
      description='Pin or require tool arguments so this agent stays scoped — lock identity args for chat.'
      collapsible={false}
      actions={
        <Button
          variant='ghost'
          size='xs'
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}>
          <Plus />
          Add restriction
        </Button>
      }>
      <RestrictionsSectionContent
        agent={agent}
        dialogOpen={dialogOpen}
        onDialogOpenChange={setDialogOpen}
        editing={editing}
        onEditingChange={setEditing}
      />
    </Section>
  )
}

interface ToolsSectionProps {
  agent: AgentDetail
  onAutosaveChange?: (state: AutosaveState) => void
}

/**
 * Tools tab wrapper. Owns the `ToolSelectDialog` state so the "Add tools"
 * trigger can sit in `<Section actions>` while the dialog renders alongside
 * the installed-tools list.
 */
function ToolsSection({ agent, onAutosaveChange }: ToolsSectionProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [pendingAppId, setPendingAppId] = useState<string | null>(null)
  const handleSavingChange = useCallback(
    (saving: boolean) =>
      onAutosaveChange?.(saving ? { kind: 'saving' } : { kind: 'saved', at: Date.now() }),
    [onAutosaveChange]
  )
  const { toggleToolset, toggleToolsets } = useToolsetMutations(
    agent.id,
    agent.slug,
    handleSavingChange
  )
  const boundAppIds = useMemo(
    () => new Set(Object.keys(agent.appAccounts ?? {})),
    [agent.appAccounts]
  )
  return (
    <>
      <Section
        title='Tools'
        icon={<Wrench className='size-4' />}
        className='[&>[data-slot=section]>[data-slot=section-content]]:-mx-3'
        initialOpen
        collapsible={false}
        actions={
          <Button
            size='xs'
            variant='ghost'
            onClick={() => {
              setPendingAppId(null)
              setDialogOpen(true)
            }}>
            <Plus />
            Add tools
          </Button>
        }>
        <ToolsSectionContent
          agent={agent}
          onAutosaveChange={onAutosaveChange}
          onAddToApp={(appId) => {
            setPendingAppId(appId)
            setDialogOpen(true)
          }}
        />
      </Section>
      <ToolSelectDialog
        installedToolsets={agent.toolsets}
        boundAppIds={boundAppIds}
        surface={agent.kind === 'chat' ? 'chat' : undefined}
        onToggleToolset={toggleToolset}
        onToggleToolsets={toggleToolsets}
        open={dialogOpen}
        onOpenChange={(next) => {
          setDialogOpen(next)
          if (!next) setPendingAppId(null)
        }}
        initialAppId={pendingAppId ?? undefined}
      />
    </>
  )
}
