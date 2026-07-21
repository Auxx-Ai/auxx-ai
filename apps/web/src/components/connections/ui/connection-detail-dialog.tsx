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
import { useCredentialForm } from '~/components/connections/hooks/use-credential-form'
import { api } from '~/trpc/react'
import {
  applyOwnClientDisclosure,
  ConnectionDetailPage,
  type DetailMethod,
  methodIsBareSecret,
  methodOffersOwnClient,
} from './connection-detail-page'
import { validateConnectionVariables } from './connection-variable-validation'

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
  /** Footer button busy text. Defaults to "Connecting...". */
  loadingText?: string
  /** Override the description copy (e.g. the edit dialog isn't "connecting"). */
  description?: string
  /** Render the editable connection-name row at the top of the form (edit/rename). */
  showName?: boolean
  /** Seeds the name input when `showName`. Defaults to `method.label`. */
  initialName?: string
  /**
   * Secondary footer action — when set, a button (default "Reconnect") sits left of the primary.
   * Used by the edit dialog for one-click OAuth connections, which rename via Save and re-authorize
   * via this button. Omitted for the connect/secret flows.
   */
  onReconnect?: () => void
  reconnectLabel?: string
  onSubmit: (payload: { values?: Record<string, string>; secret?: string; name?: string }) => void
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
  loadingText = 'Connecting...',
  description,
  showName,
  initialName,
  onReconnect,
  reconnectLabel = 'Reconnect',
  onSubmit,
}: ConnectionDetailDialogProps) {
  const [token, setToken] = useState('')
  const [name, setName] = useState('')
  // BYO disclosure (§3.1, ownClientOptional): platform login is primary; the client fields
  // only render — and only become required — once the user opens the advanced section.
  const [byoOpen, setByoOpen] = useState(false)

  // Stable across renders so the seed effect only fires on open / method change, not every render
  // (a bare method's `?? []` would otherwise re-seed and wipe input on each render). Kept as the
  // FULL gated set (incl. optional BYO fields) so toggling the disclosure never reseeds the form.
  const variables = useMemo(() => method.connectionVariables ?? [], [method.connectionVariables])

  // The disclosure-shaped view of the method: closed drops the BYO fields (one-click platform
  // login), open renders them as required. Rendering/validation/submit all use this view.
  const offersOwnClient = methodOffersOwnClient(method)
  const effectiveMethod = useMemo(
    () => applyOwnClientDisclosure(method, byoOpen),
    [method, byoOpen]
  )
  const effectiveVariables = useMemo(
    () => effectiveMethod.connectionVariables ?? [],
    [effectiveMethod.connectionVariables]
  )

  // Editing: load the masked stored values (secrets as the sentinel, plain vars real). Skipped for
  // a fresh connect, so "+ New connection" still starts blank and requires every secret entered.
  const needsLoad = !!connectionId
  const editLoad = api.connections.getForEdit.useQuery(
    { connectionId: connectionId ?? '' },
    { enabled: open && needsLoad }
  )
  const loaded = editLoad.data

  // Shared form lifecycle — field values/errors, seed-on-open, set-secret derivation, validation.
  const { values, setValue, errors, setErrors, savedSecrets } = useCredentialForm({
    open,
    variables,
    existingValues: loaded?.values,
    loading: needsLoad && !loaded,
    prefill,
  })

  // Token + name are connection-specific (a bare API-key row, the editable connection name), so
  // they seed alongside the shared values effect on open / load. The BYO disclosure re-opens when
  // editing a connection that was made with its own client (stored clientId), else starts closed.
  useEffect(() => {
    if (!open) return
    if (needsLoad && !loaded) return
    setToken(loaded?.tokenSet ? HIDDEN_VALUE : '')
    setName(initialName ?? method.label)
    setByoOpen(!!loaded?.values?.clientId)
  }, [open, needsLoad, loaded, initialName, method.label])

  const bareSecret = methodIsBareSecret(method)
  const formPending = pending || (needsLoad && !loaded)

  // A bare-OAuth method has neither a token row nor variables — its edit dialog is name-only.
  // Uses the disclosure-shaped set: a closed optional-BYO method is one-click platform login.
  const hasFields = bareSecret || effectiveVariables.length > 0

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    // Validate only the visible fields — with the disclosure open the BYO pair is required.
    const next = validateConnectionVariables({
      variables: effectiveVariables,
      values,
      requireToken: bareSecret,
      token,
    })
    setErrors(next)
    if (Object.keys(next).length > 0) return
    const payload: { values?: Record<string, string>; secret?: string; name?: string } = {}
    if (showName) payload.name = name.trim()
    // Only the currently-visible fields ride along; a bare API-key method submits the token.
    if (hasFields) {
      if (bareSecret) payload.secret = token
      else {
        const visible = new Set(effectiveVariables.map((v) => v.key))
        payload.values = Object.fromEntries(
          Object.entries(values).filter(([key]) => visible.has(key))
        )
      }
    }
    onSubmit(payload)
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
              {description ??
                method.description ??
                (hasFields
                  ? `Provide the following details to connect ${method.label}.`
                  : `Sign in to connect ${method.label}.`)}
            </DialogDescription>
          </DialogHeader>

          <ConnectionDetailPage
            methods={[effectiveMethod]}
            selectedMethodId={method.id}
            onMethodChange={() => {}}
            byoOpen={byoOpen}
            onByoOpenChange={offersOwnClient ? setByoOpen : undefined}
            values={values}
            onValueChange={setValue}
            token={token}
            onTokenChange={setToken}
            errors={errors}
            disabled={formPending}
            savedSecrets={savedSecrets}
            tokenSaved={!!loaded?.tokenSet}
            showName={showName}
            name={name}
            onNameChange={setName}
            className='px-0 py-0'
          />

          <DialogFooter>
            {/* One-click OAuth edit: re-authorize without leaving the rename dialog. Pinned left
                (`sm:mr-auto`) so it's separated from the Cancel/Save group on the right. */}
            {onReconnect && (
              <Button
                type='button'
                variant='ghost'
                size='sm'
                className='sm:mr-auto'
                onClick={onReconnect}
                disabled={formPending}>
                {reconnectLabel}
              </Button>
            )}
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={() => onOpenChange(false)}
              disabled={pending}>
              Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
            </Button>
            {/* A bare OAuth method renders no fields — this button is the one-click connect/save. */}
            <Button
              type='submit'
              variant='outline'
              size='sm'
              loading={pending}
              loadingText={loadingText}
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
