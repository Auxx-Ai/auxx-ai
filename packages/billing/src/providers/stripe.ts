// packages/billing/src/providers/stripe.ts

import type { Database } from '@auxx/database'
import { BillingPortalService } from '../services/billing-portal-service'
import { stripeClient } from '../services/stripe-client'
import { SubscriptionService } from '../services/subscription-service'
import { WebhookService } from '../services/webhook-service'
import type {
  BillingCapabilities,
  BillingPortalInput,
  BillingProvider,
  CancelSubscriptionInput,
  CreateSubscriptionInput,
  CreateSubscriptionResult,
  PaymentMethod,
  PreviewInput,
  PreviewResult,
  ProcessWebhookInput,
  RestoreSubscriptionInput,
  UpdateSubscriptionDirectInput,
  UpdateSubscriptionDirectResult,
} from './types'

export class StripeBillingProvider implements BillingProvider {
  readonly id = 'stripe' as const
  readonly capabilities: BillingCapabilities = {
    managedPaymentMethods: true,
    selfServeBillingPortal: true,
    prorationPreview: true,
    arbitraryBillingCycles: true,
    annualBillingCycle: true,
    customPricingPlans: true,
    trialWithoutPaymentMethod: true,
    immediateCancellation: true,
    scheduledDowngrade: true,
    invoiceLedger: true,
  }

  constructor(
    private readonly db: Database,
    private readonly webappUrl: string
  ) {}

  async createSubscription(input: CreateSubscriptionInput): Promise<CreateSubscriptionResult> {
    const svc = new SubscriptionService(this.db, this.webappUrl)
    const { url } = await svc.createCheckoutSession(
      {
        organizationId: input.organizationId,
        planName: input.planName,
        billingCycle: input.billingCycle,
        seats: input.seats,
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
        metadata: input.metadata,
      },
      input.userEmail
    )
    return { kind: 'redirect', url }
  }

  async cancelSubscription(input: CancelSubscriptionInput): Promise<void> {
    const svc = new SubscriptionService(this.db, this.webappUrl)
    await svc.cancelSubscription({ organizationId: input.organizationId, returnUrl: '' })
  }

  async restoreSubscription(input: RestoreSubscriptionInput): Promise<void> {
    const svc = new SubscriptionService(this.db, this.webappUrl)
    await svc.restoreSubscription({ organizationId: input.organizationId })
  }

  async updateSubscriptionDirect(
    input: UpdateSubscriptionDirectInput
  ): Promise<UpdateSubscriptionDirectResult> {
    const svc = new SubscriptionService(this.db, this.webappUrl)
    return svc.updateSubscriptionDirect(input)
  }

  async createBillingPortalUrl(input: BillingPortalInput): Promise<{ url: string }> {
    const svc = new BillingPortalService(this.db, this.webappUrl)
    const { url } = await svc.createSession(input)
    return { url }
  }

  async calculatePreview(input: PreviewInput): Promise<PreviewResult> {
    const svc = new SubscriptionService(this.db, this.webappUrl)
    return svc.calculateSubscriptionPreview(input)
  }

  async listPaymentMethods(organizationId: string): Promise<PaymentMethod[]> {
    const subscription = await this.db.query.PlanSubscription.findFirst({
      where: (sub, { eq }) => eq(sub.organizationId, organizationId),
      columns: { stripeCustomerId: true },
    })
    if (!subscription?.stripeCustomerId) return []

    const stripe = stripeClient.getClient()
    const paymentMethods = await stripe.paymentMethods.list({
      customer: subscription.stripeCustomerId,
      type: 'card',
    })
    const customer = await stripe.customers.retrieve(subscription.stripeCustomerId)
    const defaultPaymentMethodId =
      typeof customer !== 'string' && !customer.deleted
        ? customer.invoice_settings.default_payment_method
        : null

    return paymentMethods.data.map((pm) => ({
      id: pm.id,
      brand: pm.card?.brand || 'unknown',
      last4: pm.card?.last4 || '****',
      expMonth: pm.card?.exp_month || 0,
      expYear: pm.card?.exp_year || 0,
      isDefault: pm.id === defaultPaymentMethodId,
    }))
  }

  async createSetupIntent(organizationId: string): Promise<{ clientSecret: string }> {
    const subscription = await this.db.query.PlanSubscription.findFirst({
      where: (sub, { eq }) => eq(sub.organizationId, organizationId),
      columns: { stripeCustomerId: true },
    })
    if (!subscription?.stripeCustomerId) {
      throw new Error('No Stripe customer found')
    }

    const setupIntent = await stripeClient.getClient().setupIntents.create({
      customer: subscription.stripeCustomerId,
      payment_method_types: ['card'],
    })
    return { clientSecret: setupIntent.client_secret! }
  }

  async setDefaultPaymentMethod(organizationId: string, paymentMethodId: string): Promise<void> {
    const subscription = await this.db.query.PlanSubscription.findFirst({
      where: (sub, { eq }) => eq(sub.organizationId, organizationId),
      columns: { stripeCustomerId: true },
    })
    if (!subscription?.stripeCustomerId) {
      throw new Error('No Stripe customer found')
    }
    await stripeClient.getClient().customers.update(subscription.stripeCustomerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    })
  }

  async deletePaymentMethod(_organizationId: string, paymentMethodId: string): Promise<void> {
    await stripeClient.getClient().paymentMethods.detach(paymentMethodId)
  }

  async processWebhook(input: ProcessWebhookInput): Promise<{ success: boolean }> {
    if (!input.event) {
      throw new Error('Stripe webhook requires a pre-verified event')
    }
    const svc = new WebhookService(input.db, input.handlers, input.onPlanChange)
    return svc.processVerifiedEvent(input.event)
  }
}
