'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandGroup,
  CommandList,
  CommandSortable,
  CommandSortableItem,
} from '@auxx/ui/components/command'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { cn } from '@auxx/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import { ChevronDown, Settings } from 'lucide-react'
import { Tabs as TabsPrimitive } from 'radix-ui'
import * as React from 'react'

const Tabs = TabsPrimitive.Root

const tabsListVariants = cva('inline-flex items-center justify-center text-muted-foreground', {
  variants: {
    variant: {
      default: 'h-9 rounded-lg bg-muted p-1',
      outline:
        'justify-start h-auto gap-1 rounded-none bg-primary-100 px-2 py-1 w-full border-b border-foreground/10',
    },
  },
  defaultVariants: { variant: 'default' },
})

export interface TabsListProps
  extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>,
    VariantProps<typeof tabsListVariants> {}

function TabsList({ className, variant, ...props }: TabsListProps) {
  return <TabsPrimitive.List className={cn(tabsListVariants({ variant, className }))} {...props} />
}
TabsList.displayName = TabsPrimitive.List.displayName

// TabsTrigger variants (similar to buttonVariants)
const tabsTriggerVariants = cva(
  'inline-flex items-center shrink-0 justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium  transition-all focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-blue-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm',
        outline:
          'text-primary-500 hover:bg-primary-200/70 hover:text-primary-900 data-[state=active]:after:bg-foreground data-[state=active]:text-primary-900 relative after:absolute after:inset-x-0 after:bottom-0 after:-mb-1 after:h-0.5  data-[state=active]:shadow-none [&>svg]:size-3.5 [&>svg]:mr-1.5 [&>svg]:opacity-70',
      },
      size: { default: 'h-7', sm: 'h-7 px-2 text-xs', lg: 'h-11 px-6 text-base' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
)

export interface TabsTriggerProps
  extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>,
    VariantProps<typeof tabsTriggerVariants> {}

function TabsTrigger({ className, variant, size, ...props }: TabsTriggerProps) {
  return (
    <TabsPrimitive.Trigger
      className={cn(tabsTriggerVariants({ variant, size, className }))}
      {...props}
    />
  )
}
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

function TabsContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn(
        'ring-offset-background focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-ring focus-visible:ring-offset-0 flex flex-col flex-1 h-full',
        className
      )}
      {...props}
    />
  )
}
TabsContent.displayName = TabsPrimitive.Content.displayName

function TabsBadge({ className, count, ...props }: React.ComponentPropsWithoutRef<'span'>) {
  return (
    <span className={cn('', className)} {...props}>
      {count}
    </span>
  )
}

TabsBadge.displayName = 'TabsBadge'

// apps/web/src/components/ui/tabs.tsx
/** TabDefinition interface for programmatic tab configuration */
export interface TabDefinition {
  /** Unique value identifier for the tab */
  value: string
  /** Display label for the tab */
  label: string
  /** Icon component to display alongside label */
  icon: React.ComponentType<{ className?: string; size?: number }>
  /** Optional badge count to display */
  badge?: number
}

/** Props for OverflowTabsList component */
export interface OverflowTabsListProps extends VariantProps<typeof tabsListVariants> {
  /** Array of tab definitions to render */
  tabs: TabDefinition[]
  /** Currently active tab value */
  value?: string
  /** Callback when tab selection changes */
  onValueChange?: (value: string) => void
  /** Additional className for the container */
  className?: string
  /** Additional className for individual tab triggers */
  tabClassName?: string
  /** Additional className for the overflow "more" trigger */
  moreClassName?: string
  /** Variant toggle for the overflow "more" trigger */
  moreVariant?: VariantProps<typeof tabsTriggerVariants>['variant']
  /** Whether tabs can be reordered via drag-and-drop dialog */
  canReorder?: boolean
  /** Called with the new tab value order when the user confirms reorder */
  onReorder?: (orderedValues: string[]) => void
  /** Called when the user resets tab order to default */
  onResetOrder?: () => void
}

/**
 * OverflowTabsList component that automatically moves overflowed tabs into a dropdown menu.
 * Uses IntersectionObserver to detect which tabs are visible and dynamically adjusts.
 * The overflow button shows "+X more" with a chevron icon.
 */
