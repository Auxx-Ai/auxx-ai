// components/global/sidebar/collapsible-sidebar-section.tsx
'use client'

import { ReactNode, memo, useCallback, useEffect, useState, type MouseEvent } from 'react'
import { SidebarMenuItem, SidebarMenuSub } from '@auxx/ui/components/sidebar'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@auxx/ui/components/collapsible'
import { SidebarMenuButton } from '@auxx/ui/components/sidebar'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronRight } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useSidebarState } from '~/hooks/use-sidebar-state'

// CollapsibleSidebarSectionProps describes the inputs accepted by the collapsible sidebar section component.
interface CollapsibleSidebarSectionProps {
  title: string
  icon?: ReactNode
  avatar?: ReactNode
  children: ReactNode
  isEditMode: boolean
  defaultOpen?: boolean
  count?: number
  alwaysShowChildren?: boolean
  href?: string
  isActive: boolean
  preventNavigation?: boolean
  /** Optional unique identifier for localStorage persistence of open/closed state */
  sectionId?: string
}

// CollapsibleSidebarSectionComponent renders a collapsible sidebar group with optional navigation behavior and edit mode support.
function CollapsibleSidebarSectionComponent({
  title,
  icon,
  avatar,
  children,
  isEditMode,
  defaultOpen = false,
  count,
  alwaysShowChildren = false,
  href,
  isActive,
  preventNavigation = false,
  sectionId,
}: CollapsibleSidebarSectionProps) {
  const router = useRouter()

  // If sectionId is provided, use localStorage-backed state via the hook
  const sidebarState = useSidebarState()

  // Get persisted open state if sectionId is provided
  const persistedOpen = sectionId ? sidebarState.getSectionOpen(sectionId, defaultOpen) : null

  // Local state fallback for components that don't use persistence
  const [localOpen, setLocalOpen] = useState(defaultOpen)

  // Use persisted state if available, otherwise use local state
  const isOpen = persistedOpen ?? localOpen

  // Always open when in edit mode without triggering redundant renders.
  useEffect(() => {
    if (isEditMode && !sectionId) {
      setLocalOpen(true)
    }
  }, [isEditMode, sectionId])

  // Keep local state aligned with defaultOpen when the prop changes outside edit mode.
  useEffect(() => {
    if (!isEditMode && !sectionId) {
      setLocalOpen((previous) => (previous === defaultOpen ? previous : defaultOpen))
    }
  }, [defaultOpen, isEditMode, sectionId])

  // handleOpenChange stabilizes external open state updates emitted by Radix Collapsible.
  const handleOpenChange = useCallback(
    (nextState: boolean) => {
      if (sectionId) {
        sidebarState.setSectionOpen(sectionId, nextState)
      } else {
        setLocalOpen((previous) => (previous === nextState ? previous : nextState))
      }
    },
    [sectionId, sidebarState]
  )

  // handleContainerClick manages toggling open state or routing depending on navigation settings.
  const handleContainerClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      let element = event.target as HTMLElement | null
      while (element) {
        if (element.getAttribute && element.getAttribute('data-selectable') === 'false') return
        element = element.parentElement
      }

      if (preventNavigation) {
        if (sectionId) {
          sidebarState.toggleSection(sectionId)
        } else {
          setLocalOpen((previous) => !previous)
        }
        return
      }

      if (href) {
        router.push(href)
      }
    },
    [href, preventNavigation, router, sectionId, sidebarState]
  )

  const computedOpen = isEditMode ? true : isOpen
  const shouldRenderChildren = computedOpen || alwaysShowChildren

  return (
    <Collapsible open={computedOpen} onOpenChange={isEditMode ? undefined : handleOpenChange}>
      <SidebarMenuItem>
        <SidebarMenuButton asChild className="h-7 py-0" tooltip={title}>
          <div
            onClick={handleContainerClick}
            className={cn('cursor-pointer group/collapsible relative', {
              'font-bold': isActive,
              // 'bg-foreground/10': isActive,
            })}>
            <CollapsibleTrigger
              data-selectable={false}
              onClick={(e) => {
                e.stopPropagation()
              }}>
              <ChevronRight
                className={cn(
                  'size-4 transition-transform duration-200 group-data-[collapsible=icon]:hidden',
                  isOpen && 'rotate-90'
                )}
              />
            </CollapsibleTrigger>

            {avatar ? avatar : icon ? <span className="[&_svg]:size-4">{icon}</span> : null}
            <span className="group-data-[collapsible=icon]:hidden">{title}</span>
            {count ? (
              <div className="pointer-events-none absolute right-[11px] top-1/2 flex -translate-y-1/2 text-right text-xs group-hover/item:opacity-0">
                {count}
              </div>
            ) : // <Badge className="ml-auto group-data-[collapsible=icon]:hidden" variant="secondary">
            //   {count}
            // </Badge>
            null}
          </div>
        </SidebarMenuButton>

        {shouldRenderChildren && (
          <CollapsibleContent>
            <SidebarMenuSub className={cn('me-0 pe-0', { 'mx-0 border-l-0 px-0': isEditMode })}>
              {children}
            </SidebarMenuSub>
          </CollapsibleContent>
        )}
      </SidebarMenuItem>
    </Collapsible>
  )
}

// CollapsibleSidebarSection memoizes the sidebar section to avoid unnecessary rerenders driven by parent state changes.
export const CollapsibleSidebarSection = memo(CollapsibleSidebarSectionComponent)
