// apps/web/src/components/money/ui/settings/payments-page.tsx
'use client'

// Payments settings page (money MP1 build spec §G) — the org's Stripe Connect anchor.
// Member-safe: any org member can view connection state; connect/finish-setup/refresh/
// disconnect are admin-gated writes (the invoice-payments-card delete precedent).

import { FeatureKey } from '@auxx/lib/permissions/client'
import type { SettingValue } from '@auxx/lib/settings/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { Banknote, CreditCard, Lock, Mail } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { AdminGate } from '~/components/global/admin-gate'
import { EmptyState } from '~/components/global/empty-state'
import { FieldPanel } from '~/components/global/forms/field-panel'
import { FormSaveBar } from '~/components/global/forms/form-save-bar'
import { useDirtyDraft } from '~/components/global/forms/use-dirty-draft'
import SettingsPage, { SettingsSection } from '~/components/global/settings-page'
import { SettingsFieldRow } from '~/components/settings/settings-field-row'
import { useConfirm } from '~/hooks/use-confirm'
import { useSettings } from '~/hooks/use-settings'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'

/** Scalar `DOCUMENTS`-scope catalog keys the Payments page's own draft owns — partial payments
 * (moved from the old "Invoicing & Quoting" page) and the receipt-email toggle (moved from the
 * old Documents page). Independent of the Stripe connect state above, which mutates immediately. */
const DRAFT_KEYS = [
  'documents.invoice.allowPartialPayments',
  'documents.invoice.partialPaymentMinPercent',
  'documents.receiptEmail.enabled',
] as const

/** Where the Stripe hosted-provision flow returns after connect/finish-setup (money MP1
 * build spec §G — `hosted-provision` connect flow for the `stripeConnect` def). */
const STRIPE_CONNECT_START_URL =
  '/api/connections/stripeConnect/hosted-provision/start?returnTo=/app/dispatch/settings/payments'

/** `acct_1AbCdEfGh...` → `acct_…wXyZ` — never show the full id in the UI. */
function maskAccountId(stripeAccountId: string): string {
  const last4 = stripeAccountId.slice(-4)
  return `acct_…${last4}`
}

export function PaymentsSettingsPage() {
  const { hasAccess } = useFeatureFlags()
  const breadcrumbs = [{ title: 'Dispatch Settings' }, { title: 'Payments' }]

  if (!hasAccess(FeatureKey.dispatch)) {
    return (
      <SettingsPage
        title='Payments'
        description='Collect payments online by connecting your Stripe account.'
        breadcrumbs={breadcrumbs}>
        <EmptyState
          icon={Lock}
          title='Dispatch Not Available'
          description='Upgrade your plan to use quoting and dispatch.'
          button={<div className='h-12' />}
        />
      </SettingsPage>
    )
  }

  return <PaymentsSettingsBody breadcrumbs={breadcrumbs} />
}

