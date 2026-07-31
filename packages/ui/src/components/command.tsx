// packages/ui/src/components/command.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { EntityIcon } from '@auxx/ui/components/icons'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { SortableList } from '@auxx/ui/components/sortable'
import { Switch } from '@auxx/ui/components/switch'
import { TooltipExplanation } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import { ScrollArea as BaseScrollArea } from '@base-ui-components/react/scroll-area'
import { useSortable } from '@dnd-kit/sortable'
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
  Send,
  X,
} from 'lucide-react'
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
 * Hook to optionally access CommandNavigation context — returns `null` when
 * there is no surrounding provider. Use this from a picker content component
 * that wants to reuse the parent's nav stack if available, or fall back to
 * wrapping itself in its own `CommandNavigation`.
 */
function useCommandNavigationOptional<
  T extends NavigationItem,
>(): CommandNavigationContextValue<T> | null {
  const context = React.useContext(CommandNavigationContext)
  return context as CommandNavigationContextValue<T> | null
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
      className={cn(
        'flex h-full w-full flex-col  rounded-2xl text-popover-foreground',
        // When there's no CommandInput above the list, the list sits flush at the
        // top — round its top corners to the container radius so its overflow-clip
        // trims the first group's sticky label to match (no square corner poke).
        '[&:not(:has([cmdk-input-wrapper]))>[data-slot=command-list]]:rounded-t-[inherit]',
        className
      )}
      {...props}
    />
  )
}

