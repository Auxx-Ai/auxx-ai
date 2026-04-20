// packages/seed/scripts/seed.ts
// CLI entrypoint for executing database seeding scenarios

import { Command } from 'commander'
import { config as loadEnv } from 'dotenv'
import { DrizzleSeeder } from '../src/engine/drizzle-seeder'
import type { ScenarioScales, SeedingScenarioName } from '../src/types'

loadEnv()

/** parseIntegerOption safely parses integer CLI values. */
function parseIntegerOption(value?: string): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? undefined : parsed
}

/**
 * runCli configures commander, parses arguments, and executes the seeder.
 * @returns Promise that resolves when the seeding run completes.
 */
async function runCli(): Promise<void> {
  const program = new Command()

  program
    .name('pnpm seed')
    .description('Auxx.ai database seeding CLI')
    .option('-s, --scenario <scenario>', 'Scenario to execute', 'development')
    .option('-r, --reset', 'Reset the database before seeding', false)
    .option('--no-validate', 'Skip validation checks after seeding')
    .option('--no-progress', 'Disable CLI progress spinners')
    .option('--seed-value <value>', 'Deterministic seed value')
    .option('--organizations <count>', 'Override organization count')
    .option('--users <count>', 'Override user count')
    .option('--customers <count>', 'Override customer count')
    .option('--companies <count>', 'Override company count')
    .option('--products <count>', 'Override product count')
    .option('--orders <count>', 'Override order count')
    .option('--threads <count>', 'Override thread count')
    .option('--messages <count>', 'Override message count')
    .option(
      '--billing-plans-only',
      'Only seed billing plans with Stripe resources (skip other domains)',
      false
    )

  program.action(async (options) => {
    const scenario = options.scenario as SeedingScenarioName
    const overrides: Partial<ScenarioScales> = {}

    const orgOverride = parseIntegerOption(options.organizations)
    if (orgOverride !== undefined) overrides.organizations = orgOverride

    const userOverride = parseIntegerOption(options.users)
    if (userOverride !== undefined) overrides.users = userOverride

    const customerOverride = parseIntegerOption(options.customers)
    if (customerOverride !== undefined) overrides.customers = customerOverride

    const companyOverride = parseIntegerOption(options.companies)
    if (companyOverride !== undefined) overrides.companies = companyOverride

    const productOverride = parseIntegerOption(options.products)
    if (productOverride !== undefined) overrides.products = productOverride

    const orderOverride = parseIntegerOption(options.orders)
    if (orderOverride !== undefined) overrides.orders = orderOverride

    const threadOverride = parseIntegerOption(options.threads)
    if (threadOverride !== undefined) overrides.threads = threadOverride

    const messageOverride = parseIntegerOption(options.messages)
    if (messageOverride !== undefined) overrides.messages = messageOverride

    const seeder = new DrizzleSeeder({
      scenario,
      reset: Boolean(options.reset),
      validate: options.validate ?? true,
      progress: options.progress ?? true,
      seedValue: options.seedValue,
      overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
      billingPlansOnly: Boolean(options.billingPlansOnly),
    })

    const result = await seeder.execute()

    console.log('\n🌱 Seeding complete!')
    console.log(`Scenario: ${result.metrics.scenario}`)
    console.log(`Duration: ${result.metrics.duration}ms`)
    console.log(`Entities (approx): ${result.metrics.entitiesCreated}`)
    console.log('Available test accounts:')
    const auth = result.domains.auth as {
      credentials?: { accounts: Array<{ email: string; password: string }> }
    }
    auth?.credentials?.accounts.forEach((account) => {
      console.log(` - ${account.email} / ${account.password}`)
    })
  })

  await program.parseAsync(process.argv)
}

runCli().catch((error) => {
  console.error('❌ Seeding failed:', error)
  process.exitCode = 1
})