function OverflowTabsList({
  tabs,
  value,
  onValueChange,
  className,
  tabClassName,
  moreClassName,
  moreVariant,
  variant,
  canReorder,
  onReorder,
  onResetOrder,
}: OverflowTabsListProps) {
  const [reorderDialogOpen, setReorderDialogOpen] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const tabRefs = React.useRef<Map<string, HTMLElement>>(new Map())
  const dropdownButtonRef = React.useRef<HTMLButtonElement>(null)
  const observerRef = React.useRef<IntersectionObserver | null>(null)
  const containerWidthRef = React.useRef<number>(0)
  const [visibleTabs, setVisibleTabs] = React.useState<Set<string>>(
    new Set(tabs.map((t) => t.value))
  )
  const overflowTriggerVariant = (moreVariant ?? variant ?? 'default') as VariantProps<
    typeof tabsTriggerVariants
  >['variant']
  const latestTabValuesRef = React.useRef<string[]>([])
  const previousTabValuesRef = React.useRef<string[]>([])

  if (latestTabValuesRef.current.length === 0) {
    const values = tabs.map((tab) => tab.value)
    latestTabValuesRef.current = values
    previousTabValuesRef.current = values
  }

  const syncVisibleTabs = React.useCallback((values: string[]) => {
    setVisibleTabs((prev) => {
      const next = new Set(values)

      if (next.size === prev.size) {
        let differs = false
        values.forEach((value) => {
          if (!prev.has(value)) {
            differs = true
          }
        })

        if (!differs) {
          prev.forEach((value) => {
            if (!next.has(value)) {
              differs = true
            }
          })
        }

        if (!differs) {
          return prev
        }
      }

      return next
    })
  }, [])

  React.useEffect(() => {
    const values = tabs.map((tab) => tab.value)
    latestTabValuesRef.current = values

    const previousValues = previousTabValuesRef.current
    const hasSameLength = values.length === previousValues.length
    const hasSameOrder = hasSameLength
      ? values.every((value, index) => value === previousValues[index])
      : false

    if (hasSameOrder) {
      return
    }

    previousTabValuesRef.current = values
    syncVisibleTabs(values)
  }, [tabs, syncVisibleTabs])

  // Calculate which tabs should be visible vs in overflow
  const { displayTabs, overflowTabs } = React.useMemo(() => {
    const display: TabDefinition[] = []
    const overflow: TabDefinition[] = []

    tabs.forEach((tab) => {
      if (visibleTabs.has(tab.value)) {
        display.push(tab)
      } else {
        overflow.push(tab)
      }
    })

    return { displayTabs: display, overflowTabs: overflow }
  }, [tabs, visibleTabs])

  // Setup IntersectionObserver to detect visible tabs
  // biome-ignore lint/correctness/useExhaustiveDependencies: tabs, moreClassName, overflowTriggerVariant are used as triggers to re-create observer when tab layout changes
  React.useEffect(() => {
    if (!containerRef.current) return

    observerRef.current?.disconnect()

    const DROPDOWN_BUTTON_FALLBACK_WIDTH = 80
    const GAP = 8 // gap-2 = 8px
    const dropdownWidth = dropdownButtonRef.current?.offsetWidth
    const hasOverflow = overflowTabs.length > 0
    const computedDropdownWidth = hasOverflow
      ? (dropdownWidth ?? DROPDOWN_BUTTON_FALLBACK_WIDTH)
      : 0
    const rightMargin = hasOverflow ? computedDropdownWidth + GAP : 0

    const observer = new IntersectionObserver(
      (entries) => {
        setVisibleTabs((prev) => {
          let changed = false
          const next = new Set(prev)

          entries.forEach((entry) => {
            const tabValue = entry.target.getAttribute('data-tab-value')
            if (!tabValue) return

            if (entry.intersectionRatio > 0.9) {
              if (!next.has(tabValue)) {
                next.add(tabValue)
                changed = true
              }
            } else {
              if (next.delete(tabValue)) {
                changed = true
              }
            }
          })

          if (!changed) return prev
          return next
        })
      },
      {
        root: containerRef.current,
        threshold: [0, 0.5, 0.9, 1],
        rootMargin: `0px -${rightMargin}px 0px 0px`,
      }
    )

    observerRef.current = observer

    tabRefs.current.forEach((element) => {
      observer.observe(element)
    })

    return () => observer.disconnect()
  }, [tabs, overflowTabs.length, moreClassName, overflowTriggerVariant])

  // Setup ResizeObserver to re-calculate on container resize
  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return

    containerWidthRef.current = container.getBoundingClientRect().width

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return

      const newWidth = entry.contentRect.width
      const previousWidth = containerWidthRef.current
      containerWidthRef.current = newWidth

      if (newWidth > previousWidth) {
        syncVisibleTabs(latestTabValuesRef.current)
      }
    })

    resizeObserver.observe(container)

    return () => resizeObserver.disconnect()
  }, [syncVisibleTabs])

  const handleTabSelect = React.useCallback(
    (tabValue: string) => {
      onValueChange?.(tabValue)
    },
    [onValueChange]
  )

  const overflowActive = React.useMemo(
    () => overflowTabs.some((tab) => tab.value === value),
    [overflowTabs, value]
  )

  return (
    <div className={cn('w-full overflow-hidden shrink-0', className)}>
      <TabsList
        ref={containerRef}
        className={cn(
          'text-foreground justify-start mb-0 h-auto gap-2 rounded-none bg-transparent px-1 py-1 overflow-hidden w-full relative',
          variant === 'outline' && 'bg-transparent'
        )}
        variant={variant}>
        {displayTabs.map((tab) => {
          const Icon = tab.icon
          return (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              variant={variant}
              className={cn(tabClassName)}
              ref={(el) => {
                const refs = tabRefs.current
                if (el) {
                  refs.set(tab.value, el)
                  observerRef.current?.observe(el)
                } else {
                  const existing = refs.get(tab.value)
                  if (existing) {
                    observerRef.current?.unobserve(existing)
                    refs.delete(tab.value)
                  }
                }
              }}
              data-tab-value={tab.value}
              onClick={() => handleTabSelect(tab.value)}>
              <Icon className='-ms-0.5 me-1.5 opacity-60' size={16} aria-hidden='true' />
              {tab.label}
              {tab.badge !== undefined && <TabsBadge count={tab.badge} />}
            </TabsTrigger>
          )
        })}

        {canReorder && onReorder && overflowTabs.length === 0 && (
          <button
            type='button'
            onClick={() => setReorderDialogOpen(true)}
            className='ml-auto shrink-0 size-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors'>
            <Settings size={14} />
          </button>
        )}

        {overflowTabs.length > 0 && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                ref={dropdownButtonRef}
                type='button'
                className={cn(
                  tabsTriggerVariants({
                    variant: overflowTriggerVariant,
                    size: 'default',
                  }),
                  '[&>svg]:ml-1 [&>svg]:mr-0',
                  moreClassName
                )}
                data-state={overflowActive ? 'active' : undefined}>
                +{overflowTabs.length} more
                <ChevronDown aria-hidden='true' />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              {overflowTabs.map((tab) => {
                const Icon = tab.icon
                const isActive = value === tab.value
                return (
                  <DropdownMenuItem
                    key={tab.value}
                    onSelect={() => handleTabSelect(tab.value)}
                    className={cn(
                      isActive &&
                        'text-info data-[highlighted]:hover:text-info data-[highlighted]:hover:bg-accent-100/50 font-medium'
                    )}>
                    <Icon size={16} />
                    {tab.label}
                    {tab.badge !== undefined && <TabsBadge count={tab.badge} />}
                  </DropdownMenuItem>
                )
              })}
              {canReorder && onReorder && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setReorderDialogOpen(true)}>
                    <Settings size={16} />
                    Reorder tabs
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </TabsList>

      {canReorder && onReorder && (
        <TabReorderDialog
          open={reorderDialogOpen}
          onOpenChange={setReorderDialogOpen}
          tabs={tabs}
          onReorder={onReorder}
          onReset={onResetOrder}
        />
      )}
    </div>
  )
}