function CommandDialog({
  children,
  title = 'Command palette',
  description = 'Search and run commands.',
  shouldFilter,
  filter,
  ...props
}: React.ComponentProps<typeof Dialog> &
  Pick<React.ComponentProps<typeof Command>, 'shouldFilter' | 'filter'> & {
    children?: React.ReactNode
    title?: string
    description?: string
  }) {
  return (
    <Dialog {...props}>
      <DialogContent className='overflow-hidden p-0' position='tc' innerClassName='p-0'>
        <DialogHeader className='sr-only'>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Command
          shouldFilter={shouldFilter}
          filter={filter}
          className='[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-8 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5'>
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
      className='flex shrink-0 items-center border-b border-border/50 dark:border-[#323842]/80 ps-3 pe-1'
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

interface CommandInputWithSubmitProps
  extends Omit<
    React.ComponentProps<typeof CommandPrimitive.Input>,
    'value' | 'onValueChange' | 'onSubmit'
  > {
  value: string
  onValueChange: (value: string) => void
  /** Fires on Enter (when non-empty) and on the send button. */
  onSubmit: (value: string) => void
  /** Fires on Escape — e.g. to step back a level. */
  onEscape?: () => void
  /** Leading icon slot. Defaults to nothing. */
  leftIcon?: React.ReactNode
  /** Swap the send icon for a spinner and block submit. */
  loading?: boolean
}

/**
 * A {@link CommandInput} variant with an inline submit button — for prompt-style
 * inputs where the typed text is an instruction to run, not a filter. Pair with
 * `<Command shouldFilter={false}>` so the list below stays static. Enter (when
 * non-empty) and the send button both call `onSubmit`; an empty Enter falls
 * through to cmdk so the highlighted item is selected instead.
 */
function CommandInputWithSubmit({
  className,
  value,
  onValueChange,
  onSubmit,
  onEscape,
  leftIcon,
  loading = false,
  ...props
}: CommandInputWithSubmitProps) {
  const canSubmit = !!value.trim() && !loading
  return (
    <div
      className='flex items-center gap-2 border-b border-border/50 dark:border-[#323842]/80 ps-3 pe-2'
      cmdk-input-wrapper=''>
      {leftIcon}
      <CommandPrimitive.Input
        className={cn(
          'flex h-9 w-full rounded-md bg-transparent py-1 text-sm outline-hidden placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        onValueChange={onValueChange}
        value={value}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && canSubmit) {
            // Stop cmdk from also selecting the highlighted item.
            e.preventDefault()
            e.stopPropagation()
            onSubmit(value.trim())
          } else if (e.key === 'Escape' && onEscape) {
            e.preventDefault()
            onEscape()
          }
        }}
        {...props}
      />
      <button
        type='button'
        aria-label='Run'
        disabled={!canSubmit}
        onClick={() => canSubmit && onSubmit(value.trim())}
        className='grid size-6 shrink-0 place-items-center rounded-full bg-primary-500 text-white transition-colors hover:bg-primary-600 disabled:bg-muted disabled:text-muted-foreground'>
        {loading ? <Loader2 className='size-3 animate-spin' /> : <Send className='size-3' />}
      </button>
    </div>
  )
}

interface CommandListProps extends React.ComponentProps<typeof CommandPrimitive.List> {
  /**
   * Classes for the ScrollArea Root that owns sizing/clipping. Use this to
   * override the default `max-h-[300px]` height cap — `className` lands on the
   * inner cmdk list, where height utilities are a dead letter.
   */
  scrollAreaClassName?: string
  /** Styles for the ScrollArea Root. Use this for dynamic `maxHeight` values. */
  scrollAreaStyle?: React.CSSProperties
}

function CommandList({
  className,
  scrollAreaClassName,
  scrollAreaStyle,
  style,
  ...props
}: CommandListProps) {
  // `data-slot='command-list'` is on the outer scroll-area Root so a parent can
  // target it from a Tailwind className with a descendant selector, e.g.
  // `[&_[data-slot=command-list]]:h-[288px]` to pin the list to a fixed height.
  // The default cap is `max-h-[300px]`; raise/drop it via `scrollAreaClassName`.
  return (
    <BaseScrollArea.Root
      data-slot='command-list'
      className={cn('relative max-h-[300px] overflow-hidden', scrollAreaClassName)}
      style={scrollAreaStyle}>
      <BaseScrollArea.Viewport
        className='h-full max-h-[inherit] w-full overscroll-contain scroll-area-fade outline-none'
        style={{ overflowX: 'hidden' }}>
        <BaseScrollArea.Content style={{ minWidth: undefined }}>
          <CommandPrimitive.List
            className={cn('outline-none', className)}
            style={{ overflow: 'visible', maxHeight: 'none', ...style }}
            {...props}
          />
        </BaseScrollArea.Content>
      </BaseScrollArea.Viewport>
      <BaseScrollArea.Scrollbar
        orientation='vertical'
        className={cn(
          'flex justify-center w-1 rounded-md my-1 mr-0.5',
          'opacity-0 transition-opacity duration-150',
          'data-[scrolling]:opacity-100 data-[scrolling]:transition-none',
          'data-[hovering]:opacity-100',
          'before:content-[""] before:absolute before:w-5 before:h-full'
        )}>
        <BaseScrollArea.Thumb className='w-full rounded-[inherit] bg-foreground/20' />
      </BaseScrollArea.Scrollbar>
    </BaseScrollArea.Root>
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

/** Centered spinner + message for use inside a CommandList while data is fetching.
 *  Render it conditionally yourself (it does not auto-show/hide). */
function CommandLoading({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground',
        className
      )}
      {...props}>
      <Loader2 className='size-4 animate-spin' />
      {children}
    </div>
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
      data-slot='command-group-label'
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

/**
 * Props for {@link CommandDetailItem}.
 */
interface CommandDetailItemProps {
  /** EntityIcon id — rendered as the leading icon unless `icon` is provided. */
  iconId?: string
  /** EntityIcon color id (e.g. `'blue'`). Ignored when `icon` is set. */
  color?: string
  /**
   * Leading visual that overrides the EntityIcon — use for `AppIcon` avatars
   * (URLs, emoji) or any custom node the `iconId`/`color` pair can't express.
   */
  icon?: React.ReactNode
  /** Primary label (truncates when the row is tight). */
  title: string
  /** Surfaced through a `TooltipExplanation` help icon next to the title. */
  description?: string
  /** Inline slot after the title — typically a `<Badge>`. */
  secondary?: React.ReactNode
  /** Right-aligned slot — e.g. a price. Style it yourself. */
  trailing?: React.ReactNode
  /** Right-aligned slot revealed on hover/focus — e.g. icon buttons. */
  actions?: React.ReactNode
  /**
   * Absolutely-positioned slot that slides in from the row's right edge — pass a
   * `RowSlideActions`. Adds `relative overflow-hidden` to the row when present.
   */
  slideActions?: React.ReactNode
  /** How the leading visual is framed. `'tile'` wraps it in a bordered square. */
  iconVariant?: 'plain' | 'tile'
  /** Whether this row is the selected one — drives `selectionMode`. */
  selected?: boolean
  /** Selection indicator rendered at the row's right edge. Defaults to `'none'`. */
  selectionMode?: 'check' | 'checkbox' | 'none'
  /** Feeds cmdk selection/filtering. */
  value: string
  /** Fires on click / Enter. */
  onSelect?: () => void
  disabled?: boolean
  className?: string
}

/**
 * A richer {@link CommandItem} for pickers that need more than an icon and a
 * label: a leading `EntityIcon` (from `iconId`/`color`, or an `icon` override,
 * optionally framed as a tile), a primary `title`, an optional `description`
 * shown via a `TooltipExplanation` help icon, an inline `secondary` slot (e.g. a
 * Badge), a right-aligned `trailing` slot (e.g. a price), `actions` revealed on
 * hover/focus, a `selectionMode` indicator, and a sliding `slideActions` slot.
 */
function CommandDetailItem({
  iconId,
  color,
  icon,
  title,
  description,
  secondary,
  trailing,
  actions,
  slideActions,
  iconVariant = 'plain',
  selected = false,
  selectionMode = 'none',
  value,
  onSelect,
  disabled,
  className,
}: CommandDetailItemProps) {
  const leading = icon ?? (iconId ? <EntityIcon iconId={iconId} color={color} size='sm' /> : null)
  const framedLeading =
    leading && iconVariant === 'tile' ? (
      <span className='flex size-5 shrink-0 items-center justify-center rounded-sm border'>
        {leading}
      </span>
    ) : (
      leading
    )
  const indicator =
    selectionMode === 'checkbox' ? (
      <Checkbox checked={selected} className='pointer-events-none' />
    ) : selectionMode === 'check' && selected ? (
      <div className='rounded-full size-4 bg-info flex items-center justify-center border border-blue-800'>
        <Check className='size-2.5! text-white' strokeWidth={4} />
      </div>
    ) : null
  return (
    <CommandItem
      value={value}
      onSelect={onSelect}
      disabled={disabled}
      className={cn(
        'group/cmd-item flex items-center gap-2',
        slideActions && 'relative overflow-hidden',
        className
      )}>
      {framedLeading && <span className='shrink-0 text-muted-foreground'>{framedLeading}</span>}
      <div className='flex min-w-0 flex-1 items-center gap-1.5'>
        <span className='min-w-0 truncate text-sm'>{title}</span>
        {description && <TooltipExplanation text={description} className='shrink-0' />}
        {/* `[&>*]:ring-0` — Badge's base applies `ring-1 ring-current/35` to every
            variant, which reads as a heavy outline on a dense row. Stripped here
            so callers get a clean chip without restating it at every call site. */}
        {secondary && <span className='min-w-0 shrink truncate [&>*]:ring-0'>{secondary}</span>}
      </div>
      {(trailing || actions || indicator) && (
        // With `slideActions`, the static cluster fades out as the slider comes
        // in — the slider's background is deliberately translucent (it matches
        // the row's own selected fill), so anything left underneath ghosts
        // through and reads as noise. Timed to match `RowSlideActions`.
        // `actions` and `slideActions` are not meant to be combined: put
        // hover-revealed controls in the slider, not in `actions`.
        <div
          className={cn(
            'flex shrink-0 items-center gap-1',
            slideActions &&
              'transition-opacity duration-200 ease-out group-hover/cmd-item:opacity-0 group-focus-within/cmd-item:opacity-0'
          )}>
          {trailing}
          {actions && (
            <span className='flex items-center gap-1 opacity-0 transition-opacity group-hover/cmd-item:opacity-100 focus-within:opacity-100'>
              {actions}
            </span>
          )}
          {indicator}
        </div>
      )}
      {slideActions}
    </CommandItem>
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
  /**
   * Stamp `data-drilldown` so a focusless host (chip-driven `/` menus) can
   * ArrowRight-drill this row via `useCmdkRemote.drillHighlighted`. Independent
   * of `hasChildren`, which only controls the visible chevron.
   */
  drillDown?: boolean
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
  drillDown,
}: CommandNavigableItemProps<T>) {
  const handleSelect = React.useCallback(() => {
    onSelect?.(item)
  }, [onSelect, item])

  return (
    <CommandItem
      value={value || item.id}
      onSelect={handleSelect}
      className={cn('', className)}
      data-drilldown={drillDown ? '' : undefined}>
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
 * Thin alias over the shared {@link SortableList} container.
 */
function CommandSortable(props: CommandSortableProps) {
  return <SortableList {...props} />
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
        return isSelected ? (
          <div className='flex size-4 items-center justify-center rounded-full border border-blue-800 bg-info'>
            <Check className='size-2.5! text-white' strokeWidth={4} />
          </div>
        ) : (
          <span className='size-4' />
        )
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
  CommandInputWithSubmit,
  CommandList,
  CommandEmpty,
  CommandPlaceholder,
  CommandLoading,
  CommandGroup,
  CommandGroupLabel,
  CommandItem,
  CommandDetailItem,
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
  useCommandNavigationOptional,
  type NavigationItem,
}