function PaymentsSettingsBody({ breadcrumbs }: { breadcrumbs: { title: string }[] }) {
  const [confirm, ConfirmDialog] = useConfirm()
  const searchParams = useSearchParams()
  const handledReturnFlag = useRef(false)

  const utils = api.useUtils()
  const { data: account, isLoading } = api.money.getPaymentAccount.useQuery()

  const { getSetting, batchUpdateOrganizationSettings, isBatchUpdatingOrgSettings } = useSettings({
    scope: 'DOCUMENTS',
  })

  // Rebuilt each render; `useDirtyDraft` compares by value so a fresh identity never reseeds.
  const settingsServer: Record<string, SettingValue> = {}
  for (const key of DRAFT_KEYS) settingsServer[key] = getSetting(key)

  const {
    draft: settingsDraft,
    patch: patchSettings,
    dirty: settingsDirty,
    save: saveSettings,
    discard: discardSettings,
  } = useDirtyDraft(settingsServer, {
    isSaving: isBatchUpdatingOrgSettings,
    onSave: (next) => {
      const changed = DRAFT_KEYS.filter((key) => next[key] !== settingsServer[key]).map((key) => ({
        key,
        value: next[key],
      }))
      if (changed.length > 0) batchUpdateOrganizationSettings(changed)
    },
  })

  const controlledSetting = (key: (typeof DRAFT_KEYS)[number]) => ({
    value: settingsDraft[key],
    onChange: (value: unknown) => patchSettings({ [key]: value as SettingValue }),
  })

  const allowPartialPayments = !!settingsDraft['documents.invoice.allowPartialPayments']

  // Handle the return trip from the hosted-provision flow (§G — `?connected=1` /
  // `?connect_error=...`) once per mount: refetch state on success, toast on failure. The
  // exact query-param names are the connections-plan return route's contract — this page
  // only reacts to them, it doesn't mint them.
  useEffect(() => {
    if (handledReturnFlag.current) return
    const connected = searchParams.get('connected')
    const connectError = searchParams.get('connect_error')
    if (!connected && !connectError) return
    handledReturnFlag.current = true

    if (connectError) {
      toastError({ title: 'Stripe connection failed', description: connectError })
    } else {
      void utils.money.getPaymentAccount.invalidate()
    }
  }, [searchParams, utils])

  const syncAccountState = api.money.syncAccountState.useMutation({
    onSuccess: () => void utils.money.getPaymentAccount.invalidate(),
    onError: (error) =>
      toastError({ title: 'Error refreshing account status', description: error.message }),
  })

  const disconnectPayments = api.money.disconnectPayments.useMutation({
    onSuccess: () => void utils.money.getPaymentAccount.invalidate(),
    onError: (error) =>
      toastError({ title: 'Error disconnecting Stripe', description: error.message }),
  })

  const handleDisconnect = async () => {
    const confirmed = await confirm({
      title: 'Disconnect Stripe?',
      description:
        'Your invoices will no longer accept online payments until you reconnect. Existing payment history is kept.',
      confirmText: 'Disconnect',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) disconnectPayments.mutate()
  }

  const isConnected = !!account?.credentialId
  // Spec state is keyed on `detailsSubmitted === false`; `!chargesEnabled` is used instead
  // since it's the actual functional gate and is a superset (chargesEnabled implies
  // detailsSubmitted in practice, so this also safely covers the detailsSubmitted-true/
  // chargesEnabled-false review-pending gap the two-state spec doesn't name).
  const isOnboardingIncomplete = isConnected && !account.chargesEnabled

  return (
    <SettingsPage
      title='Payments'
      description='Collect payments online by connecting your Stripe account.'
      breadcrumbs={breadcrumbs}>
      <div className='flex flex-col gap-8 p-3 sm:p-6'>
        <SettingsSection
          icon={CreditCard}
          title='Stripe'
          description='Auxx uses Stripe Connect so your customers can pay invoices online — money settles directly into your Stripe balance.'>
          {isLoading ? (
            <div className='h-16 animate-pulse rounded-lg bg-muted' />
          ) : !isConnected ? (
            <div className='flex flex-col gap-3 rounded-lg border p-4'>
              <p className='text-sm text-muted-foreground'>
                Connect your Stripe account to add a "Pay online" link to invoice emails and PDFs.
              </p>
              <AdminGate action='connect Stripe'>
                <Button
                  type='button'
                  className='self-start'
                  onClick={() => window.location.assign(STRIPE_CONNECT_START_URL)}>
                  Connect Stripe
                </Button>
              </AdminGate>
              <div className='flex flex-col gap-1 border-t pt-3 text-xs text-muted-foreground'>
                <span>Auxx charges a 2% platform fee per payment.</span>
                <span>
                  Payouts run on your Stripe schedule — manage them in your Stripe dashboard.
                </span>
              </div>
            </div>
          ) : isOnboardingIncomplete ? (
            <div className='flex flex-col gap-3 rounded-lg border p-4'>
              <div className='flex items-center gap-2'>
                <Badge variant='amber' size='sm'>
                  Setup incomplete
                </Badge>
                <span className='text-sm text-muted-foreground'>
                  {maskAccountId(account.stripeAccountId)}
                </span>
              </div>
              <p className='text-sm text-muted-foreground'>
                Finish Stripe's onboarding to start accepting payments.
              </p>
              <div className='flex gap-2'>
                <AdminGate action='finish Stripe setup'>
                  <Button
                    type='button'
                    onClick={() => window.location.assign(STRIPE_CONNECT_START_URL)}>
                    Finish setup
                  </Button>
                </AdminGate>
                <AdminGate action='refresh Stripe status'>
                  <Button
                    type='button'
                    variant='outline'
                    loading={syncAccountState.isPending}
                    loadingText='Refreshing...'
                    onClick={() => syncAccountState.mutate()}>
                    Refresh status
                  </Button>
                </AdminGate>
              </div>
            </div>
          ) : (
            <div className='flex flex-col gap-3 rounded-lg border p-4'>
              <div className='flex items-center gap-2'>
                <Badge variant='green' size='sm'>
                  Connected
                </Badge>
                <span className='text-sm text-muted-foreground'>
                  {maskAccountId(account.stripeAccountId)}
                </span>
              </div>
              <dl className='grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:max-w-xs'>
                <dt className='text-muted-foreground'>Default currency</dt>
                <dd className='uppercase'>{account.defaultCurrency ?? '—'}</dd>
                <dt className='text-muted-foreground'>Platform fee</dt>
                <dd>{account.applicationFeePercent ?? 2}% per payment</dd>
              </dl>
              <p className='text-xs text-muted-foreground'>
                Payouts run on your Stripe schedule — manage them in your Stripe dashboard.
              </p>
              <AdminGate action='disconnect Stripe'>
                <Button
                  type='button'
                  variant='outline'
                  className='self-start text-destructive hover:text-destructive'
                  loading={disconnectPayments.isPending}
                  loadingText='Disconnecting...'
                  onClick={handleDisconnect}>
                  Disconnect
                </Button>
              </AdminGate>
            </div>
          )}
        </SettingsSection>

        <SettingsSection
          icon={Banknote}
          title='Partial payments'
          description='Let customers pay a custom amount on the public pay page instead of only the full balance.'>
          <FieldPanel
            className='mt-1 p-0'
            resizeId='partial-payments-settings'
            defaultLabelWidth={220}>
            <SettingsFieldRow
              settingKey='documents.invoice.allowPartialPayments'
              title='Allow partial payments'
              description='Applies to invoice payments; deposits are always paid in full.'
              {...controlledSetting('documents.invoice.allowPartialPayments')}
            />
            <div
              className={cn(
                'flex flex-col',
                !allowPartialPayments && 'pointer-events-none opacity-50'
              )}>
              <SettingsFieldRow
                settingKey='documents.invoice.partialPaymentMinPercent'
                title='Minimum payment percent'
                description='Smallest payment a customer can submit, as a percent of the current balance.'
                {...controlledSetting('documents.invoice.partialPaymentMinPercent')}
              />
            </div>
          </FieldPanel>
        </SettingsSection>

        <SettingsSection
          icon={Mail}
          title='Receipt email'
          description='Emails sent to the customer when they pay online.'>
          <FieldPanel
            className='mt-1 p-0'
            resizeId='receipt-email-settings'
            defaultLabelWidth={220}>
            <SettingsFieldRow
              settingKey='documents.receiptEmail.enabled'
              title='Email a receipt on payment'
              {...controlledSetting('documents.receiptEmail.enabled')}
            />
          </FieldPanel>
        </SettingsSection>

        <FormSaveBar
          dirty={settingsDirty}
          isSaving={isBatchUpdatingOrgSettings}
          onSave={saveSettings}
          onDiscard={discardSettings}
        />
      </div>
      <ConfirmDialog />
    </SettingsPage>
  )
}