OverflowTabsList.displayName = 'OverflowTabsList'

/**
 * Dialog for reordering tabs via drag-and-drop
 */
function TabReorderDialog({
  open,
  onOpenChange,
  tabs,
  onReorder,
  onReset,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tabs: TabDefinition[]
  onReorder: (orderedValues: string[]) => void
  onReset?: () => void
}) {
  const [localOrder, setLocalOrder] = React.useState<string[]>([])

  React.useEffect(() => {
    if (open) {
      setLocalOrder(tabs.map((t) => t.value))
    }
  }, [open, tabs])

  const tabMap = React.useMemo(() => {
    const map = new Map<string, TabDefinition>()
    for (const t of tabs) map.set(t.value, t)
    return map
  }, [tabs])

  const handleConfirm = () => {
    onReorder(localOrder)
    onOpenChange(false)
  }

  const handleReset = () => {
    onReset?.()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='sm'>
        <DialogHeader>
          <DialogTitle>Reorder tabs</DialogTitle>
        </DialogHeader>
        <Command shouldFilter={false}>
          <CommandList>
            <CommandGroup>
              <CommandSortable items={localOrder} onReorder={setLocalOrder}>
                {localOrder.map((value) => {
                  const tab = tabMap.get(value)
                  if (!tab) return null
                  const Icon = tab.icon
                  return (
                    <CommandSortableItem key={value} id={value}>
                      <Icon className='opacity-60 me-2' size={16} />
                      <span>{tab.label}</span>
                    </CommandSortableItem>
                  )
                })}
              </CommandSortable>
            </CommandGroup>
          </CommandList>
        </Command>
        <DialogFooter>
          <Button variant='ghost' size='sm' onClick={handleReset} className='mr-auto'>
            Reset to default
          </Button>
          <Button variant='ghost' size='sm' onClick={() => onOpenChange(false)}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button variant='outline' size='sm' onClick={handleConfirm}>
            Save <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  TabsBadge,
  OverflowTabsList,
  tabsListVariants,
  tabsTriggerVariants,
}
