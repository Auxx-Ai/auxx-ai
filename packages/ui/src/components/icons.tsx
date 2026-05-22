// packages/ui/src/components/icons.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import type React from 'react'
import { getIcon, ICON_DATA, type IconItem } from './icon-data'

// Re-export from the leaf module so non-React callers (chat-widget bundle)
// can import the id → Lucide-component catalog without pulling in this file's
// `'use client'` + CVA + EntityIcon.
export { getIcon, ICON_DATA, type IconItem }

/** Color configuration for icons */
export interface IconColor {
  id: string
  label: string
  /** Preview swatch color (for color selector buttons) */
  swatch: string
  /** Icon text color - for rendering outside picker */
  iconColor: string
  /** Background classes - for rendering outside picker */
  bgClasses: string
  /** Inverse color scheme - solid bg with light icon, no hover */
  inverseColor: string
  /** CSS custom properties - for picker grid (performance) */
  groupClasses: string
}

/** Available icon colors */
export const ICON_COLORS: IconColor[] = [
  {
    id: 'gray',
    label: 'Gray',
    swatch: 'bg-zinc-500',
    iconColor: 'text-zinc-700 dark:text-zinc-300',
    bgClasses: 'bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700',
    inverseColor: 'bg-zinc-600 text-zinc-100 dark:bg-zinc-500',
    groupClasses:
      '[--icon-bg:var(--color-zinc-100)] [--icon-bg-hover:var(--color-zinc-200)] [--icon-color:var(--color-zinc-700)] dark:[--icon-bg:var(--color-zinc-800)] dark:[--icon-bg-hover:var(--color-zinc-700)] dark:[--icon-color:var(--color-zinc-300)]',
  },
  {
    id: 'red',
    label: 'Red',
    swatch: 'bg-red-500',
    iconColor: 'text-red-600 dark:text-red-400',
    bgClasses: 'bg-red-50 hover:bg-red-100 dark:bg-red-950 dark:hover:bg-red-900',
    inverseColor: 'bg-red-600 text-red-100 dark:bg-red-500',
    groupClasses:
      '[--icon-bg:var(--color-red-50)] [--icon-bg-hover:var(--color-red-100)] [--icon-color:var(--color-red-600)] dark:[--icon-bg:var(--color-red-950)] dark:[--icon-bg-hover:var(--color-red-900)] dark:[--icon-color:var(--color-red-400)]',
  },
  {
    id: 'orange',
    label: 'Orange',
    swatch: 'bg-orange-500',
    iconColor: 'text-orange-600 dark:text-orange-400',
    bgClasses: 'bg-orange-50 hover:bg-orange-100 dark:bg-orange-950 dark:hover:bg-orange-900',
    inverseColor: 'bg-orange-600 text-orange-100 dark:bg-orange-500',
    groupClasses:
      '[--icon-bg:var(--color-orange-50)] [--icon-bg-hover:var(--color-orange-100)] [--icon-color:var(--color-orange-600)] dark:[--icon-bg:var(--color-orange-950)] dark:[--icon-bg-hover:var(--color-orange-900)] dark:[--icon-color:var(--color-orange-400)]',
  },
  {
    id: 'amber',
    label: 'Amber',
    swatch: 'bg-amber-500',
    iconColor: 'text-amber-600 dark:text-amber-400',
    bgClasses: 'bg-amber-50 hover:bg-amber-100 dark:bg-amber-950 dark:hover:bg-amber-900',
    inverseColor: 'bg-amber-600 text-amber-100 dark:bg-amber-500',
    groupClasses:
      '[--icon-bg:var(--color-amber-50)] [--icon-bg-hover:var(--color-amber-100)] [--icon-color:var(--color-amber-600)] dark:[--icon-bg:var(--color-amber-950)] dark:[--icon-bg-hover:var(--color-amber-900)] dark:[--icon-color:var(--color-amber-400)]',
  },
  {
    id: 'green',
    label: 'Green',
    swatch: 'bg-green-500',
    iconColor: 'text-green-600 dark:text-green-400',
    bgClasses: 'bg-green-50 hover:bg-green-100 dark:bg-green-950 dark:hover:bg-green-900',
    inverseColor: 'bg-green-500 text-green-100 dark:bg-green-500',
    groupClasses:
      '[--icon-bg:var(--color-green-50)] [--icon-bg-hover:var(--color-green-100)] [--icon-color:var(--color-green-600)] dark:[--icon-bg:var(--color-green-950)] dark:[--icon-bg-hover:var(--color-green-900)] dark:[--icon-color:var(--color-green-400)]',
  },
  {
    id: 'emerald',
    label: 'Emerald',
    swatch: 'bg-emerald-500',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    bgClasses: 'bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950 dark:hover:bg-emerald-900',
    inverseColor: 'bg-emerald-500 text-emerald-100 dark:bg-emerald-500',
    groupClasses:
      '[--icon-bg:var(--color-emerald-50)] [--icon-bg-hover:var(--color-emerald-100)] [--icon-color:var(--color-emerald-600)] dark:[--icon-bg:var(--color-emerald-950)] dark:[--icon-bg-hover:var(--color-emerald-900)] dark:[--icon-color:var(--color-emerald-400)]',
  },
  {
    id: 'teal',
    label: 'Teal',
    swatch: 'bg-teal-500',
    iconColor: 'text-teal-600 dark:text-teal-400',
    bgClasses: 'bg-teal-50 hover:bg-teal-100 dark:bg-teal-950 dark:hover:bg-teal-900',
    inverseColor: 'bg-teal-500 text-teal-100 dark:bg-teal-500',
    groupClasses:
      '[--icon-bg:var(--color-teal-50)] [--icon-bg-hover:var(--color-teal-100)] [--icon-color:var(--color-teal-600)] dark:[--icon-bg:var(--color-teal-950)] dark:[--icon-bg-hover:var(--color-teal-900)] dark:[--icon-color:var(--color-teal-400)]',
  },
  {
    id: 'blue',
    label: 'Blue',
    swatch: 'bg-blue-500',
    iconColor: 'text-blue-600 dark:text-blue-400',
    bgClasses: 'bg-blue-50 hover:bg-blue-100 dark:bg-blue-950 dark:hover:bg-blue-900',
    inverseColor: 'bg-blue-500 text-blue-100 dark:bg-blue-500',
    groupClasses:
      '[--icon-bg:var(--color-blue-50)] [--icon-bg-hover:var(--color-blue-100)] [--icon-color:var(--color-blue-600)] dark:[--icon-bg:var(--color-blue-950)] dark:[--icon-bg-hover:var(--color-blue-900)] dark:[--icon-color:var(--color-blue-400)]',
  },
  {
    id: 'indigo',
    label: 'Indigo',
    swatch: 'bg-indigo-500',
    iconColor: 'text-indigo-600 dark:text-indigo-400',
    bgClasses: 'bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950 dark:hover:bg-indigo-900',
    inverseColor: 'bg-indigo-500 text-indigo-100 dark:bg-indigo-500',
    groupClasses:
      '[--icon-bg:var(--color-indigo-50)] [--icon-bg-hover:var(--color-indigo-100)] [--icon-color:var(--color-indigo-600)] dark:[--icon-bg:var(--color-indigo-950)] dark:[--icon-bg-hover:var(--color-indigo-900)] dark:[--icon-color:var(--color-indigo-400)]',
  },
  {
    id: 'purple',
    label: 'Purple',
    swatch: 'bg-purple-500',
    iconColor: 'text-purple-600 dark:text-purple-400',
    bgClasses: 'bg-purple-50 hover:bg-purple-100 dark:bg-purple-950 dark:hover:bg-purple-900',
    inverseColor: 'bg-purple-500 text-purple-100 dark:bg-purple-500',
    groupClasses:
      '[--icon-bg:var(--color-purple-50)] [--icon-bg-hover:var(--color-purple-100)] [--icon-color:var(--color-purple-600)] dark:[--icon-bg:var(--color-purple-950)] dark:[--icon-bg-hover:var(--color-purple-900)] dark:[--icon-color:var(--color-purple-400)]',
  },
  {
    id: 'pink',
    label: 'Pink',
    swatch: 'bg-pink-500',
    iconColor: 'text-pink-600 dark:text-pink-400',
    bgClasses: 'bg-pink-50 hover:bg-pink-100 dark:bg-pink-950 dark:hover:bg-pink-900',
    inverseColor: 'bg-pink-500 text-pink-50 dark:bg-pink-500',
    groupClasses:
      '[--icon-bg:var(--color-pink-50)] [--icon-bg-hover:var(--color-pink-100)] [--icon-color:var(--color-pink-600)] dark:[--icon-bg:var(--color-pink-950)] dark:[--icon-bg-hover:var(--color-pink-900)] dark:[--icon-color:var(--color-pink-400)]',
  },
]

