// packages/lib/src/money/payments/connect.ts

import type {
  HostedProvisionCompleteCtx,
  HostedProvisionCompleteResult,
  HostedProvisionHandler,
  HostedProvisionStartCtx,
} from '../../connections/hosted-provision/types'
import { NotFoundError } from '../../errors'
import { getPaymentAccount, upsertPaymentAccount } from './account-state'
import { getStripeConnectClient } from './connect-client'

/**
 * Stripe Connect (Account Links) `hosted-provision` handler — money MP1 §C/§D.2. Creates a
 * Standard-equivalent controller account on first connect (merchant pays Stripe fees, carries
 * payment losses, gets the full dashboard, Stripe collects requirements — 04-payments' "merchant
 * owns disputes/compliance"), then sends the user through hosted Account Links onboarding.
 * `start` is create-or-reuse so a mid-flow `refresh_url` re-mint never provisions a second
 * account. Resolved lazily from `resolveHostedProvisionHandler` — this module must never be
 * statically imported by `connections/*`.
 */
export const stripeConnectHandler: HostedProvisionHandler = {
  landingPath: '/app/dispatch/settings/payments',

  async start(ctx: HostedProvisionStartCtx): Promise<{ redirectUrl: string }> {
    const stripe = getStripeConnectClient()

    const existing = await getPaymentAccount(ctx.organizationId)
    let stripeAccountId = existing?.stripeAccountId ?? null

    if (!stripeAccountId) {
      const account = await stripe.accounts.create({
        controller: {
          fees: { payer: 'account' },
          losses: { payments: 'stripe' },
          stripe_dashboard: { type: 'full' },
          requirement_collection: 'stripe',
        },
        capabilities: { card_payments: { requested: true } },
        metadata: { organizationId: ctx.organizationId },
      })
      stripeAccountId = account.id
      // Persist the acct id immediately — the hosted flow can be abandoned/refreshed and the
      // next `start` must find and reuse this account instead of creating another.
      await upsertPaymentAccount({
        organizationId: ctx.organizationId,
        provider: 'stripe',
        stripeAccountId,
      })
    }

    const link = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: ctx.refreshUrl,
      return_url: ctx.returnUrl,
      type: 'account_onboarding',
    })

    return { redirectUrl: link.url }
  },

  async complete(ctx: HostedProvisionCompleteCtx): Promise<HostedProvisionCompleteResult> {
    const account = await getPaymentAccount(ctx.organizationId)
    if (!account?.stripeAccountId) {
      throw new NotFoundError('No Stripe account is being onboarded for this organization')
    }

    const stripe = getStripeConnectClient()
    const acct = await stripe.accounts.retrieve(account.stripeAccountId)

    await upsertPaymentAccount({
      organizationId: ctx.organizationId,
      provider: 'stripe',
      stripeAccountId: account.stripeAccountId,
      chargesEnabled: acct.charges_enabled ?? false,
      detailsSubmitted: acct.details_submitted ?? false,
      defaultCurrency: acct.default_currency ?? null,
      // A reconnect after disconnect re-arms the account.
      disconnectedAt: null,
    })

    return {
      providerAccountId: account.stripeAccountId,
      connectionVariables: { stripeAccountId: account.stripeAccountId },
      label: acct.business_profile?.name || 'Stripe',
      ready: acct.charges_enabled ?? false,
    }
  },

  async onPersisted(ctx: HostedProvisionCompleteCtx & { credentialId: string }): Promise<void> {
    await upsertPaymentAccount({
      organizationId: ctx.organizationId,
      provider: 'stripe',
      credentialId: ctx.credentialId,
      disconnectedAt: null,
    })
  },
}
