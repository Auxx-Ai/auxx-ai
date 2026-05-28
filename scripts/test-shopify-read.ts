// scripts/test-shopify-read.ts — Admin API subscription read for an org
import { getActiveSubscription, mapActiveSubscriptionToStatus } from '@auxx/billing'

const shopDomain = process.argv[2] ?? 'auxxai.myshopify.com'
const organizationId = process.argv[3] ?? 'jakjbc20mnd5dul8wzgnhepa'
async function main() {
  console.log({ shopDomain, organizationId })
  const sub = await getActiveSubscription({ shopDomain, organizationId })
  console.log('\n--- ActiveSubscription ---')
  console.log(JSON.stringify(sub, null, 2))
  console.log('\n--- mapped status ---', mapActiveSubscriptionToStatus(sub))
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\nthrew:', e.message)
    process.exit(1)
  })
