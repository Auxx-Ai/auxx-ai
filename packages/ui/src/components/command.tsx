// packages/ui/src/components/command.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { Dialog, DialogContent } from '@auxx/ui/components/dialog'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Switch } from '@auxx/ui/components/switch'
import { cn } from '@auxx/ui/lib/utils'
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Command as CommandPrimitive } from 'cmdk'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  GripVertical,
  Loader2,
  Search,
  X,
} from 'lucide-react'
import type { DialogProps } from 'radix-ui'
import * as React from 'react'
import { radioGroupVariants } from './radio-group'

// --- Navigation Types ---

/**
 * Base interface for navigation items in CommandNavigation.
 * Items must have an id and label, but can include additional properties.
 */
interface NavigationItem {
  id: string
  label: string
  [key: string]: unknown
}

/**
 * Options for keyboard navigation handler.
 */
interface CommandNavigationKeyOptions<T extends NavigationItem> {
  /** Currently selected/highlighted item */
  selectedItem?: T | null
  /** Called on ArrowRight. Return true to navigate into item (will push + preventDefault) */
  onNavigateRight?: (item: T) => boolean | void
  /** Called on Enter */
  onSelect?: (item: T) => void
}

/**
 * Context value interface for CommandNavigation.
 */
interface CommandNavigationContextValue<T extends NavigationItem> {
  /** Current navigation stack */
  stack: T[]
  /** Current level item (null if at root) */
  current: T | null
  /** Whether we're at the root level */
  isAtRoot: boolean
  /** Whether global search mode is active (breadcrumb hidden, search spans all items) */
  isGlobalSearch: boolean
  /** Navigate to a new item (push to stack) */
  push: (item: T) => void
  /** Go back one level (pop from stack) */
  pop: () => void
  /** Navigate to a specific index in the stack */
  navigateTo: (index: number) => void
  /** Reset to root level */
  reset: () => void
  /** Keyboard handler for ←→Enter navigation. Call from Command's onKeyDown. */
  handleKeyDown: (e: React.KeyboardEvent, options?: CommandNavigationKeyOptions<T>) => void
}

const CommandNavigationContext = React.createContext<CommandNavigationContextValue<any> | null>(
  null
)

/**
 * Hook to access CommandNavigation context.
 * Must be used within a CommandNavigation provider.
 */
function useCommandNavigation<T extends NavigationItem>(): CommandNavigationContextValue<T> {
  const context = React.useContext(CommandNavigationContext)
  if (!context) {
    throw new Error('useCommandNavigation must be used within CommandNavigation')
  }
  return context as CommandNavigationContextValue<T>
}

/**
 * Props for CommandNavigation provider.
 */
interface CommandNavigationProps<T extends NavigationItem> {
  children: React.ReactNode
  /** Callback when navigation changes */
  onNavigationChange?: (stack: T[], current: T | null) => void
  /** Initial stack (for controlled mode) */
  defaultStack?: T[]
  /**
   * Whether global search is active.
   * When true: breadcrumb is hidden, search spans all items regardless of navigation level.
   * When false/undefined: breadcrumb stays visible, search is scoped to current level.
   */
  isGlobalSearch?: boolean
}

/**
 * CommandNavigation provider component.
 * Manages navigation stack state and provides it to child components.
 */
