// apps/web/src/components/connections/ui/connection-detail-dialog.tsx
'use client'

import { HIDDEN_VALUE } from '@auxx/credentials/crypto/client'
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
import { api } from '~/trpc/react'
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
  /**
   * Editing/reconnecting an existing connection. When set, the dialog loads the stored values via
   * `connections.getForEdit` — plain vars real, secrets as the masked "is set" sentinel — so the
   * form shows what's saved without the real secret ever reaching the client.
   */
  connectionId?: string
  /** Reconnect: extra plain values to seed (merged under the loaded `getForEdit` values). */
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
  connectionId,
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

  // Editing: load the masked stored values (secrets as the sentinel, plain vars real). Skipped for
  // a fresh connect, so "+ New connection" still starts blank and requires every secret entered.
  const needsLoad = !!connectionId
  const editLoad = api.connections.getForEdit.useQuery(
    { connectionId: connectionId ?? '' },
    { enabled: open && needsLoad }
  )

  // Seed the form when the dialog opens (and, for an edit, once the masked values have loaded so we
  // don't first flash blank then clobber the user's keystrokes). `getForEdit` values win over the
  // caller's `prefill`; declared defaults fill anything neither supplies.
  const loaded = editLoad.data
  // biome-ignore lint/correctness/useExhaustiveDependencies: `loaded` captures the resolved query data.
  useEffect(() => {
    if (!open) return
    if (needsLoad && !loaded) return
    const merged = { ...prefill, ...(loaded?.values ?? {}) }
    const seeded: Record<string, string> = {}
    for (const v of variables) seeded[v.key] = seedValue(v, merged)
    setValues(seeded)
    setToken(loaded?.tokenSet ? HIDDEN_VALUE : '')
    setErrors({})
  }, [open, prefill, variables, needsLoad, loaded])

  const bareSecret = methodIsBareSecret(method)
  const formPending = pending || (needsLoad && !loaded)

  // Secret fields that arrived already set (seeded as the sentinel) can be reverted to "keep
  // existing" after the user starts editing them.
  const savedSecrets = useMemo(() => {
    const keys = Object.entries(loaded?.values ?? {})
      .filter(([, v]) => v === HIDDEN_VALUE)
      .map(([k]) => k)
    return new Set(keys)
  }, [loaded])

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
            disabled={formPending}
            savedSecrets={savedSecrets}
            tokenSaved={!!loaded?.tokenSet}
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
              disabled={formPending}
              data-dialog-submit>
              {submitLabel} <KbdSubmit variant='outline' size='sm' />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