/** Default color ID */
export const DEFAULT_COLOR = 'gray'

/** Get color configuration by ID */
export const getIconColor = (colorId: string): IconColor =>
  ICON_COLORS.find((c) => c.id === colorId) ?? ICON_COLORS[0]!

/** EntityIcon variants using CVA */
export const entityIconVariants = cva('flex items-center justify-center shrink-0', {
  variants: {
    variant: {
      default: 'rounded-md',
      full: 'rounded-full border',
      muted:
        'rounded-lg border bg-muted group-hover:bg-secondary transition-colors overflow-hidden',
      bare: 'text-current',
    },
    size: {
      xs: 'size-4 [&_svg]:size-2.5! [&_img]:size-2.5! [&_>span]:text-[10px]',
      sm: 'size-5 [&_svg]:size-3.5! [&_img]:size-3.5! [&_>span]:text-[14px]',
      default: 'size-6 [&_svg]:size-4! [&_img]:size-4! [&_>span]:text-[16px]',
      lg: 'size-8 [&_svg]:size-4 [&_img]:size-4 [&_>span]:text-[16px]',
      xl: 'size-10 [&_svg]:size-5 [&_img]:size-5 [&_>span]:text-[20px]',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
})

/** Props for EntityIcon component */
export interface EntityIconProps extends VariantProps<typeof entityIconVariants> {
  /** Icon ID from ICON_DATA (e.g., 'home', 'settings') */
  iconId: string
  /** Color ID from ICON_COLORS (e.g., 'blue', 'red') - optional */
  color?: string
  /** Use inverse color scheme (solid bg with white icon) */
  inverse?: boolean
  /** Optional inline style for dynamic colors (e.g., workflow nodes with hex colors) */
  style?: React.CSSProperties
  /** Additional classes for the wrapper div */
  className?: string
}

/** Standalone component for rendering an icon with color outside the picker */
export function EntityIcon({
  iconId,
  color,
  inverse = false,
  variant = 'default',
  size = 'default',
  style,
  className,
  ...props
}: EntityIconProps) {
  const iconData = getIcon(iconId)
  const colorData = color ? getIconColor(color) : null

  if (!iconData) return null

  const Icon = iconData.icon

  // When style is provided (e.g., hex colors), skip color classes
  const useColorClasses = !style && colorData

  return (
    <div
      className={cn(
        entityIconVariants({ variant, size }),
        useColorClasses && (inverse ? colorData?.inverseColor : colorData?.bgClasses),
        useColorClasses && !inverse && colorData?.iconColor,
        className
      )}
      style={style}
      {...props}>
      <Icon />
    </div>
  )
}