function CommandNavigation<T extends NavigationItem>({
  children,
  onNavigationChange,
  defaultStack = [],
  isGlobalSearch = false,
}: CommandNavigationProps<T>) {
  const [stack, setStack] = React.useState<T[]>(defaultStack)

  const current = stack.length > 0 ? stack[stack.length - 1] : null
  const isAtRoot = stack.length === 0

  const push = React.useCallback(
    (item: T) => {
      setStack((prev) => {
        const newStack = [...prev, item]
        onNavigationChange?.(newStack, item)
        return newStack
      })
    },
    [onNavigationChange]
  )

  const pop = React.useCallback(() => {
    setStack((prev) => {
      const newStack = prev.slice(0, -1)
      const newCurrent = newStack.length > 0 ? newStack[newStack.length - 1] : null
      onNavigationChange?.(newStack, newCurrent)
      return newStack
    })
  }, [onNavigationChange])

  const navigateTo = React.useCallback(
    (index: number) => {
      setStack((prev) => {
        const newStack = prev.slice(0, index + 1)
        const newCurrent = newStack.length > 0 ? newStack[newStack.length - 1] : null
        onNavigationChange?.(newStack, newCurrent)
        return newStack
      })
    },
    [onNavigationChange]
  )

  const reset = React.useCallback(() => {
    setStack([])
    onNavigationChange?.([], null)
  }, [onNavigationChange])

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent, options?: CommandNavigationKeyOptions<T>) => {
      const { selectedItem, onNavigateRight, onSelect } = options || {}

      switch (e.key) {
        case 'ArrowLeft':
          if (stack.length > 0) {
            e.preventDefault()
            pop()
          }
          break

        case 'ArrowRight':
          if (selectedItem && onNavigateRight) {
            const shouldNavigate = onNavigateRight(selectedItem)
            if (shouldNavigate) {
              e.preventDefault()
              push(selectedItem)
            }
          }
          break

        case 'Enter':
          if (selectedItem && onSelect) {
            e.preventDefault()
            onSelect(selectedItem)
          }
          break
      }
    },
    [stack.length, pop, push]
  )

  const value = React.useMemo(
    () => ({
      stack,
      current,
      isAtRoot,
      isGlobalSearch,
      push,
      pop,
      navigateTo,
      reset,
      handleKeyDown,
    }),
    [stack, current, isAtRoot, isGlobalSearch, push, pop, navigateTo, reset, handleKeyDown]
  )

  return (
    <CommandNavigationContext.Provider value={value}>{children}</CommandNavigationContext.Provider>
  )
}

/**
 * Props for CommandBreadcrumb component.
 */
interface CommandBreadcrumbProps {
  /** Label for the root level */
  rootLabel?: string
  /** Custom class name */
  className?: string
  /** Custom render function for breadcrumb items */
  renderItem?: (item: NavigationItem, index: number, isLast: boolean) => React.ReactNode
  /** Whether to show the back button */
  showBackButton?: boolean
}

/**
 * CommandBreadcrumb component.
 * Renders the breadcrumb navigation bar for CommandNavigation.
 */
