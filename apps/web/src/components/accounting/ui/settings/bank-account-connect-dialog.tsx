// apps/web/src/components/accounting/ui/settings/bank-account-connect-dialog.tsx
'use client'

// "Connect a bank" (plans/accounting/ui-plan.md §2.7, HANDOFF slot 3A).
//
// 🛑 This component branches on WHAT CAME BACK, never on which provider it is talking
// to (decision B13). `banking.connect` answers a start URL plus the provider's DECLARED
// capabilities; the start route answers either a redirect or `{ kind: 'embed', config }`;
// this file navigates in the first case and mounts a widget in the second. The
// acceptance test is that a second aggregator of the same shape needs zero changes
// here - only a `PlatformProviderDef`.
//
// ⚠️ The one thing that IS provider-specific is `stripe.collectFinancialConnectionsAccounts`,
// and that is unavoidable: mounting a widget means loading that vendor's script. It is
// isolated in `runEmbeddedFlow` below and reached only when the definition declared
// `embed`, so it is a renderer selected by data rather than a branch on a name.
//
// 🛑 The flow finishes in the tab it started in. Financial Connections has NO
// provider-hosted page - the session hands back a client secret and the modal opens on
// our own page - so there is no navigation for the return route to catch, and the
// browser POSTs the result back itself.

import type { BankConnectionStart } from '@auxx/lib/banking/client'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Building2, Landmark, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useCallback, useState } from 'react'
import { getStripePromise } from '~/lib/stripe'

/** What the start route answers for an `embed` provider. */
interface EmbedStartResponse {
  kind: 'embed'
  config: Record<string, unknown>
  /** The one-shot token the return route keys on. Minted behind the session check. */
  state: string
  /** Absolute URL of the return route, which this posts the result to. */
  returnUrl: string
}

type Phase = 'intro' | 'starting' | 'authenticating' | 'saving' | 'error' | 'empty'

interface BankAccountConnectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Starts the flow: `banking.connect` or `banking.reconnect`. */
  onStart: () => Promise<BankConnectionStart>
  /** Called after the credentials land, with how many accounts were connected. */
  onConnected: (accounts: number) => void
  /** Set when this is a reconnect, so the copy says so. */
  reconnecting?: boolean
}

