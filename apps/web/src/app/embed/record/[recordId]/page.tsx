// apps/web/src/app/embed/record/[recordId]/page.tsx

import { DehydrationService } from '@auxx/lib/dehydration'
import { BLOCKED_SUBSCRIPTION_STATUSES } from '@auxx/types/billing'
import { headers as nextHeaders } from 'next/headers'
import { auth } from '~/auth/server'
import { AuxxAppProviders } from '~/components/global/auxx-app-providers'
import { DehydratedStateProvider } from '~/providers/dehydrated-state-provider'
import { FeatureFlagProvider, OrganizationIdProvider } from '~/providers/feature-flag-provider'
import { EmbedRecordView } from './_components/embed-record-view'
import { EmbedShell } from './_components/embed-shell'

interface EmbedPageProps {
  params: Promise<{ recordId: string }>
  searchParams: Promise<{ token?: string; theme?: string }>
}

type EmbedTheme = 'light' | 'dark'

/** Parse the extension-provided theme query param into the supported values. */
function parseTheme(value: string | undefined): EmbedTheme {
  return value === 'dark' ? 'dark' : 'light'
}

/** Escape JSON for safe use inside inline scripts. */
function serializeForInlineScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
}

/** Check whether a subscription status should block field editing. */
function isBlockedSubscription(status: string | undefined | null): boolean {
  if (!status) return false
  return (BLOCKED_SUBSCRIPTION_STATUSES as readonly string[]).includes(status.toLowerCase())
}

/**
 * Renders the extension iframe's record view at `/embed/record/<recordId>`.
 *
 * Auth handshake:
 * - The extension passes a freshly-minted bearer token via `?token=...`.
 * - The server validates that token via better-auth's bearer plugin.
 * - The same token is exposed to the iframe document so client-side tRPC
 *   calls can send `Authorization: Bearer ...`.
 *
 * Subscription gate mirrors the (protected) layout — orgs whose subscription
 * has lapsed cannot edit fields from the extension panel.
 */
export default async function EmbedRecordPage({ params, searchParams }: EmbedPageProps) {
  const [{ recordId: rawRecordId }, sp, reqHeaders] = await Promise.all([
    params,
    searchParams,
    nextHeaders(),
  ])

  // Next.js leaves percent-encoded characters in `params` when the dynamic
  // segment was URL-encoded by the caller. RecordIds contain `:`, which Zod
  // validates strictly downstream — decode once so `params.recordId` is the
  // raw `<entityDefinitionId>:<entityInstanceId>` form regardless of how the
  // caller built the URL.
  const recordId = decodeURIComponent(rawRecordId)
  const theme = parseTheme(sp.theme)

  if (!sp.token) {
    return (
      <EmbedShell theme={theme}>
        <p className='p-3 text-sm text-muted-foreground'>
          Please open this record from the Auxx extension.
        </p>
      </EmbedShell>
    )
  }

  // Build a minimal Headers map with only the bearer token. Do not trust
  // ambient auxx.ai cookies here: this route is specifically an extension
  // embed surface, and direct third-party framing must not authenticate from
  // the user's normal web session.
  const authHeaders = new Headers()
  authHeaders.set('authorization', `Bearer ${sp.token}`)
  const forwardedFor = reqHeaders.get('x-forwarded-for')
  const userAgent = reqHeaders.get('user-agent')
  if (forwardedFor) authHeaders.set('x-forwarded-for', forwardedFor)
  if (userAgent) authHeaders.set('user-agent', userAgent)

  const session = await auth.api.getSession({ headers: authHeaders })
  if (!session?.user) {
    return (
      <EmbedShell theme={theme}>
        <p className='p-3 text-sm text-muted-foreground'>
          Please sign in to Auxx to view this record.
        </p>
      </EmbedShell>
    )
  }

  // Pull dehydrated state for org/feature/subscription context.
  const dehydrationService = new DehydrationService()
  let dehydratedState
  try {
    dehydratedState = await dehydrationService.getState(session.user.id)
  } catch {
    return (
      <EmbedShell theme={theme}>
        <p className='p-3 text-sm text-destructive'>
          Couldn't load your account. Reload the panel to try again.
        </p>
      </EmbedShell>
    )
  }

  // Subscription gate — match the (protected) layout's behavior.
  const currentOrg = dehydratedState.organizations.find(
    (o) => o.id === dehydratedState.organizationId
  )
  const subscription = currentOrg?.subscription ?? null
  const subscriptionExpired = subscription ? isBlockedSubscription(subscription.status) : false
  const trialExpired = subscription?.hasTrialEnded === true && subscription?.status === 'trialing'

  if (subscriptionExpired || trialExpired) {
    return (
      <EmbedShell theme={theme}>
        <p className='p-3 text-sm text-muted-foreground'>
          Your Auxx subscription is paused. Open Auxx to update billing.
        </p>
      </EmbedShell>
    )
  }

  return (
    <EmbedShell theme={theme}>
      {/* Override next-themes (mounted in the root ClientProviders) for the
          embed iframe. next-themes derives <html>'s class + color-scheme from
          localStorage at this origin or the iframe's prefers-color-scheme,
          neither of which reflects the parent extension's effective theme.
          Synchronous body script runs after next-themes' head script and
          wins. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){var t=${JSON.stringify(theme)};var h=document.documentElement;h.classList.toggle('dark',t==='dark');h.style.colorScheme=t;})()`,
        }}
      />
      <script
        id='embed-token'
        dangerouslySetInnerHTML={{
          __html: `window.AUXX_EMBED_TOKEN = ${serializeForInlineScript(sp.token)};`,
        }}
      />
      <script
        id='dehydrated-state'
        dangerouslySetInnerHTML={{
          __html: `window.AUXX_DEHYDRATED_STATE = ${serializeForInlineScript(dehydratedState)};`,
        }}
      />
      <DehydratedStateProvider initialState={dehydratedState}>
        <OrganizationIdProvider>
          <FeatureFlagProvider>
            <AuxxAppProviders>
              <EmbedRecordView recordId={recordId} />
            </AuxxAppProviders>
          </FeatureFlagProvider>
        </OrganizationIdProvider>
      </DehydratedStateProvider>
    </EmbedShell>
  )
}
