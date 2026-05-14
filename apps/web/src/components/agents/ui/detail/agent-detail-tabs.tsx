// apps/web/src/components/agents/ui/detail/agent-detail-tabs.tsx
'use client'

import { Section } from '@auxx/ui/components/section'
import { Tabs, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { BookOpen, FileText, Wrench } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { useCallback, useEffect, useRef } from 'react'
import { AGENT_TABS, type AgentTab, DEFAULT_AGENT_TAB } from '../../constant'
import type { AgentDetail } from '../../store/agent-store'
import type { AutosaveState } from '../shared/autosave-indicator'
import { AgentHero } from './agent-hero'
import { KnowledgeSectionContent } from './tabs/knowledge-tab-placeholder'
import { PromptSectionContent } from './tabs/prompt-tab-placeholder'
import { ToolsSectionContent } from './tabs/tools-tab-placeholder'

const SECTION_ICONS: Record<AgentTab, React.ComponentType<{ className?: string }>> = {
  prompt: FileText,
  tools: Wrench,
  knowledge: BookOpen,
}

const SECTION_LABELS: Record<AgentTab, string> = {
  prompt: 'Prompt',
  tools: 'Tools',
  knowledge: 'Knowledge',
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
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const sectionRefs = useRef<Record<AgentTab, HTMLDivElement | null>>({
    prompt: null,
    tools: null,
    knowledge: null,
  })
  const isProgrammaticScrollRef = useRef(false)

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
        for (const t of AGENT_TABS) {
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
  }, [setTab, tab])

  const assignRef = (value: AgentTab) => (el: HTMLDivElement | null) => {
    sectionRefs.current[value] = el
  }

  return (
    <div className='flex flex-col flex-1 min-h-0'>
      <div ref={scrollContainerRef} className='flex-1 overflow-y-auto'>
        <AgentHero agent={agent} />

        <div className='sticky top-0 z-10 bg-background border-b'>
          <Tabs value={tab} onValueChange={handleTabChange}>
            <TabsList className='w-full justify-start rounded-none bg-primary-150 px-2'>
              {AGENT_TABS.map((value) => {
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

        <div ref={assignRef('prompt')}>
          <Section
            title='Prompt'
            icon={<FileText className='size-4' />}
            initialOpen
            collapsible={false}>
            <PromptSectionContent agent={agent} onAutosaveChange={onAutosaveChange} />
          </Section>
        </div>

        <div ref={assignRef('tools')}>
          <Section
            title='Tools'
            icon={<Wrench className='size-4' />}
            initialOpen
            collapsible={false}>
            <ToolsSectionContent agent={agent} onAutosaveChange={onAutosaveChange} />
          </Section>
        </div>

        <div ref={assignRef('knowledge')}>
          <Section
            title='Knowledge'
            icon={<BookOpen className='size-4' />}
            initialOpen
            collapsible={false}>
            <KnowledgeSectionContent agent={agent} onAutosaveChange={onAutosaveChange} />
          </Section>
        </div>

        {/* Spacer so the last section can scroll up to the activation line. */}
        <div className='h-[40vh]' />
      </div>
    </div>
  )
}
