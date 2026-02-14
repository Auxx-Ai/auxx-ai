// packages/seed/src/engine/auth-seeder.ts
// Seeder responsible for provisioning authentication records with scrypt parity

import { database, schema } from '@auxx/database'
import { createId } from '@paralleldrive/cuid2'
import type { AuthSeederResult, SeedingConfig, SeedingScenarioName } from '../types'
import { hashPassword } from '../utils/auth-hash'

/** SeedUserDefinition captures the minimal information needed to provision a test user. */
export interface SeedUserDefinition {
  /** email holds the primary login identifier. */
  email: string
  /** name stores the display name for the user. */
  name: string
  /** password is the plain-text password before hashing. */
  password: string
  /** image optionally points to an avatar URL for marketing scenarios. */
  image?: string
  /** role classifies curated users for downstream features. */
  role?: 'admin' | 'agent' | 'customer'
}

/** AuthSeeder provisions curated and random authentication records using scrypt hashing. */
export class AuthSeeder {
  /** TEST_PASSWORD is the shared password for generated credentials. */
  private readonly TEST_PASSWORD = 'Test123456!'
  /** config stores runtime seeding configuration. */
  private readonly config: SeedingConfig

  /**
   * Creates a new AuthSeeder instance.
   * @param config - The CLI/runtime configuration.
   */
  constructor(config: SeedingConfig) {
    this.config = config
  }

  /**
   * execute orchestrates curated and random user creation.
   * @returns Summary of seeded authentication data.
   */
  async execute(): Promise<AuthSeederResult> {
    const curated = await this.ensureUsers([
      {
        email: 'markus@auxx.ai',
        name: 'Markus Klooth',
        password: this.TEST_PASSWORD,
        role: 'admin',
      },
      {
        email: 'support@test.com',
        name: 'Support Agent',
        password: this.TEST_PASSWORD,
        role: 'agent',
      },
      {
        email: 'manager@test.com',
        name: 'Support Manager',
        password: this.TEST_PASSWORD,
        role: 'agent',
      },
      {
        email: 'customer@test.com',
        name: 'Test Customer',
        password: this.TEST_PASSWORD,
        role: 'customer',
      },
    ])

    const additional = await this.ensureRandomUsers(this.config.scenario)

    return {
      testUsers: curated,
      randomUsers: additional,
      credentials: this.generateCredentialsReport(curated),
    }
  }

  /**
   * ensureUsers upserts curated accounts and creates matching `account` rows.
   * @param definitions - Curated user definitions to seed.
   * @returns Created or updated user identifiers.
   */
  private async ensureUsers(
    definitions: SeedUserDefinition[]
  ): Promise<Array<{ id: string; email: string; role?: string }>> {
    const created: Array<{ id: string; email: string; role?: string }> = []

    for (const definition of definitions) {
      const hashed = await hashPassword(definition.password)
      const now = new Date()

      const [user] = await database
        .insert(schema.User)
        .values({
          id: createId(),
          email: definition.email,
          name: definition.name,
          hashedPassword: hashed.value,
          emailVerified: true,
          completedOnboarding: definition.role !== 'customer',
          updatedAt: now,
          image: definition.image,
        })
        .onConflictDoUpdate({
          target: schema.User.email,
          set: {
            name: definition.name,
            hashedPassword: hashed.value,
            updatedAt: now,
          },
        })
        .returning({ id: schema.User.id, email: schema.User.email })

      if (!user) continue

      await this.ensurePrimaryAccount(user.id, hashed.value, now)
      created.push({ ...user, role: definition.role })
    }

    return created
  }

  /**
   * ensurePrimaryAccount creates or updates the email account record for a user.
   * @param userId - Target user identifier.
   * @param password - Stored password hash in salt:keyHex format.
   * @param updatedAt - Timestamp to reuse for deterministic updates.
   */
  private async ensurePrimaryAccount(
    userId: string,
    password: string,
    updatedAt: Date
  ): Promise<void> {
    await database
      .insert(schema.account)
      .values({
        id: createId(),
        userId,
        providerId: 'credential',
        accountId: userId,
        password,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: [schema.account.providerId, schema.account.accountId],
        set: { password, updatedAt },
      })
  }

  /**
   * ensureRandomUsers provisions additional deterministic random accounts per scenario.
   * @param scenario - Scenario identifier influencing counts.
   * @returns Array of newly created users.
   */
  private async ensureRandomUsers(
    scenario: SeedingScenarioName
  ): Promise<Array<{ id: string; email: string }>> {
    const count = this.resolveRandomUserCount(scenario)
    const created: Array<{ id: string; email: string }> = []

    for (let i = 0; i < count; i++) {
      const email = `${this.config.seedValue ?? 'seed'}-${i}@example.dev`
      const name = this.generateRandomName()
      const hashed = await hashPassword(this.TEST_PASSWORD)
      const now = new Date()

      const [user] = await database
        .insert(schema.User)
        .values({
          id: createId(),
          email,
          name,
          hashedPassword: hashed.value,
          emailVerified: true,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: schema.User.id, email: schema.User.email })

      if (user) {
        await this.ensurePrimaryAccount(user.id, hashed.value, now)
        created.push(user)
      }
    }

    return created
  }

  /**
   * resolveRandomUserCount determines how many random users to create for a scenario.
   * @param scenario - Scenario identifier.
   * @returns Number of random users to create.
   */
  private resolveRandomUserCount(scenario: SeedingScenarioName): number {
    switch (scenario) {
      case 'testing':
        return 5
      case 'screenshot':
      case 'demo':
        return 20
      case 'performance':
        return 200
      case 'development':
      default:
        return 50
    }
  }

  /**
   * generateRandomName fabricates a friendly display name for random accounts.
   * @returns Generated display name.
   */
  private generateRandomName(): string {
    const firstNames = [
      'Alex',
      'Jordan',
      'Taylor',
      'Morgan',
      'Casey',
      'Riley',
      'Avery',
      'Quinn',
      'Sage',
      'River',
    ]
    const lastNames = [
      'Smith',
      'Johnson',
      'Williams',
      'Brown',
      'Jones',
      'Garcia',
      'Miller',
      'Davis',
      'Rodriguez',
      'Martinez',
    ]
    const first = firstNames[Math.floor(Math.random() * firstNames.length)]
    const last = lastNames[Math.floor(Math.random() * lastNames.length)]
    return `${first} ${last}`
  }

  /**
   * generateCredentialsReport builds a reusable summary for CLI output.
   * @param users - Curated users to include in the report.
   * @returns Report containing login instructions.
   */
  private generateCredentialsReport(users: Array<{ email: string }>): {
    message: string
    password: string
    accounts: Array<{ email: string; password: string }>
  } {
    return {
      message: '🔑 Test user credentials for login:',
      password: this.TEST_PASSWORD,
      accounts: users.map((user) => ({
        email: user.email,
        password: this.TEST_PASSWORD,
      })),
    }
  }
}
