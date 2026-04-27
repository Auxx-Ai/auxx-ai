// components/global/sidebar/collapsible-sidebar-section.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { CollapsibleChevron } from '@auxx/ui/components/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import {
  SidebarGroupCollapse,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from '@auxx/ui/components/sidebar'
import { cn } from '@auxx/ui/lib/utils'
import { MoreVertical } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type MouseEvent, memo, type ReactNode, useCallback, useEffect, useState } from 'react'
import { useSidebarState } from '~/hooks/use-sidebar-state'

interface CollapsibleSidebarSectionProps {
  title: string
  icon?: ReactNode
  avatar?: ReactNode
  children: ReactNode
  isEditMode: boolean
  defaultOpen?: boolean
  count?: number
  /** @deprecated Children are now always mounted via the animated wrapper. Kept for backward compatibility. */
  alwaysShowChildren?: boolean
  href?: string
  isActive: boolean
  preventNavigation?: boolean
  /** Optional unique identifier for localStorage persistence of open/closed state */
  sectionId?: string
  /** Dropdown content rendered inside a hover-revealed More button (e.g. "Create view"). */
  actions?: ReactNode
  /** Whole-section visibility, edit-mode only. Defaults to true. */
  isVisible?: boolean
  /** Called when the edit-mode visibility checkbox is toggled. */
  onToggleVisibility?: () => void
}

function CollapsibleSidebarSectionComponent({
  title,
  icon,
  avatar,
  children,
  isEditMode,
  defaultOpen = false,
  count,
  href,
  isActive,
  preventNavigation = false,
  sectionId,
  actions,
  isVisible = true,
  onToggleVisibility,
}: CollapsibleSidebarSectionProps) {
  const router = useRouter()

  const sidebarState = useSidebarState()

  const persistedOpen = sectionId ? sidebarState.getSectionOpen(sectionId, defaultOpen) : null

  const [localOpen, setLocalOpen] = useState(defaultOpen)

  const isOpen = persistedOpen ?? localOpen

  const [actionsOpen, setActionsOpen] = useState(false)

  useEffect(() => {
    if (isEditMode && !sectionId) {
      setLocalOpen(true)
    }
  }, [isEditMode, sectionId])

  useEffect(() => {
    if (!isEditMode && !sectionId) {
      setLocalOpen((previous) => (previous === defaultOpen ? previous : defaultOpen))
    }
  }, [defaultOpen, isEditMode, sectionId])

  const toggleOpen = useCallback(() => {
    if (sectionId) {
      sidebarState.toggleSection(sectionId)
    } else {
      setLocalOpen((previous) => !previous)
    }
  }, [sectionId, sidebarState])

  const handleContainerClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      let element = event.target as HTMLElement | null
      while (element) {
        if (element.getAttribute && element.getAttribute('data-selectable') === 'false') return
        element = element.parentElement
      }

      if (preventNavigation) {
        toggleOpen()
        return
      }

      if (href) {
        router.push(href)
      }
    },
    [href, preventNavigation, router, toggleOpen]
  )

  const computedOpen = isEditMode ? true : isOpen

  // Hide the entire section when whole-section visibility is off and we're not editing.
  if (!isVisible && !isEditMode) {
    return null
  }

  const showVisibilityCheckbox = isEditMode && !!onToggleVisibility
  const showActionsButton = !!actions && !isEditMode

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild className='h-7 py-0 pe-[3px]' tooltip={title}>
        <div
          onClick={handleContainerClick}
          className={cn('group/collapsible relative cursor-pointer', {
            'font-bold': isActive,
            'opacity-50': isEditMode && !isVisible,
          })}>
          {showVisibilityCheckbox && (
            <span
              data-selectable={false}
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
              }}
              className='flex items-center'>
              <Checkbox
                checked={isVisible}
                className='border-blue-500 data-[state=checked]:border-info data-[state=checked]:bg-info'
                onCheckedChange={onToggleVisibility}
              />
            </span>
          )}

          {avatar ? avatar : icon ? <span className='[&_svg]:size-4'>{icon}</span> : null}
          <span className='group-data-[collapsible=icon]:hidden'>{title}</span>

          {!isEditMode && (
            <button
              type='button'
              data-selectable={false}
              onClick={(e) => {
                e.stopPropagation()
                toggleOpen()
              }}
              className='inline-flex items-center text-muted-foreground group-data-[collapsible=icon]:hidden'>
              <CollapsibleChevron open={isOpen} />
            </button>
          )}

          <div className='ml-auto flex items-center group-data-[collapsible=icon]:hidden'>
            {typeof count === 'number' && count > 0 && (
              <span
                className={cn(
                  'pointer-events-none text-xs text-muted-foreground',
                  showActionsButton &&
                    'transition-opacity sm:group-hover/collapsible:opacity-0 sm:absolute sm:right-[11px] sm:top-1/2 sm:-translate-y-1/2'
                )}>
                {count}
              </span>
            )}

            {showActionsButton && (
              <div
                data-selectable={false}
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                }}>
                <DropdownMenu open={actionsOpen} onOpenChange={setActionsOpen}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant='ghost'
                      size='icon'
                      className={cn(
                        'size-6 rounded-md opacity-100 sm:opacity-0 hover:bg-primary/10 hover:text-foreground/50 focus-visible:ring-primary/10 hover:bg-primary-200/50',
                        {
                          'bg-primary-200 opacity-100': actionsOpen,
                          'sm:group-hover/collapsible:opacity-100': !actionsOpen,
                        }
                      )}
                      onClick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        setActionsOpen(!actionsOpen)
                      }}>
                      <MoreVertical className='size-3.5' />
                      <span className='sr-only'>Options</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className='w-50' align='start'>
                    <DropdownMenuGroup>{actions}</DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
        </div>
      </SidebarMenuButton>

      <SidebarGroupCollapse open={computedOpen}>
        <SidebarMenuSub className={cn('me-0 pe-0', { 'mx-0 border-l-0 px-0': isEditMode })}>
          {children}
        </SidebarMenuSub>
      </SidebarGroupCollapse>
    </SidebarMenuItem>
  )
}

export const CollapsibleSidebarSection = memo(CollapsibleSidebarSectionComponent)