function CommandBreadcrumb({
  rootLabel = 'All',
  className,
  renderItem,
  showBackButton = true,
}: CommandBreadcrumbProps) {
  const { stack, pop, navigateTo, reset, isGlobalSearch } = useCommandNavigation()

  // Hide when in global search mode or at root level
  if (isGlobalSearch || stack.length === 0) {
    return null
  }

  return (
    <div className={cn('flex items-center border-b px-2 py-1 text-sm shrink-0', className)}>
      {showBackButton && (
        <Button variant='ghost' size='icon-xs' onClick={pop}>
          <ChevronLeft />
          <span className='sr-only'>Back</span>
        </Button>
      )}

      <ScrollArea orientation='horizontal' className='flex-1'>
        <div className='flex items-center'>
          <Button variant='ghost' size='xs' className='' onClick={reset}>
            {rootLabel}
          </Button>

          {stack.map((item, index) => {
            const isLast = index === stack.length - 1
            const label = renderItem ? renderItem(item, index, isLast) : item.label
            return (
              <div key={item.id} className='flex items-center shrink-0'>
                <ChevronRight className='size-3.5 shrink-0 opacity-50' />
                {isLast ? (
                  <span className='text-xs font-medium select-none shrink-0  px-2'>{label}</span>
                ) : (
                  <Button variant='ghost' size='xs' className='' onClick={() => navigateTo(index)}>
                    {label}
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      className={cn('flex h-full w-full flex-col  rounded-2xl text-popover-foreground', className)}
      {...props}
    />
  )
}

function CommandDialog({ children, ...props }: DialogProps & { children?: React.ReactNode }) {
  return (
    <Dialog {...props}>
      <DialogContent className='overflow-hidden p-0'>
        <Command className='[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5'>
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Props for CommandInput component
 */
interface CommandInputProps extends React.ComponentProps<typeof CommandPrimitive.Input> {
  /** Show loading spinner instead of search icon */
  loading?: boolean
}

function CommandInput({
  className,
  onValueChange,
  value,
  autoFocus,
  loading = false,
  ...props
}: CommandInputProps) {
  const resetInput = React.useCallback(() => {
    onValueChange?.('')
  }, [onValueChange])
  return (
    <div
      className='flex items-center border-b border-border/50 dark:border-[#323842]/80 ps-3 pe-1'
      cmdk-input-wrapper=''>
      {loading ? (
        <Loader2 className='mr-2 size-4 shrink-0 opacity-50 animate-spin' />
      ) : (
        <Search className='mr-2 size-4 shrink-0 opacity-50' />
      )}
      <CommandPrimitive.Input
        className={cn(
          'flex h-8 w-full rounded-md bg-transparent py-1 text-sm outline-hidden placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        onValueChange={onValueChange}
        value={value}
        autoFocus={autoFocus}
        {...props}
      />

      {value && (
        <a
          onClick={resetInput}
          className='rounded-full cursor-default flex items-center justify-center hover:bg-bad-100 hover:text-bad-500 size-5 bg-primary-100 shrink-0 '>
          <X className='size-3' />
        </a>
      )}
    </div>
  )
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      className={cn('max-h-[300px] overflow-y-auto overflow-x-hidden outline-none', className)}
      {...props}
    />
  )
}

function CommandEmpty(props: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      className='relative flex cursor-default select-none items-center gap-2 rounded-full px-3 py-2 text-sm outline-hidden text-primary-400'
      {...props}
    />
  )
}

/** Manually controlled message inside a CommandList. Unlike CommandEmpty, this does not
 *  auto-show/hide based on list state — render it conditionally yourself. */
function CommandPlaceholder({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'relative flex cursor-default select-none items-center gap-2 rounded-full px-3 py-2 text-sm outline-hidden text-primary-400',
        className
      )}
      {...props}
    />
  )
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className={cn(
        'p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground',
        className
      )}
      {...props}
    />
  )
}
function CommandGroupLabel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'sticky top-0 z-10 -mt-1 -mx-1 bg-background/90 backdrop-blur-lg px-2 py-1.5 text-xs font-medium text-muted-foreground mask-b-from-80%',
        className
      )}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      className={cn('-mx-1 h-px bg-border/50 dark:bg-[#323842]/80', className)}
      {...props}
    />
  )
}
//removed per https://github.com/pacocoursey/cmdk/issues/244: data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50
function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        'relative flex min-h-7 cursor-default select-none items-center gap-2 rounded-full ps-2 pe-1 py-1 text-sm outline-hidden data-[selected=true]:ring-border-illustration  data-[selected=true]:ring-1 data-[selected=true]:bg-accent/50 dark:data-[selected=true]:bg-[#404754]/50  data-[selected=true]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
        className
      )}
      {...props}
    />
  )
}

function CommandShortcut({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn('ml-auto text-xs tracking-widest text-muted-foreground', className)}
      {...props}
    />
  )
}

/**
 * CommandDescription component.
 * Displays helper or description text within a command menu.
 */
function CommandDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('py-2 px-2 text-sm text-muted-foreground', className)} {...props} />
}

/**
 * Props for CommandNavigableItem component.
 */
interface CommandNavigableItemProps<T extends NavigationItem> {
  /** The navigation item */
  item: T
  /** Content to render inside the item */
  children: React.ReactNode
  /** Whether this item has children (shows chevron indicator) */
  hasChildren?: boolean
  /** Callback when item is selected - handles both selection and navigation logic */
  onSelect?: (item: T) => void
  /** Additional class name */
  className?: string
  /** Value for the command item */
  value?: string
}

/**
 * CommandNavigableItem component.
 * A wrapper for CommandItem that shows a chevron indicator for items with children.
 * The onSelect callback handles all interaction logic (selection, navigation, etc.)
 */
function CommandNavigableItem<T extends NavigationItem>({
  item,
  children,
  hasChildren = false,
  onSelect,
  className,
  value,
}: CommandNavigableItemProps<T>) {
  const handleSelect = React.useCallback(() => {
    onSelect?.(item)
  }, [onSelect, item])

  return (
    <CommandItem value={value || item.id} onSelect={handleSelect} className={cn('', className)}>
      <div className='flex items-center flex-row gap-1 flex-1'>{children}</div>
      {hasChildren && <ChevronRight className='size-4 text-muted-foreground' />}
    </CommandItem>
  )
}

