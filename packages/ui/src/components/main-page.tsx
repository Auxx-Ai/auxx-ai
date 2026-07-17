'use client'

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@auxx/ui/components/breadcrumb'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { SidebarTrigger } from '@auxx/ui/components/sidebar'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import Link from 'next/link'
import React from 'react'
import { createPortal } from 'react-dom'
import { PanelFrame } from './panel-frame'
import { PanelResizeHandle } from './panel-resize-handle'

/**
 * apps/web/src/components/ui/main-page.tsx
 * MainPageContext and MainPageProvider for managing main page state (e.g., loading,
 * and the header's action/breadcrumb portal targets).
 */
interface MainPageContextProps {
  /**
   * Loading state for the main page.
   */
  loading: boolean
  /** Portal target for `<MainPageAction>` — the header's action cluster, once mounted. */
  actionsEl: HTMLElement | null
  /** Portal target for `<MainPageCrumbs>` — the breadcrumb `<ol>`, once mounted. */
  crumbsEl: HTMLElement | null
  /** Registers the action cluster element. Pass directly as a ref callback. */
  setActionsEl: (el: HTMLElement | null) => void
  /** Registers the breadcrumb list element. Pass directly as a ref callback. */
  setCrumbsEl: (el: HTMLElement | null) => void
}

const MainPageContext = React.createContext<MainPageContextProps | undefined>(undefined)

const noopSetEl = (_el: HTMLElement | null) => {}

/**
 * MainPageProvider component to provide MainPageContext to children. Owns the
 * portal-target elements for `<MainPageAction>`/`<MainPageCrumbs>` as plain
 * `useState` pairs — no effects needed, the setters double as stable ref
 * callbacks for `MainPageHeader`/`MainPageBreadcrumb` to register into.
 * @param loading - loading state for the main page
 * @param children - React children
 */
export const MainPageProvider: React.FC<{ loading: boolean; children: React.ReactNode }> = ({
  loading,
  children,
}) => {
  const [actionsEl, setActionsEl] = React.useState<HTMLElement | null>(null)
  const [crumbsEl, setCrumbsEl] = React.useState<HTMLElement | null>(null)
  return (
    <MainPageContext.Provider value={{ loading, actionsEl, crumbsEl, setActionsEl, setCrumbsEl }}>
      {children}
    </MainPageContext.Provider>
  )
}

/**
 * useMainPage hook to access MainPageContext. Throws outside a MainPage —
 * use this when a component requires the shell (e.g. reading `loading`).
 * @returns MainPageContextProps
 */
export function useMainPage(): MainPageContextProps {
  const context = React.useContext(MainPageContext)
  if (!context) {
    throw new Error('useMainPage must be used within a MainPageProvider')
  }
  return context
}

/**
 * Soft variant of `useMainPage` for slot-contributing components
 * (`MainPageAction`, `MainPageCrumbs`, and the header/breadcrumb slot
 * targets themselves) that may render outside a `MainPage` shell (tests,
 * storybook, a page mid-migration) — returns nulls/no-ops instead of
 * throwing so those call sites don't crash.
 */
export function useMainPageSlots(): Pick<
  MainPageContextProps,
  'actionsEl' | 'crumbsEl' | 'setActionsEl' | 'setCrumbsEl'
> {
  const context = React.useContext(MainPageContext)
  if (!context) {
    return { actionsEl: null, crumbsEl: null, setActionsEl: noopSetEl, setCrumbsEl: noopSetEl }
  }
  return context
}

type MainPageProps = React.ComponentProps<'div'> & {
  children: React.ReactNode
  /**
   * Loading state for the main page.
   */
  loading?: boolean
}

function MainPage({ className, loading = false, children, ...props }: MainPageProps) {
  return (
    <MainPageProvider loading={loading}>
      <div
        data-main='main'
        className={cn(
          'flex-1 overflow-hidden flex flex-col w-full p-3 pt-0 bg-neutral-100 dark:bg-background',
          className
        )}
        {...props}>
        {/* <div
          className={cn(
            // 'relative flex min-w-0 flex-1 flex-col bg-muted/50 bg-clip-padding before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] before:shadow-[0_1px_2px_1px_--theme(--color-black/4%)] after:pointer-events-none after:absolute after:-inset-[5px] after:-z-1 after:rounded-[calc(var(--radius-2xl)+4px)] after:border after:border-border/50 after:bg-clip-padding max-lg:before:hidden lg:rounded-2xl lg:border dark:after:bg-background/72'
          )}> */}
        {children}
        {/* </div> */}
      </div>
    </MainPageProvider>
  )
}
MainPage.displayName = 'MainPage'

