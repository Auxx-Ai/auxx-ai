// apps/homepage/src/app/platform/ai/_mocks/mock-app-sidebar.tsx

import {
  Bot,
  Building2,
  Calendar,
  ChevronDown,
  Database,
  FileQuestion,
  FileText,
  Inbox,
  type Mail,
  MessagesSquare,
  Package,
  ShoppingCart,
  Sparkles,
  Ticket,
  Users,
  Workflow,
  Zap,
} from 'lucide-react'
import { cn } from '~/lib/utils'

export type SidebarKey =
  | 'inbox'
  | 'drafts'
  | 'today'
  | 'kopilot'
  | 'agents'
  | 'workflows'
  | 'datasets'
  | 'kb'
  | 'contacts'
  | 'tickets'
  | 'parts'
  | 'companies'
  | 'orders'

interface MockAppSidebarProps {
  /** Which sidebar item to highlight as active. Default `'kopilot'`. */
  activeKey?: SidebarKey | (string & {})
  /** When set, replaces the items of the `Records` group (used by persona demos). */
  recordItems?: MockSidebarRecordItem[]
  /** Sidebar width — passed through as inline style. */
  width?: number | string
  className?: string
}

interface SidebarItem {
  key: string
  label: string
  icon: typeof Mail
  badge?: string
  /** When set, renders the icon as an `EntityIcon`-style colored badge. */
  entityColor?:
    | 'gray'
    | 'orange'
    | 'green'
    | 'blue'
    | 'indigo'
    | 'purple'
    | 'pink'
    | 'amber'
    | 'teal'
    | 'red'
}

export interface MockSidebarRecordItem {
  key: string
  label: string
  icon: typeof Mail
  entityColor: NonNullable<SidebarItem['entityColor']>
}

interface SidebarGroup {
  title: string
  items: SidebarItem[]
}

export type EntityColor = NonNullable<SidebarItem['entityColor']>

/** Inverse color tokens copied from `packages/ui/src/components/icons.tsx` (ICON_COLORS[*].inverseColor). */
export const ENTITY_COLOR_CLASS: Record<EntityColor, string> = {
  gray: 'bg-zinc-600 text-zinc-100 dark:bg-zinc-500',
  orange: 'bg-orange-600 text-orange-100 dark:bg-orange-500',
  green: 'bg-green-500 text-green-100 dark:bg-green-500',
  blue: 'bg-blue-500 text-blue-100 dark:bg-blue-500',
  indigo: 'bg-indigo-500 text-indigo-100 dark:bg-indigo-500',
  purple: 'bg-purple-500 text-purple-100 dark:bg-purple-500',
  pink: 'bg-pink-500 text-pink-50 dark:bg-pink-500',
  amber: 'bg-amber-600 text-amber-100 dark:bg-amber-500',
  teal: 'bg-teal-500 text-teal-100 dark:bg-teal-500',
  red: 'bg-red-600 text-red-100 dark:bg-red-500',
}

const SIDEBAR_GROUPS: SidebarGroup[] = [
  {
    title: 'Mail',
    items: [
      { key: 'inbox', label: 'Inbox', icon: Inbox, badge: '3' },
      { key: 'drafts', label: 'Drafts', icon: FileText },
    ],
  },
  {
    title: 'Workspace',
    items: [
      { key: 'today', label: 'Today', icon: Calendar },
      { key: 'kopilot', label: 'Chats', icon: MessagesSquare },
      { key: 'agents', label: 'Agents', icon: Bot },
      { key: 'workflows', label: 'Workflows', icon: Workflow },
    ],
  },
  {
    title: 'Resources',
    items: [
      { key: 'datasets', label: 'Datasets', icon: Database },
      { key: 'kb', label: 'Knowledge Base', icon: FileQuestion },
    ],
  },
  {
    title: 'Records',
    items: [
      { key: 'contacts', label: 'Contacts', icon: Users, entityColor: 'blue' },
      { key: 'tickets', label: 'Tickets', icon: Ticket, entityColor: 'orange' },
      { key: 'parts', label: 'Parts', icon: Package, entityColor: 'amber' },
      { key: 'companies', label: 'Companies', icon: Building2, entityColor: 'purple' },
      { key: 'orders', label: 'Orders', icon: ShoppingCart, entityColor: 'green' },
    ],
  },
]

