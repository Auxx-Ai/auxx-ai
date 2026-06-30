// packages/ui/src/components/list-card.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { SimpleTooltip as Tooltip } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import { BadgeCheck, Loader2, MoreVertical } from 'lucide-react'
import { Slot as SlotPrimitive } from 'radix-ui'
import type * as React from 'react'

/** Semantic status colours for the corner dot — never pass raw classes. */
export type ListCardStatusTone = 'good' | 'info' | 'warning' | 'error' | 'muted'

const STATUS_DOT_TONE: Record<ListCardStatusTone, string> = {
  good: 'bg-good-500',
  info: 'bg-info',
  warning: 'bg-warning-500',
  error: 'bg-destructive',
  muted: 'bg-muted-foreground/40',
}

export interface ListCardStatus {
  tone: ListCardStatusTone
  /**
   * Tooltip content on hover. Optional — omit for a bare dot (no tooltip).
   * Not derived from `tone`, so a card can surface a richer message (e.g. a
   * connector passes its error text instead of a generic "Error").
   */
  label?: React.ReactNode
}

/** A flat dropdown action. Use the `menu` slot instead when you need submenus. */
export interface ListCardMenuItem {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  destructive?: boolean
  disabled?: boolean
}

/** Chip descriptor for {@link renderBadgeChips} — a small label/icon pill. */
export interface ListCardBadgeChip {
  label?: string
  icon?: React.ReactNode
}

type ListCardSlotName = 'root' | 'title' | 'subtitle' | 'description' | 'icon' | 'footer' | 'badges'

export interface ListCardProps {
  /** Skeleton mode — renders the shell with pulsing placeholders, non-interactive. */
  loading?: boolean

  // ---- media ----
  /** Icon node, auto-wrapped in the standard `size-8 rounded-xl border` box. */
  icon?: React.ReactNode
  /** Replaces the whole media slot (e.g. a bare avatar). Wins over `icon`. */
  media?: React.ReactNode
  /** Optional corner status dot. Omit → no dot. */
  status?: ListCardStatus

  // ---- header text ----
  title?: React.ReactNode
  /** Clamp for the title, default 2. */
  titleLines?: 1 | 2
  /** Tiny line under the title — a `<LastUpdated>` or a plain string. */
  subtitle?: React.ReactNode
  /** Shows a verified check next to the title. */
  verified?: boolean
  /** Top-right of the title row (e.g. an app badge row, an agent "Setting up" badge). */
  headerEnd?: React.ReactNode

  // ---- body ----
  description?: React.ReactNode
  /**
   * Description region: `0` = none, `1`/`2` = clamp. Default 2. Drives both the
   * live `line-clamp-{n}` and the skeleton row count, so loading height matches.
   */
  descriptionLines?: 0 | 1 | 2

  // ---- footer ----
  /** Footer-left content, typically `<Badge>`s. */
  badges?: React.ReactNode
  /** Footer-right, before the menu (e.g. a creator avatar). */
  trailing?: React.ReactNode
  /** Flat dropdown items. Ignored when `menu` is set. */
  menuItems?: ListCardMenuItem[]
  /** Raw `<DropdownMenuContent>` children — for submenus. Wins over `menuItems`. */
  menu?: React.ReactNode

  // ---- selection (bulk mode) ----
  /** Surface supports selection → reveal a checkbox on hover (top-right corner). */
  selectable?: boolean
  /** Bulk mode active → checkbox always shown; whole-card click toggles instead of navigating. */
  selecting?: boolean
  /** Controlled selected state → highlight + checked box. */
  selected?: boolean
  /** Toggle handler; receives the mouse event so callers can read `e.shiftKey` for range select. */
  onSelectChange?: (next: boolean, e: React.MouseEvent) => void
  /** Show a blurred, non-interactive "Deleting…" overlay (a bulk action is in flight). */
  pending?: boolean
  /** Centered label for the pending overlay. Default `Deleting…`. */
  pendingLabel?: React.ReactNode

