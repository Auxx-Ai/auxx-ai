// apps/web/src/components/agents/ui/detail/agent-detail-tabs.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { NavStack, NavStackBar, NavStackPanel, NavStackPanels } from '@auxx/ui/components/nav-stack'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { Tabs, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import {
  BookOpen,
  CircleHelp,
  Clock,
  FileText,
  ListChecks,
  Lock,
  Plug,
  Plus,
  ShieldCheck,
  Wrench,
  Zap,
} from 'lucide-react'
import { useQueryState } from 'nuqs'
import { useCallback, useMemo, useState } from 'react'
import { useScrollSpy } from '~/hooks/use-scroll-spy'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { AGENT_TABS, type AgentTab, DEFAULT_AGENT_TAB } from '../../constant'
import { usePersonaRealtime } from '../../hooks/use-persona-realtime'
import { useProcedureRealtime } from '../../procedures/hooks/use-procedure-realtime'
import { ProcedureDetailBar } from '../../procedures/ui/procedure-detail-bar'
import { ProcedureDraftProvider } from '../../procedures/ui/procedure-draft-provider'
import { ProcedureDrillPanel } from '../../procedures/ui/procedure-drill-panel'
import { ProcedureEditor } from '../../procedures/ui/procedure-editor'
import { ProceduresSection } from '../../procedures/ui/procedures-section'
import type { AgentDetail } from '../../store/agent-store'
import type { AutosaveState } from '../shared/autosave-indicator'
import { AgentGuideDialog } from './agent-guide-dialog'
import { AgentHero } from './agent-hero'
import { AgentPermissionsSection } from './agent-permissions-section'
import { BindingsSection } from './bindings/bindings-section'
import { KnowledgeSectionContent } from './knowledge/knowledge-section-content'
import { PersonaEditor } from './prompt/persona-editor'
import { ToolsSection } from './tools/tools-section'
import { TriggersSectionContent } from './triggers/triggers-section-content'

const SECTION_ICONS: Record<AgentTab, React.ComponentType<{ className?: string }>> = {
  prompt: FileText,
  tools: Wrench,
  restrictions: ShieldCheck,
  knowledge: BookOpen,
  procedures: ListChecks,
  triggers: Zap,
  permissions: Lock,
}

const SECTION_LABELS: Record<AgentTab, string> = {
  prompt: 'Prompt',
  tools: 'Tools',
  restrictions: 'Bindings',
  knowledge: 'Knowledge',
  procedures: 'Procedures',
  triggers: 'Triggers',
  permissions: 'Permissions',
}

