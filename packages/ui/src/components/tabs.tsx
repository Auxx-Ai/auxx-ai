'use client'

import { Button } from '@auxx/ui/components/button'
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
import { SortableList } from '@auxx/ui/components/sortable'
import { Switch } from '@auxx/ui/components/switch'
import { SortableTreeRow } from '@auxx/ui/components/tree-row'
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
  extends React.ComponentProps<typeof TabsPrimitive.List>,
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
  extends React.ComponentProps<typeof TabsPrimitive.Trigger>,
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

export interface TabsBadgeProps extends React.ComponentProps<'span'> {
  /** Numeric badge value rendered inside the span */
  count?: number
}

function TabsBadge({ className, count, ...props }: TabsBadgeProps) {
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
  /**
   * Whether the viewer may hide this tab from the strip. Defaults to `true`.
   * Set `false` for a tab the surface can't function without (an Overview the
   * drawer always falls back to), so its switch stays locked on.
   */
  hideable?: boolean
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
  /** Whether tabs can be reordered and shown/hidden via the customize dialog */
  canCustomize?: boolean
  /**
   * Values of tabs the viewer has hidden. Hidden tabs are dropped from the strip
   * *and* the overflow dropdown — the customize dialog is the only way back.
   * The active tab is never filtered out, so a deep link into a hidden tab still
   * resolves (see {@link OverflowTabsListProps.value}).
   */
  hidden?: string[]
  /** Called with the full committed state when the user saves the customize dialog */
  onCustomize?: (next: { order: string[]; hidden: string[] }) => void
  /** Called when the user resets tab order and visibility to defaults */
  onReset?: () => void
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
  canCustomize,
  hidden,
  onCustomize,
  onReset,
}: OverflowTabsListProps) {
  const [customizeDialogOpen, setCustomizeDialogOpen] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const tabRefs = React.useRef<Map<string, HTMLElement>>(new Map())
  const dropdownButtonRef = React.useRef<HTMLButtonElement>(null)
  const observerRef = React.useRef<IntersectionObserver | null>(null)
  const containerWidthRef = React.useRef<number>(0)

  /**
   * The tabs the strip actually lays out and measures — `tabs` minus the hidden
   * ones. The dialog keeps rendering the full `tabs` list, since a hidden tab
   * still needs a row (and a switch) to be recoverable.
   *
   * The active tab is deliberately never filtered: a `?tab=` deep link into a
   * hidden tab reveals it in its natural position for this visit, and it drops
   * back out as soon as the viewer selects something else — no extra state, and
   * nothing written back to the caller's stored `hidden`.
   */
  const stripTabs = React.useMemo(() => {
    if (!hidden || hidden.length === 0) return tabs
    const hiddenSet = new Set(hidden)
    return tabs.filter((tab) => !hiddenSet.has(tab.value) || tab.value === value)
  }, [tabs, hidden, value])

  const [visibleTabs, setVisibleTabs] = React.useState<Set<string>>(
    new Set(stripTabs.map((t) => t.value))
  )
  const overflowTriggerVariant = (moreVariant ?? variant ?? 'default') as VariantProps<
    typeof tabsTriggerVariants
  >['variant']
  const latestTabValuesRef = React.useRef<string[]>([])
  const previousTabValuesRef = React.useRef<string[]>([])

  if (latestTabValuesRef.current.length === 0) {
    const values = stripTabs.map((tab) => tab.value)
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
    const values = stripTabs.map((tab) => tab.value)
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
  }, [stripTabs, syncVisibleTabs])

  // Calculate which tabs should be visible vs in overflow
  const { displayTabs, overflowTabs } = React.useMemo(() => {
    const display: TabDefinition[] = []
    const overflow: TabDefinition[] = []

    stripTabs.forEach((tab) => {
      if (visibleTabs.has(tab.value)) {
        display.push(tab)
      } else {
        overflow.push(tab)
      }
    })

    return { displayTabs: display, overflowTabs: overflow }
  }, [stripTabs, visibleTabs])

  // Setup IntersectionObserver to detect visible tabs
  // biome-ignore lint/correctness/useExhaustiveDependencies: stripTabs, moreClassName, overflowTriggerVariant are used as triggers to re-create observer when tab layout changes
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
  }, [stripTabs, overflowTabs.length, moreClassName, overflowTriggerVariant])

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

        {canCustomize && onCustomize && overflowTabs.length === 0 && (
          <button
            type='button'
            aria-label='Customize tabs'
            onClick={() => setCustomizeDialogOpen(true)}
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
              {canCustomize && onCustomize && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setCustomizeDialogOpen(true)}>
                    <Settings size={16} />
                    Customize tabs
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </TabsList>

      {canCustomize && onCustomize && (
        <TabCustomizeDialog
          open={customizeDialogOpen}
          onOpenChange={setCustomizeDialogOpen}
          tabs={tabs}
          hidden={hidden}
          onCustomize={onCustomize}
          onReset={onReset}
        />
      )}
    </div>
  )
}