  // ---- interaction ----
  href?: string
  onClick?: () => void
  disabled?: boolean
  /** Accessible label for the click overlay (falls back to a string `title`). */
  ariaLabel?: string
  /**
   * Escape hatch for the stretched-link overlay: pass a single element (e.g. a
   * Next `<Link>`) and it becomes the overlay via Radix `Slot`. Wins over `href`.
   */
  link?: React.ReactElement

  // ---- styling ----
  variant?: 'default' | 'placeholder'
  className?: string
  /** Targeted slot overrides, e.g. `{ title: 'line-clamp-1' }`. */
  classNames?: Partial<Record<ListCardSlotName, string>>
}

/** Renders a `{ label?, icon? }[]` chip row — handy for `badges`/`headerEnd`. */
export function renderBadgeChips(chips: ListCardBadgeChip[]): React.ReactNode {
  if (chips.length === 0) return null
  return (
    <div className='flex flex-row items-center gap-0.5'>
      {chips.map((chip, i) => (
        <div
          key={`chip-${i}`}
          className='flex h-5 shrink-0 items-center justify-center gap-1 rounded-lg border bg-primary-100 px-1'>
          {chip.icon}
          {chip.label && <span className='text-xs'>{chip.label}</span>}
        </div>
      ))}
    </div>
  )
}

const OVERLAY_CLASS =
  'absolute inset-0 z-0 rounded-2xl focus-visible:outline-2 focus-visible:outline-info'

/** Corner status dot, wrapped in a tooltip only when a label is present. */
function StatusDot({ status }: { status: ListCardStatus }) {
  const dot = (
    <div
      data-slot='list-card-status'
      className={cn(
        'absolute -right-0.5 -top-0.5 z-10 size-2.5 rounded-full border-2 border-primary-50',
        STATUS_DOT_TONE[status.tone]
      )}
    />
  )
  if (status.label == null) return dot
  return (
    <Tooltip
      content={typeof status.label === 'string' ? status.label : undefined}
      contentComponent={typeof status.label === 'string' ? undefined : status.label}>
      {dot}
    </Tooltip>
  )
}

/**
 * The one card used across apps, connections, webhooks, datasets, agents,
 * workflows and connectors. A clickable tile with an icon, title, optional
 * status dot / subtitle / description / badges, and a hover-revealed three-dot
 * menu. Pass `loading` for a skeleton; every region carries a `data-slot` for
 * targeted overrides.
 *
 * The whole card is clickable via a stretched-link overlay (real `<a>`/`<button>`
 * semantics) so the menu and tooltip targets can sit above it without nesting an
 * interactive element inside an anchor.
 */