/**
 * Static facsimile of `apps/web/src/components/global/sidebar/index.tsx`.
 * Non-interactive — buttons render as plain divs, links don't navigate.
 *
 * Styling mirrors the real app's sidebar tokens:
 * - Group label: `h-6 px-2 text-xs font-medium text-sidebar-foreground/70`
 *   (from `SidebarGroupLabel`)
 * - Menu item (size sm): `flex h-7 w-full items-center gap-2 rounded-md px-2
 *   text-xs` (from `sidebarMenuButtonVariants` + `SidebarItem`)
 * - Active: `bg-sidebar-accent text-sidebar-accent-foreground font-medium`
 * - NavUser row: `h-8 rounded-2xl ps-1 pe-1.5` with size-6 ring avatar and
 *   trailing Sparkles button (from `nav-user.tsx`)
 */
export function MockAppSidebar({
  activeKey = 'kopilot',
  recordItems,
  width = 220,
  className,
}: MockAppSidebarProps) {
  const groups = recordItems
    ? SIDEBAR_GROUPS.map((group) =>
        group.title === 'Records' ? { ...group, items: recordItems } : group
      )
    : SIDEBAR_GROUPS

  return (
    <aside
      style={{ width }}
      className={cn(
        'flex shrink-0 flex-col bg-mock-sidebar text-mock-sidebar-foreground border-r border-mock-sidebar-border',
        className
      )}>
      <NavUserMock />

      <div className='flex-1 space-y-2 overflow-hidden px-2 pb-3'>
        <QuickActionsMock />
        {groups.map((group) => (
          <SidebarGroupBlock key={group.title} group={group} activeKey={activeKey} />
        ))}
      </div>
    </aside>
  )
}

/**
 * Static facsimile of `apps/web/src/components/global/sidebar/quick-actions-nav.tsx` —
 * the boxed command-palette trigger that sits directly below the user row.
 */
function QuickActionsMock() {
  return (
    <div className='flex h-7 items-center gap-2 rounded-md bg-mock-window px-2 text-xs text-mock-sidebar-foreground shadow-[0_0_2px_0_rgba(28,40,64,0.18),0_1px_3px_0_rgba(24,41,75,0.04)] dark:shadow-[inset_0_0_0_1px_#2f3033,0_0_2px_0_#000,0_1px_3px_0_rgba(0,0,0,0.08)]'>
      <Zap className='size-4 shrink-0' />
      <span className='flex-1 truncate text-left'>Quick Actions</span>
      <span className='flex shrink-0 items-center gap-0.5'>
        <kbd className='flex h-4 min-w-4 items-center justify-center rounded border border-mock-sidebar-border px-1 text-[10px] text-mock-sidebar-muted'>
          ⌘
        </kbd>
        <kbd className='flex h-4 min-w-4 items-center justify-center rounded border border-mock-sidebar-border px-1 text-[10px] text-mock-sidebar-muted'>
          K
        </kbd>
      </span>
    </div>
  )
}

function NavUserMock() {
  return (
    <div className='flex items-center justify-between gap-1 p-2'>
      <div className='flex h-8 flex-1 items-center gap-2 rounded-2xl px-1 pe-1.5'>
        <span className='flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-[11px] font-medium text-background ring-1 ring-foreground/20'>
          M
        </span>
        <span className='flex-1 truncate text-sm text-mock-sidebar-foreground'>Mark Klooth</span>
        <ChevronDown className='size-3.5 text-mock-sidebar-muted' />
      </div>
      <span className='flex size-8 shrink-0 items-center justify-center rounded-2xl text-mock-sidebar-muted'>
        <Sparkles className='size-4' />
      </span>
    </div>
  )
}

function SidebarGroupBlock({ group, activeKey }: { group: SidebarGroup; activeKey: string }) {
  return (
    <div>
      <div className='flex h-6 items-center rounded-md px-2 text-xs font-medium text-mock-sidebar-muted'>
        {group.title}
      </div>
      <ul className='flex flex-col gap-px'>
        {group.items.map((item) => {
          const Icon = item.icon
          const isActive = item.key === activeKey
          return (
            <li
              key={item.key}
              className={cn(
                'flex h-7 w-full items-center gap-2 overflow-hidden rounded-md px-2 text-xs',
                isActive
                  ? 'bg-mock-sidebar-accent font-medium text-mock-sidebar-accent-foreground'
                  : 'text-mock-sidebar-foreground'
              )}>
              {item.entityColor ? (
                <span
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-md',
                    ENTITY_COLOR_CLASS[item.entityColor]
                  )}>
                  <Icon className='size-3.5' />
                </span>
              ) : (
                <Icon className='size-4 shrink-0' />
              )}
              <span className='flex-1 truncate text-left'>{item.label}</span>
              {item.badge ? (
                <span className='shrink-0 text-xs text-muted-foreground'>{item.badge}</span>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