export function BankAccountConnectDialog({
  open,
  onOpenChange,
  onStart,
  onConnected,
  reconnecting = false,
}: BankAccountConnectDialogProps) {
  const [phase, setPhase] = useState<Phase>('intro')
  const [message, setMessage] = useState<string | null>(null)

  const reset = useCallback(() => {
    setPhase('intro')
    setMessage(null)
  }, [])

  const connect = useCallback(async () => {
    setMessage(null)
    setPhase('starting')
    try {
      const start = await onStart()

      // The redirect branch. A provider that hosts its own page gets a full-page
      // navigation, and this dialog never renders anything further.
      if (!start.embed) {
        window.location.href = start.startUrl
        return
      }

      const response = await fetch(start.startUrl, {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
      })
      const body = (await response.json()) as EmbedStartResponse | { error?: string }
      if (!response.ok || !('kind' in body) || body.kind !== 'embed') {
        throw new Error(
          ('error' in body && body.error) || 'The bank connection could not be started.'
        )
      }

      setPhase('authenticating')
      const sessionId = await runEmbeddedFlow(body.config)
      if (!sessionId) {
        // The user opened the modal and linked nothing. An ordinary outcome, and it
        // reads as one: no error styling, no half-made account.
        setPhase('empty')
        return
      }

      setPhase('saving')
      // ⚠️ POST to the return route on THIS origin, not to the absolute URL the start
      // route built. That URL is deliberately anchored on `NGROK_URL || WEBAPP_URL`
      // because a PROVIDER has to be able to reach it from the internet; the browser
      // is already on our page and does not, and posting cross-origin to a tunnel adds
      // a CORS failure and a second cookie jar for nothing.
      const saved = await fetch(sameOriginPath(body.returnUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ state: body.state, payload: { sessionId } }),
      })
      const savedBody = (await saved.json()) as { credentialIds?: string[]; error?: string }
      if (!saved.ok) {
        throw new Error(savedBody.error || 'The bank connected but could not be saved.')
      }

      onConnected(savedBody.credentialIds?.length ?? 0)
      reset()
      onOpenChange(false)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The bank connection failed.')
      setPhase('error')
    }
  }, [onStart, onConnected, onOpenChange, reset])

  const busy = phase === 'starting' || phase === 'authenticating' || phase === 'saving'

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return
        if (!next) reset()
        onOpenChange(next)
      }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{reconnecting ? 'Reconnect this bank' : 'Connect a bank'}</DialogTitle>
          <DialogDescription>
            {reconnecting
              ? 'Sign in at your bank again to restart the feed. Every transaction already synced is kept.'
              : 'Sign in at your bank to pull transactions automatically. You choose which accounts to share.'}
          </DialogDescription>
        </DialogHeader>

        <div className='flex flex-col gap-3 text-sm'>
          <div className='flex items-start gap-2'>
            <ShieldCheck className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
            <span className='text-muted-foreground'>
              Your bank credentials go to your bank, never to us. We only ever receive read-only
              transaction data for the accounts you pick.
            </span>
          </div>
          <div className='flex items-start gap-2'>
            <Landmark className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
            <span className='text-muted-foreground'>
              {/* The 180-day window is a fact about the product, not a caveat to bury.
                  It is what decides how much a customer has to import by hand, and
                  saying it here is what makes "connect early" a decision rather than a
                  surprise (plans/bank-connection/01 §4.1). */}
              US bank accounts. We can pull up to 180 days of history from today, and everything
              after that as it happens, so connecting early banks history for free.
            </span>
          </div>

          {phase === 'authenticating' && (
            <p className='text-muted-foreground'>Waiting for your bank…</p>
          )}
          {phase === 'saving' && <p className='text-muted-foreground'>Setting up the feed…</p>}

          {phase === 'empty' && (
            <div className='flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3'>
              <Building2 className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
              <span>
                No accounts were linked. Nothing was changed. Try again, or add the account by hand
                and import statements into it.
              </span>
            </div>
          )}

          {phase === 'error' && message && (
            <div className='flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3'>
              <TriangleAlert className='mt-0.5 size-4 shrink-0 text-destructive' />
              <span>{message}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant='ghost' disabled={busy} onClick={() => onOpenChange(false)}>
            {phase === 'empty' || phase === 'error' ? 'Close' : 'Cancel'}
          </Button>
          <Button loading={busy} loadingText='Connecting...' onClick={connect}>
            <Landmark />
            {phase === 'error' || phase === 'empty' ? 'Try again' : 'Continue'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The path+query of a return URL, on the current origin.
 *
 * Falls back to the URL as given when it will not parse: a relative value is already
 * what this wants.
 */
function sameOriginPath(returnUrl: string): string {
  try {
    const url = new URL(returnUrl, window.location.origin)
    return `${url.pathname}${url.search}`
  } catch {
    return returnUrl
  }
}

/**
 * Mount the provider's own authentication modal and return the session it produced.
 *
 * Returns `null` when the user linked nothing, which is not an error: an empty
 * `accounts` array is exactly what Stripe answers when somebody closes the modal, and
 * treating it as a failure would show a red box for a decision the user made.
 */
async function runEmbeddedFlow(config: Record<string, unknown>): Promise<string | null> {
  const clientSecret = typeof config.clientSecret === 'string' ? config.clientSecret : null
  const sessionId = typeof config.sessionId === 'string' ? config.sessionId : null
  if (!clientSecret || !sessionId) {
    throw new Error('The bank connection did not come back with a session.')
  }

  const stripe = await getStripePromise()
  if (!stripe) {
    throw new Error(
      'Payments are not configured on this deployment, so a bank cannot be connected. Add the account by hand and import statements into it.'
    )
  }

  const result = await stripe.collectFinancialConnectionsAccounts({ clientSecret })
  if (result.error) {
    throw new Error(result.error.message ?? 'Your bank did not complete the connection.')
  }
  const accounts = result.financialConnectionsSession?.accounts ?? []
  return accounts.length > 0 ? sessionId : null
}