OverflowTabsList.displayName = 'OverflowTabsList'

/**
 * Dialog for reordering tabs (drag) and showing/hiding them (switch). Both edits
 * stage locally and commit together on Save, so Cancel/Esc discards the whole
 * session and the caller only ever sees one consistent `{order, hidden}` write.
 */
function TabCustomizeDialog({
  open,
  onOpenChange,
  tabs,
  hidden,
  onCustomize,
  onReset,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tabs: TabDefinition[]
  hidden?: string[]
  onCustomize: (next: { order: string[]; hidden: string[] }) => void
  onReset?: () => void
}) {
  const [localOrder, setLocalOrder] = React.useState<string[]>([])
  const [localHidden, setLocalHidden] = React.useState<Set<string>>(new Set())
  const wasOpenRef = React.useRef(false)

  // Seed on the closed → open transition only. Re-seeding on every `tabs`/`hidden`
  // identity change would throw away edits the viewer has staged but not saved.
  React.useEffect(() => {
    if (open && !wasOpenRef.current) {
      setLocalOrder(tabs.map((t) => t.value))
      setLocalHidden(new Set(hidden))
    }
    wasOpenRef.current = open
  }, [open, tabs, hidden])

  const tabMap = React.useMemo(() => {
    const map = new Map<string, TabDefinition>()
    for (const t of tabs) map.set(t.value, t)
    return map
  }, [tabs])

  // The strip must never empty out, so the last remaining visible tab locks on.
  const visibleCount = localOrder.filter((v) => !localHidden.has(v)).length

  const toggleHidden = (value: string) => {
    setLocalHidden((prev) => {
      const next = new Set(prev)
      if (!next.delete(value)) next.add(value)
      return next
    })
  }

  const handleConfirm = () => {
    onCustomize({ order: localOrder, hidden: [...localHidden] })
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
          <DialogTitle>Customize tabs</DialogTitle>
        </DialogHeader>
        <SortableList items={localOrder} onReorder={setLocalOrder} className='space-y-0.5'>
          {localOrder.map((value) => {
            const tab = tabMap.get(value)
            if (!tab) return null
            const Icon = tab.icon
            const isVisible = !localHidden.has(value)
            const locked = tab.hideable === false || (isVisible && visibleCount <= 1)
            return (
              <SortableTreeRow
                key={value}
                id={value}
                icon={<Icon size={16} />}
                title={tab.label}
                secondary={tab.badge !== undefined ? <TabsBadge count={tab.badge} /> : undefined}
                rowClassName='bg-primary-50 hover:bg-primary-100'
                // A row click flips its switch. TreeRow's `actions` slot stops
                // propagation itself, so hitting the switch never double-toggles.
                onToggleOpen={locked ? undefined : () => toggleHidden(value)}
                actions={
                  <Switch
                    size='xs'
                    checked={isVisible}
                    disabled={locked}
                    aria-label={`Show ${tab.label} tab`}
                    onCheckedChange={() => toggleHidden(value)}
                  />
                }
              />
            )
          })}
        </SortableList>
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