/**
 * Props for CommandCheckboxItem component.
 */
interface CommandCheckboxItemProps {
  /** Content to render inside the item */
  children: React.ReactNode
  /** Whether the item is checked */
  checked?: boolean
  /** Callback when the item is selected (toggles checked state) */
  onCheckedChange?: (checked: boolean) => void
  /** Visual variant: checkbox, switch, or check icon */
  variant?: 'checkbox' | 'switch' | 'check'
  /** Additional class name */
  className?: string
  /** Value for the command item */
  value?: string
  /** Whether the item is disabled */
  disabled?: boolean
}

/**
 * CommandCheckboxItem component.
 * A command item with a checkbox, switch, or check icon indicator.
 * The entire row is clickable - the indicator is purely visual.
 */
function CommandCheckboxItem({
  children,
  checked = false,
  onCheckedChange,
  variant = 'checkbox',
  className,
  value,
  disabled,
}: CommandCheckboxItemProps) {
  const handleSelect = React.useCallback(() => {
    if (!disabled) {
      onCheckedChange?.(!checked)
    }
  }, [checked, onCheckedChange, disabled])

  const renderIndicator = () => {
    switch (variant) {
      case 'check':
        return checked ? (
          <Check className='size-4 text-primary-500' />
        ) : (
          <span className='size-4' /> // Spacer to maintain alignment
        )
      case 'switch':
        return <Switch checked={checked} size='xs' className='pointer-events-none' />
      case 'checkbox':
      default:
        return <Checkbox checked={checked} className='pointer-events-none' />
    }
  }

  return (
    <CommandItem
      value={value}
      onSelect={handleSelect}
      disabled={disabled}
      className={cn('flex cursor-pointer items-center justify-between', className)}>
      {children}
      {renderIndicator()}
    </CommandItem>
  )
}

// --- Sortable Components ---

/**
 * Props for CommandSortable component.
 */
interface CommandSortableProps {
  /** Array of item IDs in current order */
  items: string[]
  /** Called when items are reordered, receives new ID array */
  onReorder: (newItems: string[]) => void
  /** Disable sorting interactions */
  disabled?: boolean
  /** Children (should be CommandSortableItem components) */
  children: React.ReactNode
  /** Additional class name for the container */
  className?: string
}

/**
 * CommandSortable component.
 * Wrapper that provides drag-and-drop sorting for CommandSortableItem children.
 */
function CommandSortable({
  items,
  onReorder,
  disabled = false,
  children,
  className,
}: CommandSortableProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (over && active.id !== over.id) {
        const oldIndex = items.indexOf(String(active.id))
        const newIndex = items.indexOf(String(over.id))
        if (oldIndex !== -1 && newIndex !== -1) {
          onReorder(arrayMove(items, oldIndex, newIndex))
        }
      }
    },
    [items, onReorder]
  )

  if (disabled) {
    return <div className={className}>{children}</div>
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={handleDragEnd}>
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <div className={className}>{children}</div>
      </SortableContext>
    </DndContext>
  )
}

/**
 * Props for CommandSortableItem component.
 */
interface CommandSortableItemProps {
  /** Unique ID for sorting (must match ID in parent's items array) */
  id: string
  /** Children content */
  children: React.ReactNode
  /** Called when item is selected (via click or keyboard) */
  onSelect?: () => void
  /** Command item value (defaults to id) */
  value?: string
  /** Disable this item */
  disabled?: boolean
  /** Additional class name */
  className?: string
  /** Hide the grip handle */
  hideGrip?: boolean
}

/**
 * CommandSortableItem component.
 * A sortable item for use within CommandSortable.
 * Grip handle is on the left by default.
 */