/**
 * apps/web/src/components/ui/main-page.tsx
 * MainPageHeader component for displaying the page header with optional children (actions).
 */
function MainPageHeader({
  className,
  title,
  action,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  title?: string
  action?: React.ReactNode
  children?: React.ReactNode
}) {
  const headerRef = React.useRef<HTMLDivElement>(null)
  const triggerWrapperRef = React.useRef<HTMLDivElement>(null)
  const { setActionsEl } = useMainPageSlots()

  React.useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const onScroll = () => {
      const scrolled = el.scrollLeft > 0
      triggerWrapperRef.current?.toggleAttribute('data-scrolled', scrolled)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div
      ref={headerRef}
      data-main='header'
      className={cn(
        'flex items-center justify-between shrink-0 py-2 overflow-x-auto no-scrollbar h-[44px]',
        className
      )}
      {...props}>
      <div className='flex items-center shrink-0'>
        <div
          ref={triggerWrapperRef}
          className='sticky left-0 z-10 flex items-center bg-neutral-100 dark:bg-background after:pointer-events-none after:absolute after:right-0 after:translate-x-full after:top-0 after:h-full after:w-3 after:bg-gradient-to-r after:from-neutral-100 after:to-transparent after:dark:from-background after:opacity-0 after:transition-opacity [&[data-scrolled]]:after:opacity-100'>
          <SidebarTrigger className='hover:bg-primary-200 h-6' />
        </div>
        {children && <div className='flex items-center gap-1.5'>{children}</div>}
        {title && <span className='text-base'>{title}</span>}
      </div>
      <div ref={setActionsEl} className='ml-4 flex shrink-0 items-center gap-2'>
        {action}
      </div>
    </div>
  )
}
MainPageHeader.displayName = 'MainPageHeader'

/**
 * apps/web/src/components/ui/main-page.tsx
 * MainPageAction — portals `children` into `MainPageHeader`'s action cluster
 * (the same container the `action` prop renders into, at order 0). Lets a
 * feature component nested under the route's `MainPageHeader` contribute
 * header actions without owning the header itself. Renders nothing if no
 * ancestor `MainPage` has mounted the header yet; unmounting removes the
 * portal automatically — no cleanup code needed.
 */
function MainPageAction({
  children,
  order = 10,
}: {
  children: React.ReactNode
  /** Flex `order` within the action cluster. Inline `action` prop content defaults to 0. */
  order?: number
}) {
  const { actionsEl } = useMainPageSlots()
  if (!actionsEl) return null
  return createPortal(
    <div style={{ order }} className='flex items-center gap-2'>
      {children}
    </div>,
    actionsEl
  )
}
MainPageAction.displayName = 'MainPageAction'

/**
 * apps/web/src/components/ui/main-page.tsx
 * MainPageBreadcrumbs component - wrapper for shadcn Breadcrumbs. Registers
 * its `<ol>` as the `<MainPageCrumbs>` portal target so a nested component
 * can append breadcrumb tail items after the page's static crumbs.
 *
 * Separators are follower-owned: each `MainPageBreadcrumbItem` /
 * `MainPageBreadcrumbDropdown` renders its own LEADING separator (tagged
 * `data-crumb-sep`), and this list hides only the very first one via CSS —
 * so a crumb never needs to know whether a dynamic tail follows it.
 */
