// apps/web/src/components/pickers/entity-breadcrumb-switcher.tsx
'use client'

import type { FavoriteTargetType } from '@auxx/lib/favorites/client'
import { BreadcrumbItem } from '@auxx/ui/components/breadcrumb'
import { MainPageBreadcrumbDropdown } from '@auxx/ui/components/main-page'
import * as React from 'react'
import { EntityNavButtons } from './entity-nav-buttons'
import {
  type EntitySwitcherItem,
  EntitySwitcherList,
  type EntitySwitcherListProps,
} from './entity-switcher-list'
import { type EntityNavConfirmOptions, useEntityListNav } from './use-entity-list-nav'
import { useEntitySwitcherOrder } from './use-entity-switcher-order'

/** Prev/next configuration for {@link EntityBreadcrumbSwitcher}. */
export interface EntityBreadcrumbNavOptions {
  /** `J`/`K` bindings. Defaults to true. */
  hotkeys?: boolean
  /** The surface's unsaved-changes flag. Guards every navigation when true. */
  isDirty?: boolean
  confirmOptions?: EntityNavConfirmOptions
  /** What to call the list when the open entity is missing from it. */
  orphanLabel?: string
}

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
  /**
   * Prev/next buttons after the crumb, walking the list in the order the popover
   * displays it. `true` takes the defaults.
   */
  nav?: boolean | EntityBreadcrumbNavOptions
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
  nav,
  onSelect,
  onEdit,
  onCreate,
  ...listProps
}: EntityBreadcrumbSwitcherProps<T>) {
  const [open, setOpen] = React.useState(false)

  const navOptions: EntityBreadcrumbNavOptions = typeof nav === 'object' ? nav : {}

  // The same order the popover renders, so `J` walks what the eye sees. Computed
  // here as well as inside the list: the hook is pure, so two call sites cannot
  // disagree, and nothing has to be threaded through the list's props.
  const { ordered } = useEntitySwitcherOrder<T>({
    items: listProps.items,
    groupBy: listProps.groupBy,
    groups: listProps.groups,
    favorite: listProps.favorite,
  })

  const listNav = useEntityListNav({
    ordered,
    activeId: listProps.activeId,
    onSelect,
    enabled: Boolean(nav),
    isLoading: listProps.isLoading,
    isDirty: navOptions.isDirty,
    confirmOptions: navOptions.confirmOptions,
  })

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
    <>
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
            // Picking a row is the same exit as pressing J, so it gets the same
            // unsaved-changes confirm. A no-op when the surface isn't dirty.
            listNav.guard(() => onSelect(item))
          }}
          onEdit={closeThen(onEdit)}
          onCreate={closeThen(onCreate)}
        />
      </MainPageBreadcrumbDropdown>

      {/* Own BreadcrumbItem: the crumb body is an <ol>, so raw buttons are
          invalid there. No separator — the arrows belong to the entity crumb
          rather than forming a crumb of their own. */}
      {nav && (
        <BreadcrumbItem>
          <EntityNavButtons
            nav={listNav}
            hotkeysEnabled={navOptions.hotkeys ?? true}
            orphanLabel={navOptions.orphanLabel}
          />
        </BreadcrumbItem>
      )}

      <listNav.ConfirmDialog />
    </>
  )
}
