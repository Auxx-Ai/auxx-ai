// apps/web/src/components/getting-started/ui/getting-started-group.tsx
'use client'

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
import { CheckCheck, MoreHorizontal, Rocket, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type MouseEvent, useCallback, useRef, useState } from 'react'
import { useSidebarState } from '~/hooks/use-sidebar-state'
import type { GettingStartedGoal } from '../client'
import { useGettingStarted } from '../hooks/use-getting-started'
import { GettingStartedStep } from './getting-started-step'

const SECTION_ID = 'getting-started'

/** Stop a nested control's click from toggling the accordion header. */
function stop(e: MouseEvent) {
  e.stopPropagation()
  e.preventDefault()
}

/**
 * Inline, animated getting-started checklist pinned in the sidebar footer. The
 * header accordions the step list open/closed (height spring via
 * `SidebarGroupCollapse`). Hovering the list reveals a fixed side panel —
 * anchored to the list, matching its height — that shows the hovered step's
 * description + CTA. Auto-hides once every goal is complete or dismissed.
 */
export function GettingStartedGroup() {
  const router = useRouter()
  const { getSectionOpen, toggleSection } = useSidebarState()
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
  } = useGettingStarted()

  const observerRef = useRef<ResizeObserver | null>(null)
  const [panelHeight, setPanelHeight] = useState<number>()
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)

  // Callback ref: measure the whole group (header + progress + items) whenever
  // it actually mounts, and track its height as the accordion animates. Used to
  // make the side panel exactly as tall as the group.
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

  const isOpen = getSectionOpen(SECTION_ID, true)

  // Default the panel to the first incomplete step until the user hovers one.
  const activeGoal =
    goals.find((g) => g.key === hoveredKey) ?? goals.find((g) => !completed.has(g.key)) ?? goals[0]
  const activeCompleted = !!activeGoal && completed.has(activeGoal.key)

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
        <HoverCard openDelay={60} closeDelay={80}>
          <HoverCardTrigger asChild>
            <div ref={measureRef}>
              <SidebarMenuButton asChild tooltip='Getting started'>
                <div
                  onClick={() => toggleSection(SECTION_ID)}
                  className='group/gs relative h-7 cursor-pointer'>
                  <Rocket className='size-4' />
                  <span className='group-data-[collapsible=icon]:hidden'>Getting started</span>
                  <CollapsibleChevron open={isOpen} className='ms-1 text-muted-foreground' />

                  <div className='ms-auto flex items-center gap-1 group-data-[collapsible=icon]:hidden'>
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

              <SidebarGroupCollapse open={isOpen} className='group-data-[collapsible=icon]:hidden'>
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
              style={{ height: panelHeight }}
              className='flex w-64 flex-col p-3'>
              <div className='flex items-center gap-2'>
                <EntityIcon iconId={activeGoal.iconId} color={activeGoal.color} size='default' />
                <span className='text-sm font-medium'>{activeGoal.label}</span>
              </div>
              <p className='mt-2 text-sm text-muted-foreground'>{activeGoal.description}</p>
              <Button
                size='sm'
                variant={activeCompleted ? 'outline' : 'default'}
                className='mt-auto w-full'
                onClick={() => handleCTA(activeGoal)}>
                {activeCompleted ? 'Done' : activeGoal.ctaText}
              </Button>
            </HoverCardContent>
          )}
        </HoverCard>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

export default GettingStartedGroup
