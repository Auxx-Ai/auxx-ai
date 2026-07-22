// apps/web/src/components/getting-started/ui/getting-started-group.tsx
'use client'

import type { ChecklistId } from '@auxx/lib/getting-started/client'
import { Button } from '@auxx/ui/components/button'
import { CollapsibleChevron } from '@auxx/ui/components/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@auxx/ui/components/hover-card'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Progress } from '@auxx/ui/components/progress'
import {
  SidebarGroupCollapse,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from '@auxx/ui/components/sidebar'
import { CheckCheck, ExternalLink, MoreHorizontal, Rocket, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type MouseEvent, useCallback, useRef, useState } from 'react'
import { useSidebarState } from '~/hooks/use-sidebar-state'
import { useEnv } from '~/providers/dehydrated-state-provider'
import type { GettingStartedGoal } from '../client'
import { useGettingStarted } from '../hooks/use-getting-started'
import { GettingStartedStep } from './getting-started-step'

const SECTION_ID_PREFIX = 'getting-started'

/** Stop a nested control's click from toggling the accordion header. */
function stop(e: MouseEvent) {
  e.stopPropagation()
  e.preventDefault()
}

type Props = {
  /** Which checklist's state this instance reads/writes (`main` or `dispatch`). */
  checklistId: ChecklistId
  /** Display catalog for this checklist (labels, icons, CTAs). */
  catalog: GettingStartedGoal[]
  /** Sidebar section header text. Defaults to "Getting started". */
  title?: string
}

/**
 * Inline, animated getting-started checklist pinned in a sidebar footer. The
 * header accordions the step list open/closed (height spring via
 * `SidebarGroupCollapse`). Hovering the list reveals a fixed side panel —
 * anchored to the list, matching its height — that shows the hovered step's
 * description + CTA. Auto-hides once every goal is complete or dismissed.
 * Generic over checklist (`main` in the app sidebar, `dispatch` in the
 * dispatch module sidebar) — pass the checklist id and its display catalog.
 */
export function GettingStartedGroup({ checklistId, catalog, title = 'Getting started' }: Props) {
  const router = useRouter()
  const { docsUrl } = useEnv()
  const { getSectionOpen, toggleSection } = useSidebarState()
  // Scoped per checklist so the main + dispatch widgets (visible together on
  // dispatch pages) don't share one accordion open/closed state.
  const sectionId = `${SECTION_ID_PREFIX}:${checklistId}`
  const {
    isLoading,
    goals,
    completed,
    done,
    total,
    allComplete,
    dismissed,
    markGoalComplete,
    completeAll,
    dismiss,
  } = useGettingStarted(checklistId, catalog)

  const observerRef = useRef<ResizeObserver | null>(null)
  const [panelHeight, setPanelHeight] = useState<number>()
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)

  // Callback ref: measure the whole group (header + progress + items) whenever
  // it actually mounts, and track its height as the accordion animates. Used as
  // the side panel's min-height so it aligns with the group but can grow taller
  // when its own content needs more room.
  const measureRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect()
    if (!node) return
    const update = () => setPanelHeight(node.offsetHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(node)
    observerRef.current = ro
  }, [])

  // Hidden while loading, once dismissed, or all done. (Footer = post-onboarding.)
  if (isLoading || dismissed || allComplete || total === 0) return null

  const isOpen = getSectionOpen(sectionId, true)

  // Default the panel to the first incomplete step until the user hovers one.
  const activeGoal =
    goals.find((g) => g.key === hoveredKey) ?? goals.find((g) => !completed.has(g.key)) ?? goals[0]

  const handleCTA = (goal: GettingStartedGoal) => {
    if (goal.markOnClick) markGoalComplete(goal.key)
    if (goal.external) {
      window.open(goal.href, '_blank', 'noopener,noreferrer')
      return
    }
    router.push(goal.href)
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <HoverCard openDelay={250} closeDelay={200}>
          <HoverCardTrigger asChild>
            <div ref={measureRef}>
              <SidebarMenuButton asChild tooltip={title}>
                <div
                  onClick={() => toggleSection(sectionId)}
                  className='group/gs relative h-7 cursor-pointer'>
                  <Rocket className='size-4' />
                  <span>{title}</span>
                  <CollapsibleChevron open={isOpen} className='ms-1 text-muted-foreground' />

                  <div className='ms-auto flex items-center gap-1'>
                    <span className='text-xs text-muted-foreground'>
                      {done}/{total}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant='ghost'
                          size='icon'
                          className='size-6 opacity-0 sm:group-hover/gs:opacity-100'
                          onClick={stop}>
                          <MoreHorizontal className='size-3.5' />
                          <span className='sr-only'>Getting started options</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='start' onClick={stop}>
                        <DropdownMenuItem onClick={() => completeAll()}>
                          <CheckCheck className='size-4' />
                          Mark all as complete
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => dismiss()}>
                          <X className='size-4' />
                          Dismiss
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </SidebarMenuButton>

              <SidebarGroupCollapse open={isOpen}>
                <div className='px-2 pb-1.5 pt-1'>
                  <Progress value={(done / total) * 100} indicatorClassName='bg-info' />
                </div>
                <SidebarMenuSub className='mx-0 translate-x-0 border-l-0 px-0'>
                  {goals.map((goal) => (
                    <GettingStartedStep
                      key={goal.key}
                      goal={goal}
                      completed={completed.has(goal.key)}
                      onCTA={handleCTA}
                      onHover={(g) => setHoveredKey(g.key)}
                    />
                  ))}
                </SidebarMenuSub>
              </SidebarGroupCollapse>
            </div>
          </HoverCardTrigger>
          {isOpen && activeGoal && (
            <HoverCardContent
              side='right'
              align='start'
              sideOffset={12}
              style={{ minHeight: panelHeight }}
              // Invisible bridge (`before`) spans the `sideOffset` gap so a
              // diagonal cursor path from the list to the card stays over a
              // hoverable region and the card doesn't close mid-traversal.
              className="relative flex w-64 flex-col p-3 before:absolute before:right-full before:top-0 before:h-full before:w-3 before:content-['']">
              {/* Step preview; grows to push the title + description block to the
                  bottom of the panel. Shows the goal's image when set, otherwise
                  its icon as a placeholder visual. */}
              <div className='flex min-h-24 flex-1 items-center justify-center overflow-hidden rounded-lg bg-primary-200'>
                {activeGoal.previewImage ? (
                  <img src={activeGoal.previewImage} alt='' className='size-full object-cover' />
                ) : (
                  <EntityIcon iconId={activeGoal.iconId} color={activeGoal.color} size='xl' />
                )}
              </div>
              <div className='mt-3 flex items-center gap-2'>
                <EntityIcon iconId={activeGoal.iconId} color={activeGoal.color} size='default' />
                <span className='text-sm font-medium'>{activeGoal.label}</span>
              </div>
              <p className='mt-1 text-sm text-muted-foreground'>{activeGoal.description}</p>
              <div className='mt-3 flex items-center gap-2'>
                <Button size='sm' onClick={() => handleCTA(activeGoal)}>
                  {activeGoal.ctaText}
                </Button>
                <Button size='sm' variant='outline' asChild>
                  <a
                    href={`${docsUrl}${activeGoal.docsPath}`}
                    target='_blank'
                    rel='noopener noreferrer'>
                    Learn more
                    <ExternalLink />
                  </a>
                </Button>
              </div>
            </HoverCardContent>
          )}
        </HoverCard>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

export default GettingStartedGroup