// The tab strip lives in <NavStackBar>, OUTSIDE/above the ScrollArea viewport, so the
// viewport's top edge already starts below the tabs — no offset is needed to land a
// section flush at the top. Kept at 0; only the scroll-spy line adds a tiny buffer.
const SCROLL_BUFFER = 0
// Activate a tab once its section crosses just past the top edge.
const SPY_BUFFER = 8

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
  // The outer NavStack is a three-level drill: root → procedure → drilled body.
  //   selectedProcedureId set  ⇒ push 'procedure'
  //   drill set (sub:/code:)   ⇒ push 'drill' (a sub-procedure or code body)
  const [selectedProcedureId, setSelectedProcedureId] = useQueryState('procedure')
  const [drill, setDrill] = useQueryState('drill')
  const [addingKind, setAddingKind] = useState<'scheduled' | 'event' | 'source' | null>(null)
  const [guideOpen, setGuideOpen] = useState(false)
  // Lifted from the pushed ProcedureEditor so the detail bar (rendered by
  // <NavStackBar>, a separate subtree) can show live Saving…/Saved next to Publish.
  const [procedureAutosave, setProcedureAutosave] = useState<AutosaveState>({ kind: 'idle' })
  // Reload token — bumped by the publish cluster after revert/discard (which
  // rewrite the draft doc server-side) to remount the editor onto the fresh doc.
  const [procedureReloadKey, setProcedureReloadKey] = useState(0)

  // Remount the open editor when Kopilot rewrites its draft server-side
  // (`procedure:updated`); fires only after the refetch resolves so the
  // re-seed reads the fresh doc, not the stale cache.
  useProcedureRealtime({
    selectedProcedureId,
    onExternalDraftChange: useCallback(() => setProcedureReloadKey((k) => k + 1), []),
  })

  // Same pattern for the seed-once persona editor: Kopilot's `set_agent_prompt`
  // writes the prompt server-side, so remount it onto the fresh doc once the
  // refetch resolves. The author's own autosave is socket-excluded server-side.
  const [personaReloadKey, setPersonaReloadKey] = useState(0)
  usePersonaRealtime({
    agentId: agent.id,
    onExternalPromptChange: useCallback(() => setPersonaReloadKey((k) => k + 1), []),
  })
  // Procedures is a beta feature gated per-plan: hide the tab + section outright
  // for orgs without the `agentProcedures` entitlement (backend mutations also
  // enforce it). Self-hosted is unlimited, so the gate is a no-op there.
  const { hasAccess } = useFeatureFlags()
  const canProcedures = hasAccess(FeatureKey.agentProcedures)

  // Chat-kind agents fire from their `ChatWidget.agentId` binding, not from
  // AgentTrigger rows — there are no user-configurable triggers in v5, so the
  // Triggers tab is hidden outright. See plans/chat/v5 phase-2 §7.
  const tabs = useMemo(
    () =>
      AGENT_TABS.filter(
        (t) => (t !== 'triggers' || agent.kind !== 'chat') && (t !== 'procedures' || canProcedures)
      ),
    [agent.kind, canProcedures]
  )

  // Scroll-spy mechanism is shared with other detail pages (see use-scroll-spy).
  // `remountKey` re-binds the listener after the root ScrollArea remounts on
  // return from a procedure/drill panel (NavStackPanels only mounts the top panel).
  const { scrollContainerRef, assignRef, scrollToSection } = useScrollSpy<AgentTab>({
    sections: tabs,
    active: (tab as AgentTab) ?? DEFAULT_AGENT_TAB,
    onActiveChange: setTab,
    remountKey: `${selectedProcedureId}:${drill}`,
    spyBuffer: SPY_BUFFER,
    scrollBuffer: SCROLL_BUFFER,
  })

  const handleTabChange = useCallback(
    (value: string) => {
      // The tab strip is only the root panel's bar, so this fires at root — clearing
      // the drill params is defensive. Scroll the chosen section into view.
      void setSelectedProcedureId(null)
      void setDrill(null)
      setTab(value)
      scrollToSection(value as AgentTab)
    },
    [setTab, setSelectedProcedureId, setDrill, scrollToSection]
  )

  const stack = !selectedProcedureId
    ? ['root']
    : !drill
      ? ['root', 'procedure']
      : ['root', 'procedure', 'drill']

  const detailBar = selectedProcedureId ? (
    <ProcedureDetailBar
      procedureId={selectedProcedureId}
      autosave={procedureAutosave}
      onReload={() => setProcedureReloadKey((k) => k + 1)}
    />
  ) : null

  // Bounded-flex layout (§3a): the parent PanelFrame already constrains height, so we
  // derive everything from the flex chain (no `dvh`). The hero is pinned above the
  // NavStack; the shared bar is `shrink-0`; the panels fill the rest and EACH owns its
  // scroll (a code drill needs a full-height, internally-scrolling Monaco — an outer
  // page scroll can't bound it). The draft owner is lifted ABOVE the NavStack so it
  // survives procedure↔drill switches; keyed per procedure (+ reload token) to re-seed.
  return (
    <div className='flex flex-col flex-1 min-h-0'>
      <AgentHero agent={agent} />
      <ProcedureDraftProvider
        procedureId={selectedProcedureId}
        reloadKey={procedureReloadKey}
        onAutosaveChange={setProcedureAutosave}>
        <NavStack
          stack={stack}
          onStackChange={(next) => {
            if (next.length <= 1) {
              void setSelectedProcedureId(null)
              void setDrill(null)
            } else if (next.length === 2) {
              void setDrill(null)
            }
          }}
          className='flex flex-col flex-1 min-h-0'>
          <NavStackBar className='shrink-0 border-b bg-primary-150' />
          <NavStackPanels className='flex-1 min-h-0'>
            <NavStackPanel
              value='root'
              className='h-full bg-neutral-100 dark:bg-background'
              bar={
                <Tabs value={tab} onValueChange={handleTabChange}>
                  <TabsList className='w-full justify-start rounded-none bg-transparent px-2'>
                    {tabs.map((value) => {
                      const Icon = SECTION_ICONS[value]
                      return (
                        <TabsTrigger key={value} value={value} variant='outline'>
                          <Icon />
                          {SECTION_LABELS[value]}
                        </TabsTrigger>
                      )
                    })}
                    <Button
                      variant='ghost'
                      size='xs'
                      className='ml-auto'
                      onClick={() => setGuideOpen(true)}>
                      <CircleHelp />
                      Guide
                    </Button>
                  </TabsList>
                </Tabs>
              }>
              <ScrollArea
                viewportRef={scrollContainerRef}
                className='h-full'
                scrollbarClassName='w-1.5 z-20'
                noFade>
                <div ref={assignRef('prompt')}>
                  <Section
                    title='Prompt'
                    icon={<FileText className='size-4' />}
                    initialOpen
                    collapsible={false}>
                    <PersonaEditor
                      key={personaReloadKey}
                      agent={agent}
                      onAutosaveChange={onAutosaveChange}
                    />
                  </Section>
                </div>

                {canProcedures ? (
                  <div ref={assignRef('procedures')}>
                    <ProceduresSection agent={agent} onSelect={setSelectedProcedureId} />
                  </div>
                ) : null}

                <div ref={assignRef('tools')}>
                  <ToolsSection agent={agent} onAutosaveChange={onAutosaveChange} />
                </div>

                <div ref={assignRef('restrictions')}>
                  <BindingsSection agent={agent} />
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
                            <DropdownMenuItem onClick={() => setAddingKind('source')}>
                              <Plug />
                              App or webhook
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

                <div ref={assignRef('permissions')}>
                  <AgentPermissionsSection agent={agent} />
                </div>

                {/* Spacer so the last section can scroll up to the activation line. */}
                <div className='h-[40vh]' />
              </ScrollArea>
            </NavStackPanel>

            <NavStackPanel
              value='procedure'
              className='h-full bg-neutral-100 dark:bg-background'
              bar={detailBar}>
              <ScrollArea className='h-full' scrollbarClassName='w-1.5 z-20' noFade>
                {selectedProcedureId ? (
                  <ProcedureEditor key={`${selectedProcedureId}:${procedureReloadKey}`} />
                ) : null}
              </ScrollArea>
            </NavStackPanel>

            <NavStackPanel
              value='drill'
              className='h-full flex flex-col bg-neutral-100 dark:bg-background'
              bar={detailBar}>
              {/* Keyed by the drill target (+ procedure / reload token) so switching the
                  drilled body remounts the editor onto the fresh slice. */}
              <ProcedureDrillPanel key={`${selectedProcedureId}:${drill}:${procedureReloadKey}`} />
            </NavStackPanel>
          </NavStackPanels>
        </NavStack>
      </ProcedureDraftProvider>
      {guideOpen && (
        <AgentGuideDialog
          open={guideOpen}
          onOpenChange={setGuideOpen}
          canProcedures={canProcedures}
          isChat={agent.kind === 'chat'}
        />
      )}
    </div>
  )
}
