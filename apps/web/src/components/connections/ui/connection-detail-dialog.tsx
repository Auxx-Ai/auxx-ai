// apps/web/src/components/connections/ui/connection-detail-dialog.tsx
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
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import type { FormEvent } from 'react'
import { useEffect, useMemo, useState } from 'react'
import {
  ConnectionDetailPage,
  type DetailMethod,
  methodIsBareSecret,
} from './connection-detail-page'
import { seedValue, validateConnectionVariables } from './connection-variable-validation'

interface ConnectionDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Dialog heading, e.g. "Connect Stripe" / "Reconnect Postgres". */
  title: string
  /** The single resolved method (connectionType + connectionVariables + global). */
  method: DetailMethod
  /** Reconnect: plain values to seed (secrets are never prefilled). */
  prefill?: Record<string, string>
  /** Disables the form while a save mutation is in flight. */
  pending?: boolean
  /** Footer button label. Defaults to "Connect". */
  submitLabel?: string
  onSubmit: (payload: { values?: Record<string, string>; secret?: string }) => void
}

/**
 * Single-method connect/reconnect/edit dialog — `ConnectionDetailPage` minus the method
 * chooser, wrapped in a `Dialog`. Owns the field state, seeds it on open (declared defaults +
 * reconnect prefill), validates with the shared rich ruleset, and returns `{ values }` (or
 * `{ secret }` for a bare API-key method) to the caller. A bare OAuth method renders no fields
 * and connects one-click. Backs `useConnectFlow` and the standalone secret-edit surfaces.
 */
export function ConnectionDetailDialog({
  open,
  onOpenChange,
  title,
  method,
  prefill,
  pending,
  submitLabel = 'Connect',
  onSubmit,
}: ConnectionDetailDialogProps) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [token, setToken] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Stable across renders so the seed effect only fires on open / method change, not every render
  // (a bare method's `?? []` would otherwise re-seed and wipe input on each render).
  const variables = useMemo(() => method.connectionVariables ?? [], [method.connectionVariables])

  // Seed the form each time the dialog opens — reconnect prefills plain values, defaults fill the rest.
  useEffect(() => {
    if (!open) return
    const seeded: Record<string, string> = {}
    for (const v of variables) seeded[v.key] = seedValue(v, prefill)
    setValues(seeded)
    setToken('')
    setErrors({})
  }, [open, prefill, variables])

  const bareSecret = methodIsBareSecret(method)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const next = validateConnectionVariables({
      variables,
      values,
      requireToken: bareSecret,
      token,
    })
    setErrors(next)
    if (Object.keys(next).length > 0) return
    // Only the currently-visible fields ride along; a bare API-key method submits the token.
    onSubmit(bareSecret ? { secret: token } : { values })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onOpenChange(false)
        else onOpenChange(true)
      }}>
      <DialogContent position='tc' size='lg'>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {/* `method.label` is the plain connection name; `title` carries the verb (Connect/Reconnect). */}
            <DialogDescription>
              {method.description ?? `Provide the following details to connect ${method.label}.`}
            </DialogDescription>
          </DialogHeader>

          <ConnectionDetailPage
            methods={[method]}
            selectedMethodId={method.id}
            onMethodChange={() => {}}
            values={values}
            onValueChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
            token={token}
            onTokenChange={setToken}
            errors={errors}
            disabled={pending}
            className='px-0 py-0'
          />

          <DialogFooter>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={() => onOpenChange(false)}
              disabled={pending}>
              Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
            </Button>
            {/* A bare OAuth method renders no fields — this button is the one-click connect. */}
            <Button
              type='submit'
              variant='outline'
              size='sm'
              loading={pending}
              loadingText='Connecting...'
              data-dialog-submit>
              {submitLabel} <KbdSubmit variant='outline' size='sm' />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