export function ListCard({
  loading,
  icon,
  media,
  status,
  title,
  titleLines = 2,
  subtitle,
  verified,
  headerEnd,
  description,
  descriptionLines = 2,
  badges,
  trailing,
  menuItems,
  menu,
  selectable,
  selecting,
  selected,
  onSelectChange,
  pending,
  pendingLabel,
  href,
  onClick,
  disabled,
  ariaLabel,
  link,
  variant = 'default',
  className,
  classNames,
}: ListCardProps) {
  const isPlaceholder = variant === 'placeholder'
  const interactive =
    !loading && !disabled && !pending && (selecting || Boolean(href || onClick || link))
  // While selecting, the per-card menu + header badge yield to the checkbox/bulk bar.
  const hasMenu = !loading && !selecting && Boolean(menu || menuItems?.length)
  const hasFooter = !loading && Boolean(badges || trailing)
  const showCheckbox = !loading && !pending && (selectable || selecting)

  const rootClass = cn(
    'group/list-card relative flex w-full flex-col gap-2 rounded-2xl border p-3 text-left',
    isPlaceholder
      ? 'border-dashed bg-primary-50 hover:bg-primary-50/50 hover:outline-5 hover:outline-primary-50'
      : 'bg-background dark:bg-primary-50 hover:bg-primary-50/50 hover:outline-5 hover:outline-primary-100 dark:hover:outline-primary-50/50',
    // Selected: a persistent info ring (even when not hovering), info tint that
    // stays on hover (a touch darker), and an info hover ring.
    selected &&
      'border-info/90 outline-5 outline-info/20 bg-info/5 hover:bg-info/10 hover:outline-info/10 dark:bg-info/10 dark:hover:bg-info/10 dark:hover:outline-info/20',
    // Pointer cursor only while bulk-selecting; normal cards keep the default cursor.
    selecting && 'cursor-pointer',
    disabled && 'cursor-not-allowed opacity-60',
    className,
    classNames?.root
  )

  const stop = (e: React.MouseEvent) => e.stopPropagation()
  const resolvedAriaLabel = ariaLabel ?? (typeof title === 'string' ? title : undefined)

  const overlay = !interactive ? null : selecting ? (
    // Bulk mode: the stretched overlay toggles selection instead of navigating.
    <button
      type='button'
      className={cn(OVERLAY_CLASS, 'cursor-pointer')}
      aria-label={resolvedAriaLabel}
      onClick={(e) => onSelectChange?.(!selected, e)}
    />
  ) : link ? (
    <SlotPrimitive.Slot className={cn(OVERLAY_CLASS, 'cursor-default')}>{link}</SlotPrimitive.Slot>
  ) : href ? (
    <a className={cn(OVERLAY_CLASS, 'cursor-default')} href={href} aria-label={resolvedAriaLabel} />
  ) : (
    <button
      type='button'
      className={cn(OVERLAY_CLASS, 'cursor-default')}
      onClick={onClick}
      aria-label={resolvedAriaLabel}
    />
  )

  // Top-right checkbox: always visible while selecting, hover-revealed otherwise.
  // Wrapped in a div (not the Checkbox's own handler) so the click MouseEvent —
  // and `e.shiftKey` for range select — reaches `onSelectChange`.
  const checkbox = showCheckbox ? (
    <div
      data-slot='list-card-select'
      className={cn(
        'absolute right-3 top-2 z-20',
        !selecting && 'opacity-0 transition-opacity group-hover/list-card:opacity-100'
      )}
      onClick={(e) => {
        e.stopPropagation()
        onSelectChange?.(!selected, e)
      }}>
      <Checkbox checked={selected} className='pointer-events-none size-4' />
    </div>
  ) : null

  const menuNode = hasMenu ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className='-mr-1 relative z-10 rounded-lg opacity-0 transition-opacity duration-300 group-hover/list-card:opacity-100 data-[state=open]:bg-muted! data-[state=open]:opacity-100!'
          variant='ghost'
          size='icon-xs'
          onClick={stop}>
          <MoreVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' onClick={stop}>
        {menu ??
          menuItems?.map((item) => (
            <DropdownMenuItem
              key={item.label}
              disabled={item.disabled}
              variant={item.destructive ? 'destructive' : undefined}
              onClick={(e) => {
                e.stopPropagation()
                item.onClick()
              }}>
              {item.icon}
              {item.label}
            </DropdownMenuItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null

  return (
    <div data-slot='list-card' className={rootClass}>
      {overlay}
      {checkbox}

      {/* Header: media + title column */}
      <div data-slot='list-card-header' className='flex w-full flex-row items-start gap-2'>
        <div data-slot='list-card-media' className='relative shrink-0'>
          {loading ? (
            <Skeleton className='size-8 rounded-xl' />
          ) : (
            (media ?? (
              <div
                data-slot='list-card-icon'
                className={cn(
                  'flex size-8 items-center justify-center overflow-hidden rounded-xl border',
                  classNames?.icon
                )}>
                {icon}
              </div>
            ))
          )}
          {!loading && status && <StatusDot status={status} />}
        </div>

        <div data-slot='list-card-heading' className='flex min-w-0 flex-1 flex-col'>
          <div
            data-slot='list-card-title-row'
            className='flex flex-row items-start justify-between gap-1'>
            {loading ? (
              // h-5 matches the `text-sm` title line box (20px) so there's no shift.
              <div className='flex h-5 items-center'>
                <Skeleton className='h-4 w-2/3' />
              </div>
            ) : (
              <div className='flex min-w-0 items-center gap-1'>
                <p
                  data-slot='list-card-title'
                  className={cn(
                    'text-sm font-semibold group-hover/list-card:text-info',
                    titleLines === 1 ? 'line-clamp-1' : 'line-clamp-2',
                    classNames?.title
                  )}>
                  {title}
                </p>
                {verified && (
                  <Tooltip content='Verified'>
                    <BadgeCheck className='relative z-10 size-4 shrink-0 text-blue-500' />
                  </Tooltip>
                )}
              </div>
            )}
            {!loading && !selecting && headerEnd && (
              <div data-slot='list-card-header-end' className='relative z-10 shrink-0'>
                {headerEnd}
              </div>
            )}
          </div>
          {loading ? (
            // h-4 matches the `text-xs` subtitle line box (16px); no `mt` (real has none).
            <div className='flex h-4 items-center'>
              <Skeleton className='h-3 w-1/3' />
            </div>
          ) : (
            subtitle && (
              <div
                data-slot='list-card-subtitle'
                className={cn('text-xs text-muted-foreground', classNames?.subtitle)}>
                {subtitle}
              </div>
            )
          )}
        </div>
      </div>

      {/* Description */}
      {descriptionLines > 0 &&
        (loading ? (
          // Each row reserves the `text-sm` line box (20px) so N lines == the real
          // clamp height; no inter-row gap, matching the real <p>'s line stacking.
          <div className='flex flex-col'>
            {Array.from({ length: descriptionLines }).map((_, i) => (
              <div key={`skeleton-${i}`} className='flex h-5 items-center'>
                <Skeleton className={cn('h-3', i === descriptionLines - 1 ? 'w-4/5' : 'w-full')} />
              </div>
            ))}
          </div>
        ) : (
          <p
            data-slot='list-card-description'
            className={cn(
              'text-sm text-muted-foreground',
              descriptionLines === 1 ? 'line-clamp-1 min-h-4' : 'line-clamp-2',
              classNames?.description
            )}>
            {description}
          </p>
        ))}

      {/* Footer */}
      {loading ? (
        // h-6 matches the real footer height driven by the `size-6` menu button (24px).
        <div data-slot='list-card-footer' className='mt-auto flex h-6 items-center gap-2'>
          <Skeleton className='h-5 w-16 rounded-md' />
        </div>
      ) : hasFooter ? (
        <div
          data-slot='list-card-footer'
          // min-h-6 holds the footer at the menu-button height so the card doesn't
          // shrink when the menu is hidden while selecting.
          className={cn(
            'mt-auto flex min-h-6 items-center justify-between gap-2',
            classNames?.footer
          )}>
          <div
            data-slot='list-card-badges'
            className={cn('flex min-w-0 items-center gap-1', classNames?.badges)}>
            {badges}
          </div>
          {/* While selecting, let clicks fall through to the toggle overlay. */}
          <div
            className={cn(
              'relative z-10 flex items-center gap-1',
              selecting && 'pointer-events-none'
            )}>
            {trailing}
            {menuNode}
          </div>
        </div>
      ) : (
        // No footer content: float the menu bottom-right (preserves the app-card look).
        hasMenu && <div className='absolute bottom-2 right-2 z-10'>{menuNode}</div>
      )}

      {/* Pending overlay: blurs the card behind a centered "Deleting…" label and
          blocks interaction while a bulk action is in flight. */}
      {pending && (
        <div
          data-slot='list-card-pending'
          className='absolute inset-0 z-30 flex items-center justify-center gap-2 rounded-2xl bg-background/50 text-sm font-medium text-muted-foreground backdrop-blur-sm'>
          <Loader2 className='size-4 animate-spin' />
          {pendingLabel ?? 'Deleting…'}
        </div>
      )}
    </div>
  )
}
