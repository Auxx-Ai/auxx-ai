# @auxx/billing

Standalone billing package for managing Stripe subscriptions in Auxx.ai.

## Overview

This package provides a clean, organization-centric billing system with:

- **Subscription management**: Create, upgrade, cancel, and restore subscriptions
- **Stripe integration**: Direct Stripe API integration without third-party plugins
- **Webhook handling**: Automatic sync of invoices and subscription status
- **Billing portal**: First-class Stripe portal integration
- **Type-safe**: Full TypeScript with Drizzle ORM integration

## Architecture

```
packages/billing/
├── src/
│   ├── types/           # Core types (plan, subscription, webhook)
│   ├── services/        # Business logic services
│   │   ├── stripe-client.ts
│   │   ├── customer-service.ts
│   │   ├── plan-service.ts
│   │   ├── subscription-service.ts
│   │   ├── billing-portal-service.ts
│   │   └── webhook-service.ts
│   ├── hooks/           # Webhook event handlers
│   │   ├── checkout-session.ts
│   │   ├── subscription-updated.ts
│   │   ├── subscription-deleted.ts
│   │   ├── invoice-paid.ts
│   │   └── invoice-payment-failed.ts
│   └── utils/           # Utilities (errors, URL helpers)
└── README.md
```

## Usage

### 1. Stripe Client Initialization

```typescript
import { stripeClient } from '@auxx/billing'

const stripe = stripeClient.getClient() // Lazy-initializes on first use
```

### 2. Use Services in tRPC Router

```typescript
import { SubscriptionService, BillingPortalService } from '@auxx/billing'

const subscriptionService = new SubscriptionService(
  ctx.db,
  process.env.APP_URL!
)

// Create checkout session
const { url } = await subscriptionService.createCheckoutSession(
  {
    organizationId,
    planName: 'pro',
    billingCycle: 'MONTHLY',
    successUrl: '/settings/billing',
    cancelUrl: '/pricing',
  },
  userEmail
)
```

### 3. Setup Webhook Handler

```typescript
// apps/web/src/app/api/billing/webhook/route.ts
import { WebhookService } from '@auxx/billing'
import { db } from '@auxx/database'

const webhookService = new WebhookService(
  db,
  process.env.STRIPE_WEBHOOK_SECRET!
)

await webhookService.processWebhook(body, signature)
```

## Services

### SubscriptionService

Handles subscription lifecycle:
- `createCheckoutSession()` - Create/upgrade subscription
- `cancelSubscription()` - Schedule cancellation
- `restoreSubscription()` - Restore scheduled cancellation
- `listActiveSubscriptions()` - Get active subscriptions

### BillingPortalService

Manages Stripe portal sessions:
- `createSession()` - Create billing portal session

### PlanService

Plan lookup and management:
- `getPlans()` - Get all active plans
- `findPlan()` - Find plan by name/priceId/lookupKey

### CustomerService

Customer management:
- `getOrCreateCustomer()` - Get or create Stripe customer

### WebhookService

Process Stripe webhooks:
- Automatically handles checkout, subscription, and invoice events
- Syncs data to local database
- Supports custom event handlers

## Environment Variables

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
APP_URL=https://app.your-domain.com
```

## Database Schema

The package expects these tables (already defined in `@auxx/database`):

- `Plan` - Plan definitions with Stripe price IDs
- `PlanSubscription` - Organization subscriptions
- `Invoice` - Synced invoice records

## Error Handling

```typescript
import { BillingError, ErrorCode } from '@auxx/billing'

try {
  await subscriptionService.createCheckoutSession(...)
} catch (error) {
  if (error instanceof BillingError) {
    switch (error.code) {
      case ErrorCode.PLAN_NOT_FOUND:
        // Handle plan not found
        break
      case ErrorCode.ALREADY_SUBSCRIBED:
        // Handle already subscribed
        break
    }
  }
}
```

## Key Features

- ✅ Organization-centric (not user-based)
- ✅ Trial eligibility tracking
- ✅ Automatic invoice syncing via webhooks
- ✅ Stripe billing portal integration
- ✅ Full TypeScript type safety
- ✅ Clean separation of concerns
- ✅ Comprehensive error handling

## Migration from @better-auth/stripe

This package replaces `@better-auth/stripe` with:

1. **Direct Stripe integration** - No plugin layer
2. **Organization-first** - Subscriptions tied to orgs, not users
3. **Database-driven** - Plan config in DB, not code
4. **Simplified** - Removed unnecessary abstractions
5. **Type-safe** - Full Drizzle ORM integration

## Testing

Webhook testing with Stripe CLI:

```bash
stripe listen --forward-to localhost:3000/api/billing/webhook
stripe trigger checkout.session.completed
stripe trigger customer.subscription.updated
```

## License

Proprietary - Auxx.ai
