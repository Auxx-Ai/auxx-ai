// apps/web/src/components/apps/ui/connect-button.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { type ConnectTarget, useConnectFlow } from '../hooks/use-connect-flow'

type Scope = 'user' | 'organization'

interface ConnectButtonProps {
  target: ConnectTarget
  scope: Scope
  returnTo?: string
  label?: ReactNode
  size?: 'sm' | 'default'
  variant?: 'default' | 'outline' | 'ghost'
  className?: string
  /** Set true when the caller lacks permission for this scope (renders disabled with tooltip text). */
  disabled?: boolean
  disabledReason?: string
  /** Fired when a connect attempt produces a new credId. */
  onConnected?: (credId: string) => void
}

/**
 * One-click "Connect" button that owns its connect flow via `useConnectFlow`.
 * Caller passes a normalized `ConnectTarget` + scope; the button handles
 * OAuth popup/redirect, variable input, or secret form depending on the
 * app's connectionType. See plans/kopilot/apps/app-settings-dialog-refactor.md §5.2.
 */
export function ConnectButton({
  target,
  scope,
  returnTo,
  label,
  size = 'sm',
  variant = 'outline',
  className,
  disabled,
  disabledReason,
  onConnected,
}: ConnectButtonProps) {
  const flow = useConnectFlow({
    onConnected: onConnected
      ? (credId) => {
          onConnected(credId)
        }
      : undefined,
  })

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={cn(className)}
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
        onClick={() => flow.start({ target, scope, returnTo })}>
        <Plus />
        {label ?? 'Add Connection'}
      </Button>
      {flow.Dialogs}
    </>
  )
}
