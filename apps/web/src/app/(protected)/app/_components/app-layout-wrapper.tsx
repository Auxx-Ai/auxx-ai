// apps/web/src/app/(protected)/app/_components/app-layout-wrapper.tsx
'use client'

import type { DehydratedOrganization } from '@auxx/lib/dehydration'
import { BLOCKED_SUBSCRIPTION_STATUSES } from '@auxx/types/billing'
import type { ReactNode } from 'react'
import { useOAuthReturn } from '~/components/apps/hooks/use-oauth-return'
import { ChannelProvider } from '~/components/channels/providers/channel-provider'
import { ViewStoreProvider } from '~/components/dynamic-table/context/view-store-provider'
import { AuxxAppProviders } from '~/components/global/auxx-app-providers'
import { Dashboard } from '~/components/global/dashboard'
import { GlobalCreateRoot } from '~/components/global-create/global-create-root'
import { CommandPalette } from '~/components/kbar'
import { SimpleLayout } from '~/components/layouts/simple-layout'
import { FloatingComposeRoot } from '~/components/mail/email-editor/floating-compose-root'
import { GlobalRecordEditorRoot } from '~/components/records/global-record-editor-root'
import { SignatureDialogRoot } from '~/components/signatures/ui/signature-dialog-root'
import { SnippetDialogRoot } from '~/components/snippets/ui/snippet-dialog-root'
import { SubscriptionEnded } from '~/components/subscriptions/subscription-ended'
import { FloatingTaskEditorRoot } from '~/components/tasks/ui/floating-task-editor-root'
import { FloatingTaskRoot } from '~/components/tasks/ui/floating-task-root'
import { ThreadActionsProvider, ThreadDataProvider } from '~/components/threads'
import { useIsSelfHosted } from '~/hooks/use-deployment-mode'
import { useDehydratedOrganizations } from '~/providers/dehydrated-state-provider'
import { useOrganizationIdContext } from '~/providers/feature-flag-provider'

interface AppLayoutWrapperProps {
  children: ReactNode
  user: any
  /** SSR sidebar open state from cookie — forwarded to `Dashboard`'s `SidebarProvider`. */
  defaultSidebarOpen?: boolean
  /** SSR sidebar width (px) from cookie — forwarded to `Dashboard`'s `SidebarProvider`. */
  defaultSidebarWidth?: number
}

/** Helper function to check if subscription is expired */
function isSubscriptionExpired(subscription: DehydratedOrganization['subscription']): boolean {
  if (!subscription) return false
  return (BLOCKED_SUBSCRIPTION_STATUSES as readonly string[]).includes(
    subscription.status.toLowerCase()
  )
}

/** Helper function to check if trial is expired */
function isTrialExpired(subscription: DehydratedOrganization['subscription']): boolean {
  if (!subscription) return false
  return subscription.hasTrialEnded && subscription.status.toLowerCase() === 'trialing'
}

/**
 * Client wrapper that checks subscription and conditionally renders Dashboard or SubscriptionEnded
 */
export function AppLayoutWrapper({
  children,
  user,
  defaultSidebarOpen,
  defaultSidebarWidth,
}: AppLayoutWrapperProps) {
  const organizations = useDehydratedOrganizations()
  const { organizationId: currentOrgId } = useOrganizationIdContext()
  const selfHosted = useIsSelfHosted()

  // Global popup-blocker fallback: when an OAuth connect falls back to
  // window.location.href, the callback redirect lands with oauth_success /
  // oauth_error params that need a toast + connection-list invalidation
  // regardless of which surface kicked the flow. Hoisting it here covers
  // the workflow editor, agent editor, and installed-apps settings page
  // with a single mount.
  useOAuthReturn()

  const currentOrg = organizations.find((org) => org.id === currentOrgId)

  // Self-hosted deployments skip subscription checks entirely
  const subscriptionExpired = !selfHosted && isSubscriptionExpired(currentOrg?.subscription ?? null)
  const trialExpired = !selfHosted && isTrialExpired(currentOrg?.subscription ?? null)

  // Show subscription ended screen if expired or trial ended
  if (subscriptionExpired || trialExpired) {
    return (
      <SimpleLayout>
        <SubscriptionEnded
          isTrialEnded={trialExpired}
          organizationName={currentOrg?.name}
          otherOrganizationsCount={organizations.length - 1}
          planName={currentOrg?.subscription?.plan ?? null}
        />
      </SimpleLayout>
    )
  }

  // Active subscription — wrap chrome around the shared provider stack.
  return (
    <ViewStoreProvider>
      <AuxxAppProviders>
        <ChannelProvider>
          <ThreadDataProvider>
            <ThreadActionsProvider>
              <Dashboard
                user={user}
                defaultSidebarOpen={defaultSidebarOpen}
                defaultSidebarWidth={defaultSidebarWidth}>
                {children}
              </Dashboard>
              <FloatingComposeRoot />
              <FloatingTaskRoot />
              <FloatingTaskEditorRoot />
              <GlobalCreateRoot />
              <GlobalRecordEditorRoot />
              <SignatureDialogRoot />
              <SnippetDialogRoot />
              <CommandPalette />
            </ThreadActionsProvider>
          </ThreadDataProvider>
        </ChannelProvider>
      </AuxxAppProviders>
    </ViewStoreProvider>
  )
}
