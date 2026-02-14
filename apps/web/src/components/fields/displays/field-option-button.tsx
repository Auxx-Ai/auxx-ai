'use client'

// apps/web/src/components/fields/displays/field-option-button.tsx

import { Button, type ButtonProps } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import type { MouseEvent, ReactNode } from 'react'
import { useCallback } from 'react'
import { Tooltip } from '~/components/global/tooltip'

/**
 * FieldOptionButtonProps interface
 * Defines the props accepted by FieldOptionButton
 */
interface FieldOptionButtonProps
  extends Omit<ButtonProps, 'aria-label' | 'children' | 'size' | 'asChild'> {
  label: string
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
  tooltipAlign?: 'start' | 'center' | 'end'
  href?: string
  target?: string
  rel?: string
  children: ReactNode
  asChild?: boolean
}

/**
 * baseButtonClass constant
 * Provides the shared button styling classes for field action buttons
 */
const baseButtonClass =
  'opacity-0 group-hover:opacity-100 group-hover:transition-opacity group-hover:duration-200 shadow-none [&_svg]:size-2.5!'

/**
 * FieldOptionButton component
 * Renders an icon button with consistent styling and tooltip support
 */
export function FieldOptionButton({
  label,
  tooltipSide,
  tooltipAlign,
  className,
  href,
  target,
  rel,
  children,
  asChild,
  ...buttonProps
}: FieldOptionButtonProps) {
  const { onClick: buttonOnClick, variant, ...restButtonProps } = buttonProps

  const handleClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      event.stopPropagation()
      if (buttonOnClick) {
        buttonOnClick(event as Parameters<NonNullable<ButtonProps['onClick']>>[0])
      }
    },
    [buttonOnClick]
  )

  const buttonContent = (
    <Button
      {...restButtonProps}
      asChild={Boolean(href) || Boolean(asChild)}
      size='icon-xs'
      variant='ghost'
      className={cn(
        baseButtonClass,
        'size-5 border border-black/4 bg-primary-150 hover:bg-primary-300/40 rounded-md',
        className
      )}
      aria-label={label}
      onClick={handleClick}>
      {href ? (
        <a href={href} target={target ?? '_blank'} rel={rel ?? 'noopener noreferrer'}>
          {children}
        </a>
      ) : (
        children
      )}
    </Button>
  )

  return buttonContent
}