function CommandSortableItem({
  id,
  children,
  onSelect,
  value,
  disabled,
  className,
  hideGrip = false,
}: CommandSortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <CommandItem
      ref={setNodeRef}
      style={style}
      value={value || id}
      onSelect={onSelect}
      disabled={disabled}
      className={cn(
        'flex cursor-pointer items-center gap-1',
        isDragging && 'opacity-50',
        className
      )}>
      {/* Grip handle on LEFT */}
      {!hideGrip && (
        <span
          className='shrink-0 cursor-grab touch-none text-muted-foreground hover:text-foreground'
          onClick={(e) => e.stopPropagation()}
          {...attributes}
          {...listeners}>
          <GripVertical className='size-4' />
        </span>
      )}

      {/* Item content */}
      <div className='min-w-0 flex-1 flex flex-row'>{children}</div>
    </CommandItem>
  )
}

// --- Radio Group Components ---

/**
 * Context value for CommandRadioGroup.
 */
interface CommandRadioGroupContextValue {
  value?: string
  onValueChange?: (value: string) => void
}

const CommandRadioGroupContext = React.createContext<CommandRadioGroupContextValue | null>(null)

/**
 * Hook to access CommandRadioGroup context.
 */
function useCommandRadioGroup() {
  const context = React.useContext(CommandRadioGroupContext)
  if (!context) {
    throw new Error('CommandRadioItem must be used within CommandRadioGroup')
  }
  return context
}

/**
 * Props for CommandRadioGroup component.
 */
interface CommandRadioGroupProps {
  children: React.ReactNode
  /** Currently selected value */
  value?: string
  /** Callback when selection changes */
  onValueChange?: (value: string) => void
  /** Additional class name */
  className?: string
}

/**
 * CommandRadioGroup component.
 * A group of radio items where only one can be selected at a time.
 */
function CommandRadioGroup({ children, value, onValueChange, className }: CommandRadioGroupProps) {
  const contextValue = React.useMemo(() => ({ value, onValueChange }), [value, onValueChange])

  return (
    <CommandRadioGroupContext.Provider value={contextValue}>
      <CommandGroup className={className}>{children}</CommandGroup>
    </CommandRadioGroupContext.Provider>
  )
}

/**
 * Props for CommandRadioItem component.
 */
interface CommandRadioItemProps {
  children: React.ReactNode
  /** Value for this radio item */
  value: string
  /** Whether the item is disabled */
  disabled?: boolean
  /** Additional class name */
  className?: string
  /** Visual variant: radio circle or check mark */
  variant?: 'radio' | 'check'
}

/**
 * CommandRadioItem component.
 * A radio item within a CommandRadioGroup.
 * The entire row is clickable - the indicator is purely visual.
 */
function CommandRadioItem({
  children,
  value,
  disabled,
  className,
  variant = 'radio',
}: CommandRadioItemProps) {
  const { value: groupValue, onValueChange } = useCommandRadioGroup()
  const isSelected = value === groupValue

  const handleSelect = React.useCallback(() => {
    if (!disabled) {
      onValueChange?.(value)
    }
  }, [disabled, onValueChange, value])

  const renderIndicator = () => {
    switch (variant) {
      case 'check':
        return isSelected ? <Check className='size-4 text-info' /> : <span className='size-4' />
      case 'radio':
      default:
        return (
          <span
            className={cn(
              radioGroupVariants({ variant: 'outline', size: 'default' }),
              'flex items-center justify-center '
              // !isSelected && 'border-muted-foreground'
            )}>
            {isSelected && <Circle className='size-2!' />}
          </span>
        )
    }
  }

  return (
    <CommandItem
      value={value}
      onSelect={handleSelect}
      disabled={disabled}
      className={cn('flex cursor-pointer items-center justify-between', className)}>
      {children}
      <span className='pointer-events-none'>{renderIndicator()}</span>
    </CommandItem>
  )
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandPlaceholder,
  CommandGroup,
  CommandGroupLabel,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
  CommandDescription,
  // Navigation components
  CommandNavigation,
  CommandBreadcrumb,
  CommandNavigableItem,
  // Selection components
  CommandCheckboxItem,
  CommandRadioGroup,
  CommandRadioItem,
  // Sortable components
  CommandSortable,
  CommandSortableItem,
  // Hooks
  useCommandNavigation,
  type NavigationItem,
}
