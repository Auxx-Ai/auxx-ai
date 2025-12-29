// apps/web/src/components/ui/sidebar-button.tsx
'use client'

import * as React from 'react'
import { Button, type ButtonProps } from '@auxx/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@auxx/ui/components/tooltip'
import { useSidebar } from '@auxx/ui/components/sidebar'
import { cn } from '@auxx/ui/lib/utils'

export interface SidebarButtonProps extends ButtonProps {
  /**
   * Tooltip to show when sidebar is collapsed
   */
  tooltip?: string | React.ComponentProps<typeof TooltipContent>
}

/**
 * A Button component that shows a tooltip when the sidebar is collapsed
 */
const SidebarButton: React.FC<SidebarButtonProps> = ({
  tooltip,
  className,
  children,
  ...props
}) => {
  const { isMobile, state } = useSidebar()

  const button = (
    <Button
      className={cn(
        // Auto-transform to icon button when sidebar is collapsed
        'group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-2',
        className
      )}
      {...props}>
      {children}
    </Button>
  )

  // If no tooltip, just return the button
  if (!tooltip) {
    return button
  }

  // Convert string tooltip to object format
  if (typeof tooltip === 'string') {
    tooltip = { children: tooltip }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent
        side="right"
        align="center"
        hidden={state !== 'collapsed' || isMobile}
        {...tooltip}
      />
    </Tooltip>
  )
}

SidebarButton.displayName = 'SidebarButton'

export { SidebarButton }
