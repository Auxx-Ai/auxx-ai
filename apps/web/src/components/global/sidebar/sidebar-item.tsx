// components/global/sidebar/sidebar-item.tsx
'use client'

import { getOptionColor, type SelectOptionColor } from '@auxx/lib/custom-fields/client'
import { SidebarMenuButton, SidebarMenuSubButton } from '@auxx/ui/components/sidebar'
import { cn } from '@auxx/ui/lib/utils'
import Link from 'next/link'
import { type HTMLAttributes, type ReactNode, type Ref, useEffect, useRef } from 'react'

/**
 * Rest props are spread onto EITHER an `<a>` (when `href` is set) or a
 * `<button>`, so the base has to be the element-agnostic attribute set — a
 * `<button>`-specific one (`type`, `disabled`, `form`, …) doesn't fit the
 * anchor branch. Callers only ever spread dnd-kit `attributes`/`listeners`,
 * which are plain DOM/ARIA attributes.
 */
interface SidebarItemProps
  extends Omit<HTMLAttributes<HTMLElement>, 'id' | 'color' | 'onClick' | 'className'> {
  id: string
  name: string
  /** Present → renders a `<Link>`. Absent → renders a `<button onClick>` (e.g. for dnd rows). */
  href?: string
  icon?: ReactNode
  color?: string
  isSubmenu?: boolean
  className?: string
  isActive?: boolean
  onClick?: () => void
  /** Generic trailing slot (count, actions, dropdowns, toggles — caller's choice). */
  end?: ReactNode
  /** Forwarded onto the rendered `<Link>`/`<button>` root (React 19 ref-as-prop) so callers can
   * attach dnd-kit (`ref`, spread `attributes`/`listeners`). */
  ref?: Ref<HTMLAnchorElement | HTMLButtonElement>
  /** When true, renders the name as an editable input. Click-through to navigation is suppressed. */
  isEditing?: boolean
  /** Current draft value while editing. Required when isEditing is true. */
  editValue?: string
  /** Called when the editing value changes. */
  onEditChange?: (value: string) => void
  /** Called on Enter or blur to commit the edit. */
  onEditCommit?: () => void
  /** Called on Escape to cancel the edit. */
  onEditCancel?: () => void
}

/**
 * Lean sidebar row: leading icon/color dot + name (or inline-edit input) + a
 * generic trailing `end` slot. Spreads rest props + `ref` onto the rendered root
 * so callers can attach dnd-kit (`ref`, `attributes`, `listeners`).
 * Rich behavior (counts, 3-dot menu, visibility toggle) lives in `SidebarNavItem`.
 */
export function SidebarItem({
  name,
  href,
  icon,
  color,
  isSubmenu = false,
  className = '',
  isActive,
  onClick,
  end,
  ref,
  isEditing = false,
  editValue,
  onEditChange,
  onEditCommit,
  onEditCancel,
  ...rest
}: SidebarItemProps) {
  // Choose the right component based on whether it's a submenu item
  const Component = isSubmenu ? SidebarMenuSubButton : SidebarMenuButton

  // Reliably focus the input on entering edit mode (autoFocus alone races with
  // the closing dropdown returning focus to its trigger button).
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (!isEditing) return
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => cancelAnimationFrame(id)
  }, [isEditing])

  const rootClassName = cn(`group/item flex h-7 w-full items-center justify-between ${className}`, {
    'bg-sidebar-accent hover:bg-sidebar-accent hover:text-sidebar-accent-foreground': isActive,
    'bg-sidebar-accent': isEditing,
  })

  const content = (
    <>
      <div className='flex min-w-0 items-center grow'>
        {color && !icon && (
          <div
            className={cn(
              'mr-2 size-2 rounded-full',
              getOptionColor(color as SelectOptionColor).swatch
            )}
          />
        )}
        {icon && <span className='[&_svg]:size-4 mr-2 shrink-0'>{icon}</span>}
        {isEditing ? (
          <input
            ref={inputRef}
            value={editValue ?? ''}
            onChange={(e) => onEditChange?.(e.target.value)}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onBlur={() => onEditCommit?.()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onEditCommit?.()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                onEditCancel?.()
              }
            }}
            className='h-5 min-w-0 grow rounded bg-background px-1 text-sm outline-none ring-1 ring-border'
          />
        ) : (
          <span className='truncate'>{name}</span>
        )}
      </div>
      <div className='flex items-center shrink-0'>{end}</div>
    </>
  )

  return (
    <Component asChild className='h-7 py-0 pe-[3px]' tooltip={name}>
      {href ? (
        <Link
          ref={ref as Ref<HTMLAnchorElement>}
          href={href}
          onClick={(e) => {
            if (isEditing) {
              e.preventDefault()
              return
            }
            onClick?.()
          }}
          className={rootClassName}
          {...rest}>
          {content}
        </Link>
      ) : (
        <button
          ref={ref as Ref<HTMLButtonElement>}
          type='button'
          onClick={() => {
            if (isEditing) return
            onClick?.()
          }}
          className={rootClassName}
          {...rest}>
          {content}
        </button>
      )}
    </Component>
  )
}