const MainPageBreadcrumb: React.FC<React.ComponentProps<typeof Breadcrumb>> = ({
  children,
  className,
  ...props
}) => {
  const { setCrumbsEl } = useMainPageSlots()
  // Wrapper for shadcn Breadcrumbs for main page usage
  return (
    <Breadcrumb {...props} className={cn('shrink-0', className)}>
      <BreadcrumbList
        ref={setCrumbsEl}
        className={cn(
          'flex-nowrap gap-0.5 sm:gap-0.5',
          '[&>li:first-child[data-crumb-sep]]:hidden'
        )}>
        {children}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

/**
 * apps/web/src/components/ui/main-page.tsx
 * MainPageCrumbs — portals `children` (ordinary `MainPageBreadcrumbItem` /
 * `MainPageBreadcrumbDropdown` elements) into `MainPageBreadcrumb`'s list,
 * appended in DOM order after the page's static crumbs. Renders nothing if
 * no ancestor `MainPageBreadcrumb` has mounted yet.
 */
function MainPageCrumbs({ children }: { children: React.ReactNode }) {
  const { crumbsEl } = useMainPageSlots()
  if (!crumbsEl) return null
  return createPortal(children, crumbsEl)
}
MainPageCrumbs.displayName = 'MainPageCrumbs'

/**
 * apps/web/src/components/ui/main-page.tsx
 * MainPageBreadcrumbItem component - wrapper for shadcn BreadcrumbItem.
 * Supports href, onClick, title props. Renders its own leading separator
 * (see `MainPageBreadcrumb` above).
 */
interface MainPageBreadcrumbItemProps {
  /**
   * The breadcrumb label/title.
   */
  title: string
  /**
   * Optional href for navigation.
   */
  href?: string
  /**
   * Optional click handler.
   */
  onClick?: React.MouseEventHandler<HTMLAnchorElement | HTMLSpanElement>
  /**
   * Additional className for the item.
   */
  className?: string
  icon?: React.ReactNode
}

const MainPageBreadcrumbItem: React.FC<MainPageBreadcrumbItemProps> = ({
  title,
  href,
  onClick,
  icon,
  className,
  ...props
}) => {
  // Leading separator — hidden by MainPageBreadcrumb's list when this item
  // is first (see `[&>li:first-child[data-crumb-sep]]:hidden`).
  return (
    <>
      <BreadcrumbSeparator data-crumb-sep />
      <BreadcrumbItem className={className} {...props}>
        {href ? (
          <BreadcrumbLink href={href} asChild>
            <Link
              href={href}
              className={cn(
                'rounded py-0.5 px-1.5 hover:bg-primary-200 text-nowrap shrink-0',
                icon && 'flex items-center gap-1'
              )}>
              {icon as any}
              {title}
            </Link>
          </BreadcrumbLink>
        ) : onClick ? (
          <BreadcrumbLink
            onClick={onClick}
            className={cn(
              'rounded py-0.5 px-1.5 hover:bg-primary-200 text-nowrap shrink-0',
              icon && 'flex items-center gap-1'
            )}>
            {icon as any}
            {title}
          </BreadcrumbLink>
        ) : (
          <BreadcrumbPage
            className={cn(
              'cursor-default text-nowrap shrink-0',
              icon && 'flex items-center gap-1'
            )}>
            {icon as any}
            {title}
          </BreadcrumbPage>
        )}
      </BreadcrumbItem>
    </>
  )
}

/**
 * apps/web/src/components/ui/main-page.tsx
 * MainPageBreadcrumbDropdown — a breadcrumb item whose body is a DropdownMenu
 * trigger styled to match sibling MainPageBreadcrumbItem entries. Used for
 * in-place entity switching (e.g. KB switcher) without leaving the breadcrumb.
 */
interface MainPageBreadcrumbDropdownProps {
  /** The label rendered inside the trigger (text, badge, or anything React). */
  label: React.ReactNode
  /** Optional leading icon. */
  icon?: React.ReactNode
  /** Dropdown body (rendered inside DropdownMenuContent or PopoverContent). */
  children: React.ReactNode
  /** Extra className merged onto the breadcrumb item. */
  className?: string
  /** Extra className merged onto the floating content. */
  contentClassName?: string
  /** Content alignment. */
  align?: 'start' | 'center' | 'end'
  /**
   * Use a Popover instead of a DropdownMenu. Required when the body contains
   * a `cmdk`-based picker (e.g. MultiSelectPicker) — Radix's DropdownMenu
   * intercepts arrow keys and fights cmdk for focus.
   */
  popover?: boolean
}

const MainPageBreadcrumbDropdown: React.FC<MainPageBreadcrumbDropdownProps> = ({
  label,
  icon,
  children,
  className,
  contentClassName,
  align = 'start',
  popover = false,
}) => {
  const triggerClassName = cn(
    'flex items-center gap-1 rounded py-0.5 px-1.5 hover:bg-primary-200 text-nowrap shrink-0 outline-none',
    'data-[state=open]:bg-primary-200'
  )
  const triggerInner = (
    <>
      {icon}
      {label}
      <ChevronDown className='size-3.5 opacity-60' />
    </>
  )

  return (
    <>
      <BreadcrumbSeparator data-crumb-sep />
      <BreadcrumbItem className={className}>
        {popover ? (
          <Popover>
            <PopoverTrigger className={triggerClassName}>{triggerInner}</PopoverTrigger>
            <PopoverContent align={align} className={cn('p-0', contentClassName)}>
              {children}
            </PopoverContent>
          </Popover>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger className={triggerClassName}>{triggerInner}</DropdownMenuTrigger>
            <DropdownMenuContent align={align} className={contentClassName}>
              {children}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </BreadcrumbItem>
    </>
  )
}

/**
 * Configuration for a single docked panel
 */
interface DockedPanelConfig {
  /** Unique key for the panel */
  key: string
  /** Panel content */
  content: React.ReactNode
  /** Panel width in pixels */
  width: number
  /** Callback when width changes via resize */
  onWidthChange?: (width: number) => void
  /** Minimum width when resizable */
  minWidth?: number
  /** Maximum width when resizable */
  maxWidth?: number
  /** Optional className for the panel wrapper (e.g. 'hidden lg:flex' for responsive hiding) */
  className?: string
}

/**
 * Props for MainPageContent component
 */
interface MainPageContentProps extends React.ComponentProps<'div'> {
  /** Left-docked panels (rendered before the main panel). */
  leftPanels?: DockedPanelConfig[]
  /** Right-docked panels configuration - supports multiple panels side by side */
  dockedPanels?: DockedPanelConfig[]
}

/**
 * MainPageContent component with optional docked panel support.
 */
function MainPageContent({
  className,
  children,
  leftPanels,
  dockedPanels,
  ...props
}: MainPageContentProps) {
  const rightPanels: DockedPanelConfig[] = dockedPanels ?? []
  const left: DockedPanelConfig[] = leftPanels ?? []

  const [isResizing, setIsResizing] = React.useState(false)

  // Always render flex wrapper to keep a stable tree — toggling panels
  // only adds/removes siblings, never remounts the main content.
  return (
    <div className='flex flex-row flex-1 min-h-0 min-w-0'>
      <AnimatePresence initial={false}>
        {left.map((panel) => (
          <motion.div
            key={panel.key}
            className={cn('flex flex-row shrink-0 overflow-hidden', panel.className)}
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: panel.width + 8, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={
              isResizing ? { duration: 0 } : { duration: 0.2, ease: [0.165, 0.84, 0.44, 1] }
            }>
            <PanelFrame width={panel.width}>{panel.content}</PanelFrame>
            <PanelResizeHandle
              currentWidth={panel.width}
              onWidthChange={panel.onWidthChange}
              minWidth={panel.minWidth}
              maxWidth={panel.maxWidth}
              side='left'
              onResizeStart={() => setIsResizing(true)}
              onResizeEnd={() => setIsResizing(false)}
            />
          </motion.div>
        ))}
      </AnimatePresence>
      <PanelFrame data-main='content' flex shrink={false} className={className} {...props}>
        {children}
      </PanelFrame>
      <AnimatePresence initial={false}>
        {rightPanels.map((panel) => (
          <motion.div
            key={panel.key}
            className={cn('flex flex-row shrink-0 overflow-hidden', panel.className)}
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: panel.width + 8, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={
              isResizing ? { duration: 0 } : { duration: 0.2, ease: [0.165, 0.84, 0.44, 1] }
            }>
            <PanelResizeHandle
              currentWidth={panel.width}
              onWidthChange={panel.onWidthChange}
              minWidth={panel.minWidth}
              maxWidth={panel.maxWidth}
              onResizeStart={() => setIsResizing(true)}
              onResizeEnd={() => setIsResizing(false)}
            />
            <PanelFrame width={panel.width}>{panel.content}</PanelFrame>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
MainPageContent.displayName = 'MainPageContent'

// function MainPageContent({ children }: { children: React.ReactNode }) {
//   return (
//     <div className="flex flex-1 flex-col w-full h-full border rounded-lg overflow-hidden">
//       {children}
//     </div>
//   )
// }

function MainPageSubheader({
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  children?: React.ReactNode
}) {
  // const { loading } = useMainPage()

  return (
    <div
      data-main='subheader'
      className={cn(
        'relative flex items-center h-9 bg-primary-200 text-muted-foreground px-2 shrink-0  gap-2 border-b border-foreground/10 overflow-x-auto no-scrollbar after:inset-x-0 after:absolute after:bottom-0 after:w-full after:h-px after:bg-neutral-50 dark:after:bg-neutral-950',
        className
      )}
      {...props}>
      {children}
    </div>
  )
}
MainPageSubheader.displayName = 'MainPageSubheader'

export {
  MainPage,
  MainPageHeader,
  MainPageAction,
  MainPageSubheader,
  MainPageContent,
  MainPageBreadcrumb,
  MainPageCrumbs,
  MainPageBreadcrumbItem,
  MainPageBreadcrumbDropdown,
  type DockedPanelConfig,
}
