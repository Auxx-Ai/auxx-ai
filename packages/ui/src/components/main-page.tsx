'use client'

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@auxx/ui/components/breadcrumb'
import { SidebarTrigger } from '@auxx/ui/components/sidebar'
import { cn } from '@auxx/ui/lib/utils'
import { AnimatePresence, motion } from 'motion/react'
import Link from 'next/link'
import React from 'react'
import { PanelFrame } from './panel-frame'
import { PanelResizeHandle } from './panel-resize-handle'

/**
 * apps/web/src/components/ui/main-page.tsx
 * MainPageContext and MainPageProvider for managing main page state (e.g., loading).
 */
interface MainPageContextProps {
  /**
   * Loading state for the main page.
   */
  loading: boolean
}

const MainPageContext = React.createContext<MainPageContextProps | undefined>(undefined)

/**
 * MainPageProvider component to provide MainPageContext to children.
 * @param loading - loading state for the main page
 * @param children - React children
 */
export const MainPageProvider: React.FC<{ loading: boolean; children: React.ReactNode }> = ({
  loading,
  children,
}) => {
  return <MainPageContext.Provider value={{ loading }}>{children}</MainPageContext.Provider>
}

/**
 * useMainPage hook to access MainPageContext.
 * @returns MainPageContextProps
 */
export function useMainPage(): MainPageContextProps {
  const context = React.useContext(MainPageContext)
  if (!context) {
    throw new Error('useMainPage must be used within a MainPageProvider')
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
  // const { loading } = useMainPage()

  return (
    <div
      data-main='header'
      className={cn(
        'flex items-center justify-between shrink-0 py-2 overflow-x-auto no-scrollbar h-[44px]',
        className
      )}
      {...props}>
      <div className='flex items-center shrink-0'>
        <SidebarTrigger className='sticky left-0 hover:bg-primary-200 h-6' />
        {children && <div className='flex items-center gap-1.5'>{children}</div>}
        {title && <span className='text-base'>{title}</span>}
      </div>
      {action && <div className='ml-4 space-x-2'>{action}</div>}
    </div>
  )
}
MainPageHeader.displayName = 'MainPageHeader'

/**
 * apps/web/src/components/ui/main-page.tsx
 * MainPageBreadcrumbs component - wrapper for shadcn Breadcrumbs.
 */
const MainPageBreadcrumb: React.FC<React.ComponentProps<typeof Breadcrumb>> = ({
  children,
  className,
  ...props
}) => {
  // Wrapper for shadcn Breadcrumbs for main page usage
  return (
    <Breadcrumb {...props} className={cn('shrink-0', className)}>
      <BreadcrumbList className='flex-nowrap gap-0.5 sm:gap-0.5'>{children}</BreadcrumbList>
    </Breadcrumb>
  )
}

/**
 * apps/web/src/components/ui/main-page.tsx
 * MainPageBreadcrumbItem component - wrapper for shadcn BreadcrumbItem.
 * Supports href, onClick, title props, and arrow display for all but the last item.
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
   * If true, this is the first breadcrumb item.
   */
  first?: boolean
  /**
   * If true, this is the last breadcrumb item (no arrow shown).
   */
  last?: boolean
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
  first,
  last,
  icon,
  className,
  ...props
}) => {
  // Show arrow unless this is the last item
  return (
    <>
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
            className={cn('rounded py-0.5 px-1.5 hover:bg-primary-200 text-nowrap shrink-0')}>
            {icon as any}
            {title}
          </BreadcrumbLink>
        ) : (
          <BreadcrumbPage className='cursor-default text-nowrap shrink-0'>
            {icon as any}
            {title}
          </BreadcrumbPage>
        )}
      </BreadcrumbItem>
      {!last && (
        <BreadcrumbSeparator />
        // <span
        //   role="presentation"
        //   aria-hidden="true"
        //   className={cn('[&>svg]:w-3.5 [&>svg]:h-3.5 shrink-0 ')}>
        //   <ChevronRight />
        // </span>
      )}
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
}

/**
 * Props for MainPageContent component
 */
interface MainPageContentProps extends React.ComponentProps<'div'> {
  /** Docked panels configuration - supports multiple panels side by side */
  dockedPanels?: DockedPanelConfig[]

  /** @deprecated Use dockedPanels instead - Optional docked panel content rendered on the right */
  dockedPanel?: React.ReactNode
  /** @deprecated Use dockedPanels instead - Width of docked panel */
  dockedPanelWidth?: number
  /** Callback when docked panel width changes via resize (legacy API) */
  onDockedPanelWidthChange?: (width: number) => void
  /** Min width for docked panel resize (legacy API) */
  dockedPanelMinWidth?: number
  /** Max width for docked panel resize (legacy API) */
  dockedPanelMaxWidth?: number
}

/**
 * MainPageContent component with optional docked panel support.
 * Supports both legacy single-panel and new multi-panel configurations.
 */
function MainPageContent({
  className,
  children,
  dockedPanels,
  // Legacy props
  dockedPanel,
  dockedPanelWidth = 450,
  onDockedPanelWidthChange,
  dockedPanelMinWidth = 350,
  dockedPanelMaxWidth = 800,
  ...props
}: MainPageContentProps) {
  // Convert legacy props to new format
  const panels: DockedPanelConfig[] =
    dockedPanels ??
    (dockedPanel
      ? [
          {
            key: 'default',
            content: dockedPanel,
            width: dockedPanelWidth,
            onWidthChange: onDockedPanelWidthChange,
            minWidth: dockedPanelMinWidth,
            maxWidth: dockedPanelMaxWidth,
          },
        ]
      : [])

  const [isResizing, setIsResizing] = React.useState(false)

  // Always render flex wrapper to keep a stable tree — toggling panels
  // only adds/removes siblings, never remounts the main content.
  return (
    <div className='flex flex-row flex-1 min-h-0'>
      <PanelFrame data-main='content' flex shrink={false} className={className} {...props}>
        {children}
      </PanelFrame>
      <AnimatePresence initial={false}>
        {panels.map((panel) => (
          <motion.div
            key={panel.key}
            className='flex flex-row shrink-0 overflow-hidden'
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
  MainPageSubheader,
  MainPageContent,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  type DockedPanelConfig,
}
