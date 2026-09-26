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
import {
  type HTMLAttributes,
  type MouseEvent,
  memo,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useState,
} from 'react'
import { useSidebarSectionOpen, useSidebarStateActions } from '~/hooks/use-sidebar-state'

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
  /** Persists open/closed state in the shared sidebar store when set. */
  sectionId?: string
  /** Dropdown content rendered inside a hover-revealed More button (e.g. "Create view"). */
  actions?: ReactNode
  /** Whole-section visibility, edit-mode only. Defaults to true. */
  isVisible?: boolean
  /** Called when the edit-mode visibility checkbox is toggled. */
  onToggleVisibility?: () => void
  /** Ref + props for the root `<li>` (sortable bindings). */
  rootRef?: Ref<HTMLLIElement>
  rootProps?: HTMLAttributes<HTMLLIElement>
  /** Extra node rendered first inside the root `<li>` (e.g. an absolutely positioned button). */
  rootAddon?: ReactNode
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
  rootRef,
  rootProps,
  rootAddon,
}: CollapsibleSidebarSectionProps) {
  const router = useRouter()

  const { toggleSection } = useSidebarStateActions()
  const persistedOpen = useSidebarSectionOpen(sectionId, defaultOpen)
  const [localOpen, setLocalOpen] = useState(defaultOpen)
  const isOpen = sectionId ? persistedOpen : localOpen

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
      toggleSection(sectionId, defaultOpen)
    } else {
      setLocalOpen((previous) => !previous)
    }
  }, [sectionId, defaultOpen, toggleSection])

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
    <SidebarMenuItem ref={rootRef} {...rootProps}>
      {rootAddon}
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
          <span>{title}</span>

          {!isEditMode && (
            <button
              type='button'
              data-selectable={false}
              onClick={(e) => {
                e.stopPropagation()
                toggleOpen()
              }}
              className='inline-flex items-center text-muted-foreground'>
              <CollapsibleChevron open={isOpen} />
            </button>
          )}

          <div className='ml-auto flex items-center'>
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
                        'size-6 rounded-md opacity-100 sm:opacity-0 hover:bg-primary/10 hover:text-foreground/50 focus-visible:ring-primary/10 hover:bg-primary-200/50 data-[state=open]:opacity-100 data-[state=open]:bg-primary-200/50 data-[state=open]:text-foreground/50',
                        {
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
