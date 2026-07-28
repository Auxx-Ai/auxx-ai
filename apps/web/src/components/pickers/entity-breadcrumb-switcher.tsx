// apps/web/src/components/pickers/entity-breadcrumb-switcher.tsx
'use client'

import type { FavoriteTargetType } from '@auxx/lib/favorites/client'
import { MainPageBreadcrumbDropdown } from '@auxx/ui/components/main-page'
import * as React from 'react'
import {
  type EntitySwitcherItem,
  EntitySwitcherList,
  type EntitySwitcherListProps,
} from './entity-switcher-list'

/**
 * Props for {@link EntityBreadcrumbSwitcher}. Everything not listed here is
 * forwarded verbatim to {@link EntitySwitcherList}.
 */
export interface EntityBreadcrumbSwitcherProps<T extends FavoriteTargetType = FavoriteTargetType>
  extends EntitySwitcherListProps<T> {
  /** Trigger label — the entity currently open. Truncated at 24ch. */
  activeLabel: React.ReactNode
  /** Optional leading icon for the trigger. */
  activeIcon?: React.ReactNode
  /** Extra className merged onto the popover content. Defaults to `w-72 p-0`. */
  contentClassName?: string
  /** Popover alignment. */
  align?: 'start' | 'center' | 'end'
}

/**
 * An {@link EntitySwitcherList} mounted in the page breadcrumb — the one
 * in-place switcher every top-level entity detail page uses.
 *
 * The host is hardcoded to `MainPageBreadcrumbDropdown`'s `popover` branch: the
 * default Radix `DropdownMenu` intercepts arrow keys and fights `cmdk` for
 * focus, which fails silently as "arrow keys do nothing" rather than as an
 * error. No caller can opt out.
 *
 * @example
 * ```tsx
 * <EntityBreadcrumbSwitcher
 *   activeLabel={dashboard.name}
 *   items={items}
 *   activeId={dashboard.id}
 *   onSelect={(item) => router.push(item.href ?? '/app/dashboards')}
 * />
 * ```
 */
export function EntityBreadcrumbSwitcher<T extends FavoriteTargetType = FavoriteTargetType>({
  activeLabel,
  activeIcon,
  contentClassName = 'w-72 p-0',
  align = 'start',
  onSelect,
  onEdit,
  onCreate,
  ...listProps
}: EntityBreadcrumbSwitcherProps<T>) {
  const [open, setOpen] = React.useState(false)

  // The popover is controlled so the body can dismiss it. Selecting navigates,
  // and edit/create hand off to a dialog — but on routes whose page shell stays
  // mounted (e.g. dashboards) nothing unmounts the popover, so it would hang
  // open behind the thing it just opened. Delete and favorite deliberately keep
  // it open: both are list management, not an exit.
  const closeThen = React.useCallback(
    <A extends unknown[]>(fn?: (...args: A) => void) =>
      fn &&
      ((...args: A) => {
        setOpen(false)
        fn(...args)
      }),
    []
  )

  return (
    <MainPageBreadcrumbDropdown
      label={<span className='max-w-[24ch] truncate'>{activeLabel}</span>}
      icon={activeIcon}
      align={align}
      popover
      open={open}
      onOpenChange={setOpen}
      contentClassName={contentClassName}>
      <EntitySwitcherList<T>
        {...listProps}
        onSelect={(item: EntitySwitcherItem) => {
          setOpen(false)
          onSelect(item)
        }}
        onEdit={closeThen(onEdit)}
        onCreate={closeThen(onCreate)}
      />
    </MainPageBreadcrumbDropdown>
  )
}
