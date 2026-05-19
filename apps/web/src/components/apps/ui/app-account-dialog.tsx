// apps/web/src/components/apps/ui/app-account-dialog.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Field, FieldLabel } from '@auxx/ui/components/field'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { useEffect, useMemo, useState } from 'react'
import { useExtensionsContext } from '~/providers/extensions/extensions-context'
import { AppAccountPopover } from './app-account-popover'
import { AppIcon } from './app-icon'

interface AppAccountDialogProps {
  /** App id (slug) the dialog is bound to. `null` keeps the dialog closed. */
  appId: string | null
  /** Currently-bound credId(s). Seeds the dialog's pending selection. */
  value: string | string[] | undefined
  /** Fires only when the user clicks Submit, with the final selection. */
  onSubmit: (value: string | string[] | undefined) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Dialog shell that hosts `AppAccountPopover`. Holds the pending selection
 * locally — picks from the popover only mutate `pending`, and the host's
 * `onSubmit` is fired only when the user clicks Submit. Cancel discards.
 *
 * See plans/kopilot/apps/app-account-picker-command-refactor.md §2.
 */
export function AppAccountDialog({
  appId,
  value,
  onSubmit,
  open,
  onOpenChange,
}: AppAccountDialogProps) {
  const { appInstallations } = useExtensionsContext()
  const installation = useMemo(
    () => (appId ? appInstallations.find((i) => i.app.id === appId) : null),
    [appInstallations, appId]
  )
  const appName = installation?.app.title ?? ''
  const avatarUrl = installation?.app.avatarUrl ?? null

  const [pending, setPending] = useState<string | string[] | undefined>(value)
  useEffect(() => {
    if (open) setPending(value)
  }, [open, value])

  const handlePick = (credId: string) => {
    setPending((prev) => {
      if (Array.isArray(prev)) {
        return prev.includes(credId) ? prev.filter((id) => id !== credId) : [...prev, credId]
      }
      return credId
    })
  }

  const handleSubmit = () => {
    onSubmit(pending)
    onOpenChange(false)
  }

  const dirty = !isSameSelection(pending, value)

  return (
    <Dialog open={open && !!appId} onOpenChange={onOpenChange}>
      <DialogContent size='sm' position='tc'>
        <DialogHeader>
          <div className='flex items-center gap-2'>
            {avatarUrl && <AppIcon iconId={avatarUrl} size='sm' />}
            <DialogTitle>Account for {appName}</DialogTitle>
          </div>
          <DialogDescription>
            Choose which connected account this agent uses when running {appName} tools.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel>Account</FieldLabel>
          <AppAccountPopover
            appId={appId}
            value={pending}
            onPick={handlePick}
            onConnected={handlePick}
          />
        </Field>
        <DialogFooter>
          <Button type='button' size='sm' variant='ghost' onClick={() => onOpenChange(false)}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            type='button'
            size='sm'
            variant='outline'
            disabled={!dirty}
            onClick={handleSubmit}>
            Submit <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function isSameSelection(
  a: string | string[] | undefined,
  b: string | string[] | undefined
): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    const set = new Set(a)
    return b.every((id) => set.has(id))
  }
  return false
}
