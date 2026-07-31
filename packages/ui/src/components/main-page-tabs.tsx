// packages/ui/src/components/main-page-tabs.tsx

'use client'

import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { cn } from '@auxx/ui/lib/utils'
import { usePathname, useRouter } from 'next/navigation'
import type * as React from 'react'

/**
 * A single `MainPageTabs` entry.
 *
 * Route mode: give every item an `href`; the active tab is derived from
 * `usePathname()` (longest-prefix match, exact match always wins) and
 * selecting a tab calls `router.push(item.href)`.
 *
 * Controlled mode: omit `href` and drive `value`/`onValueChange` on
 * `MainPageTabs` instead (e.g. query-param-backed tabs).
 */
interface MainPageTabsItem {
  /** Stable id — matched against the pathname (route mode) or `value` (controlled mode). */
  value: string
  label: React.ReactNode
  icon?: React.ReactNode
  /** Route to navigate to on select. Presence of `href` drives route mode. */
  href?: string
  tooltip?: string
  /** Omit the tab without reshuffling call-site arrays (feature gating). */
  hidden?: boolean
  /** Extra data-* attributes forwarded to the underlying `RadioTabItem` (e.g. anchor lookups). */
  [dataAttr: `data-${string}`]: string | undefined
}

interface MainPageTabsProps {
  items: MainPageTabsItem[]
  /** Controlled mode value. Omit (with items using `href`) for route mode. */
  value?: string
  /** Controlled mode change handler. Ignored in route mode. */
  onValueChange?: (value: string) => void
  size?: 'sm' | 'xs'
  className?: string
}

/**
 * Header tab switcher for `MainPageHeader`'s left cluster (rendered as a
 * child, after the breadcrumb) — replaces the hand-rolled `RadioTab` +
 * pathname-sniffing duplicated across `tickets/layout.tsx` and
 * `dispatch/layout.tsx`.
 *
 * Renders each item as a `RadioTab size='sm'|'xs'` entry with an icon and a
 * `hidden sm:inline` responsive label, with an optional per-item tooltip.
 *
 * @example
 * ```tsx
 * <MainPageTabs
 *   items={[
 *     { value: 'list', label: 'Tickets', icon: <Tags />, href: '/app/tickets' },
 *     { value: 'dashboard', label: 'Dashboard', icon: <ChartColumn />, href: '/app/tickets/dashboard', hidden: !dashboardsEnabled },
 *   ]}
 * />
 * ```
 */
function MainPageTabs({ items, value, onValueChange, size = 'sm', className }: MainPageTabsProps) {
  const pathname = usePathname()
  const router = useRouter()

  const visible = items.filter((item) => !item.hidden)
  // A switcher with a single choice is not a switcher — it renders as a full-width
  // bar with one permanently-selected tab and dead space beside it. Feature gating
  // (`hidden`) routinely collapses a two-tab header down to one, so drop the whole
  // control rather than leaving the empty half behind.
  if (visible.length < 2) return null

  const isRouteMode = value === undefined
  const activeValue = isRouteMode ? longestPrefixMatch(visible, pathname) : value

  const handleValueChange = isRouteMode
    ? (next: string) => {
        const item = visible.find((i) => i.value === next)
        if (item?.href) router.push(item.href)
      }
    : onValueChange

  return (
    <RadioTab
      value={activeValue}
      onValueChange={handleValueChange}
      size={size}
      radioGroupClassName='grid w-full'
      className={cn('border border-primary-200 flex w-full', className)}>
      {visible.map((item) => {
        const { value: itemValue, label, icon, href, tooltip, hidden, ...dataProps } = item
        return (
          <RadioTabItem
            key={itemValue}
            value={itemValue}
            size={size}
            tooltip={tooltip}
            {...dataProps}>
            {icon}
            <span className='hidden sm:inline'>{label}</span>
          </RadioTabItem>
        )
      })}
    </RadioTab>
  )
}
MainPageTabs.displayName = 'MainPageTabs'

/**
 * Longest-prefix match of `pathname` against items' `href` (exact match
 * always wins over a shorter prefix) — handles `/app/tickets` vs
 * `/app/tickets/dashboard` vs `/app/tickets/settings` without a
 * hand-written pathname switch per route module.
 */
function longestPrefixMatch(items: MainPageTabsItem[], pathname: string): string | undefined {
  const exact = items.find((item) => item.href === pathname)
  if (exact) return exact.value

  let best: MainPageTabsItem | undefined
  for (const item of items) {
    if (!item.href) continue
    if (pathname.startsWith(item.href) && (!best || item.href.length > (best.href?.length ?? 0))) {
      best = item
    }
  }
  return best?.value
}

export { MainPageTabs, type MainPageTabsItem, type MainPageTabsProps }
