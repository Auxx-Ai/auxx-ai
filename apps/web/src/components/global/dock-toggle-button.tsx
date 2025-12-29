// apps/web/src/components/global/dock-toggle-button.tsx
'use client'

import { Button, type ButtonProps } from '@auxx/ui/components/button'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import { useDockStore } from '~/stores/dock-store'

interface DockToggleButtonProps {
  className?: string
  variant?: ButtonProps['variant']
  size?: ButtonProps['size']
}

/**
 * Button to toggle between docked and overlay drawer modes.
 */
export function DockToggleButton({
  className,
  variant = 'ghost',
  size = 'icon-xs',
}: DockToggleButtonProps) {
  const isDocked = useDockStore((state) => state.isDocked)
  const toggleDock = useDockStore((state) => state.toggleDock)

  return (
    <Tooltip content={isDocked ? 'Undock panel' : 'Dock panel'}>
      <Button variant={variant} size={size} onClick={toggleDock} className={className}>
        {isDocked ? <PanelRightClose /> : <PanelRightOpen />}
      </Button>
    </Tooltip>
  )
}
