// packages/seed/src/domains/organization.domain.ts
// Organization domain refinements for drizzle-seed with comprehensive seeding

import { createId } from '@paralleldrive/cuid2'
import { sql } from 'drizzle-orm'
import { ContentEngine } from '../generators/content-engine'
import type { SeedingContext, SeedingScenario } from '../types'
import { BusinessDistributions } from '../utils/business-distributions'
import { RelationshipEngine } from '../utils/relationship-engine'

/** OrganizationDomain captures refinements for organization-adjacent entities. */
export class OrganizationDomain {
  /** scenario stores the resolved scenario definition. */
  private readonly scenario: SeedingScenario
  /** distributions provides realistic business data patterns. */
  private readonly distributions: BusinessDistributions
  /** relationships builds entity connections. */
  private readonly relationships: RelationshipEngine
  /** content generates realistic business content. */
  private readonly content: ContentEngine
  /** context stores the seeding context with foreign key references. */
  private readonly context: SeedingContext
  /** organizationId targets seeding to a specific organization. */
  private readonly organizationId?: string
  /** organizations caches filtered organization references. */
  private readonly organizations: Array<{ id: string; ownerId: string }>

  /**
   * Creates a new OrganizationDomain instance.
   * @param scenario - Scenario definition controlling scaling.
   * @param context - Cross-domain seeding context with foreign key references.
   * @param options - Optional configuration for organization-scoped seeding.
   */
  constructor(
    scenario: SeedingScenario,
    context: SeedingContext,
    options?: { organizationId?: string }
  ) {
    this.scenario = scenario
    this.distributions = new BusinessDistributions(scenario.dataQuality)
    this.relationships = new RelationshipEngine(scenario)
    this.content = new ContentEngine(scenario.dataQuality)
    this.context = context
    this.organizationId = options?.organizationId

    // Filter organizations by organizationId if specified
    this.organizations = this.organizationId
      ? context.services.organizations.filter((o) => o.id === this.organizationId)
      : context.services.organizations

    if (this.organizations.length === 0) {
      throw new Error(
        `OrganizationDomain requires at least one organization${
          this.organizationId ? ` for organization ${this.organizationId}` : ''
        } in the seeding context`
      )
    }
  }

  /**
   * insertDirectly performs direct database inserts bypassing drizzle-seed.
   * @param db - Drizzle database instance
   */
  async insertDirectly(db: any): Promise<void> {
    const { schema } = await import('@auxx/database')
    const { UnifiedCrudHandler } = await import('@auxx/lib/resources')
    const users = [...this.context.auth.testUsers, ...this.context.auth.randomUsers]

    if (users.length === 0) {
      throw new Error('OrganizationDomain requires at least one user in the seeding context')
    }

    // Seed for each target organization
    for (const org of this.organizations) {
      // Generate and insert Signatures via UnifiedCrudHandler
      await this.seedSignatures(db, org.id, org.ownerId, users, UnifiedCrudHandler)

      // Generate and insert Snippet Folders first, then Snippets (so snippets can reference folders)
      const folderIds = await this.seedSnippetFolders(db, schema, org.id, users)
      await this.seedSnippets(db, schema, org.id, users, folderIds)
    }
  }

  /**
   * seedSignatures generates and creates signature records via UnifiedCrudHandler.
   * @param db - Drizzle database instance
   * @param organizationId - Organization ID to associate signatures with
   * @param ownerId - Organization owner user ID
   * @param users - Array of user records
   * @param UnifiedCrudHandler - The handler class
   */
  private async seedSignatures(
    db: any,
    organizationId: string,
    ownerId: string,
    users: Array<{ id: string; email: string }>,
    UnifiedCrudHandler: any
  ): Promise<void> {
    console.log('✍️  Generating signatures via UnifiedCrudHandler...')

    const handler = new UnifiedCrudHandler(organizationId, ownerId, db)

    // Skip if signatures already exist (additive mode)
    const existing = await handler.list('signature', { limit: 1 })
    if (existing.items.length > 0) {
      console.log('⏭️  Signatures already exist, skipping')
      return
    }

    const signaturesPerUser = 2
    let created = 0

    // Create 2 signatures for each of the first 3 users
    for (let userIndex = 0; userIndex < Math.min(3, users.length); userIndex++) {
      const user = users[userIndex]!

      for (let sigIndex = 0; sigIndex < signaturesPerUser; sigIndex++) {
        const isDefault = sigIndex === 0
        const name = isDefault ? 'Default Signature' : `Signature ${sigIndex + 1}`

        try {
          await handler.create(
            'signature',
            {
              name: name,
              body: this.generateSignatureContent(user.email, isDefault),
              is_default: isDefault,
              visibility: 'private',
            },
            { skipEvents: true }
          )
          created++
        } catch (error: any) {
          console.log(`⚠️  Failed to create signature: ${error.message}`)
        }
      }
    }

    console.log(`✅ Created ${created} signatures via UnifiedCrudHandler`)
  }

  /**
   * seedSnippets generates and inserts snippet records.
   * @param db - Drizzle database instance
   * @param schema - Database schema
   * @param organizationId - Organization ID to associate snippets with
   * @param users - Array of user records
   */
  private async seedSnippets(
    db: any,
    schema: any,
    organizationId: string,
    users: Array<{ id: string }>,
    folderIds: { general: string; sales: string; support: string }
  ): Promise<void> {
    console.log('📝 Generating snippets...')

    const snippetTemplates = [
      {
        title: 'Greeting',
        content: 'Hello! Thank you for reaching out to us. How can I help you today?',
        folder: 'general' as const,
      },
      {
        title: 'Thank You',
        content: 'Thank you for contacting us. We appreciate your business!',
        folder: 'general' as const,
      },
      {
        title: 'Closing',
        content:
          "If you have any other questions, please don't hesitate to reach out. Have a great day!",
        folder: 'general' as const,
      },
      {
        title: 'Order Status',
        content:
          'Let me check on your order status for you. Could you please provide your order number?',
        folder: 'sales' as const,
      },
      {
        title: 'Refund Process',
        content:
          "I understand you'd like to process a refund. Let me help you with that right away.",
        folder: 'support' as const,
      },
      {
        title: 'Shipping Info',
        content: 'Your order has been shipped and should arrive within 3-5 business days.',
        folder: 'sales' as const,
      },
      {
        title: 'Apology',
        content:
          'We sincerely apologize for any inconvenience this may have caused. Let me make this right.',
        folder: 'support' as const,
      },
      {
        title: 'Escalation',
        content: "I'm going to escalate this to our management team for immediate attention.",
        folder: 'support' as const,
      },
      {
        title: 'Follow Up',
        content: 'Just following up on our previous conversation. Have you had a chance to review?',
        folder: 'sales' as const,
      },
      {
        title: 'Welcome',
        content: "Welcome to our community! We're excited to have you here.",
        folder: 'general' as const,
      },
    ]

    const snippets = []

    for (let i = 0; i < snippetTemplates.length; i++) {
      const template = snippetTemplates[i]!

      snippets.push({
        id: createId(),
        title: template.title,
        content: template.content,
        organizationId: organizationId,
        folderId: folderIds[template.folder],
        createdById: users[i % users.length]!.id,
        createdAt: new Date(Date.now() - (snippetTemplates.length - i) * 3600000),
        updatedAt: new Date(),
      })
    }

    if (snippets.length > 0) {
      await db
        .insert(schema.Snippet)
        .values(snippets)
        .onConflictDoUpdate({
          target: schema.Snippet.id,
          set: {
            title: sql`excluded.title`,
            content: sql`excluded.content`,
            folderId: sql`excluded."folderId"`,
            updatedAt: sql`excluded."updatedAt"`,
          },
        })

      console.log(`✅ Upserted ${snippets.length} snippets`)
    }
  }

  /**
   * seedSnippetFolders generates and inserts snippet folder records.
   * @param db - Drizzle database instance
   * @param schema - Database schema
   * @param organizationId - Organization ID to associate snippet folders with
   * @param users - Array of user records
   */
  private async seedSnippetFolders(
    db: any,
    schema: any,
    organizationId: string,
    users: Array<{ id: string }>
  ): Promise<{ general: string; sales: string; support: string }> {
    console.log('📁 Generating snippet folders...')

    const folderMap = {
      general: createId(),
      sales: createId(),
      support: createId(),
    }

    const folderEntries: Array<{ key: keyof typeof folderMap; name: string }> = [
      { key: 'general', name: 'General' },
      { key: 'sales', name: 'Sales' },
      { key: 'support', name: 'Support' },
    ]

    const folders = folderEntries.map((entry, i) => ({
      id: folderMap[entry.key],
      name: entry.name,
      organizationId: organizationId,
      createdById: users[0]!.id,
      createdAt: new Date(Date.now() - (folderEntries.length - i) * 3600000),
      updatedAt: new Date(),
    }))

    if (folders.length > 0) {
      await db
        .insert(schema.SnippetFolder)
        .values(folders)
        .onConflictDoUpdate({
          target: schema.SnippetFolder.id,
          set: {
            name: sql`excluded.name`,
            updatedAt: sql`excluded."updatedAt"`,
          },
        })

      console.log(`✅ Upserted ${folders.length} snippet folders`)
    }

    return folderMap
  }

  // ---- Generator Methods ----

  /** generateSignatureContent creates realistic email signatures. */
  private generateSignatureContent(email: string, isDefault: boolean): string {
    if (isDefault) {
      return `Best regards,\n\n--\nSupport Team\n${email}`
    }
    return `Thanks for reaching out!\n\n--\n${email}`
  }

  /** buildRefinements returns drizzle-seed refinements for organization entities. */
  buildRefinements(): (helpers: unknown) => Record<string, unknown> {
    return () => {
      console.log('🏢 Organization domain refinements skipped (handled by ServiceIntegrator)')
      return {}
    }
  }

  /** generateOrganizationIds creates unique organization identifiers. */
  private generateOrganizationIds(): string[] {
    const ids: string[] = []
    for (let i = 0; i < this.scenario.scales.organizations; i++) {
      ids.push(createId())
    }
    return ids
  }

  /** generateOrganizationNames creates realistic organization names. */
  private generateOrganizationNames(): string[] {
    const businessTypes = [
      'Solutions',
      'Technologies',
      'Innovations',
      'Systems',
      'Digital',
      'Commerce',
      'Enterprises',
      'Group',
      'Partners',
      'Consulting',
    ]
    const adjectives = [
      'Global',
      'Premium',
      'Advanced',
      'Smart',
      'Elite',
      'Prime',
      'Dynamic',
      'Strategic',
      'Innovative',
      'Modern',
    ]
    const bases = [
      'Auxx',
      'TechFlow',
      'DataSync',
      'CloudPro',
      'MarketEdge',
      'SalesHub',
      'BusinessCore',
      'ServiceLink',
      'CustomerFirst',
    ]

    const names: string[] = []
    for (let i = 0; i < this.scenario.scales.organizations; i++) {
      const base = bases[i % bases.length]
      const type = businessTypes[i % businessTypes.length]
      const adj = i % 3 === 0 ? adjectives[i % adjectives.length] + ' ' : ''
      names.push(`${adj}${base} ${type}`)
    }
    return names
  }

  /** generateWebsites creates realistic website URLs. */
  private generateWebsites(): string[] {
    const websites: string[] = []
    const businessTypes = [
      'Solutions',
      'Technologies',
      'Innovations',
      'Systems',
      'Digital',
      'Commerce',
      'Enterprises',
      'Group',
      'Partners',
      'Consulting',
    ]
    const bases = [
      'Auxx',
      'TechFlow',
      'DataSync',
      'CloudPro',
      'MarketEdge',
      'SalesHub',
      'BusinessCore',
      'ServiceLink',
      'CustomerFirst',
    ]

    for (let i = 0; i < this.scenario.scales.organizations; i++) {
      const base = bases[i % bases.length]
      const type = businessTypes[i % businessTypes.length]
      const name = `${base}${type}`
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .substring(0, 15)
      websites.push(`https://www.${name}.com`)
    }
    return websites
  }

  /** generateAboutDescriptions creates realistic organization descriptions. */
  private generateAboutDescriptions(): string[] {
    const descriptions = [
      'We provide innovative solutions to help businesses grow and thrive in the digital economy.',
      'A leading provider of customer support automation and AI-powered business tools.',
      'Empowering teams with cutting-edge technology to deliver exceptional customer experiences.',
      'Transforming how businesses interact with customers through intelligent automation.',
      'Dedicated to helping companies streamline operations and boost customer satisfaction.',
      'Building the future of customer service with AI and machine learning technologies.',
      'Your trusted partner for digital transformation and customer experience optimization.',
      'Innovative solutions for modern businesses seeking to enhance their customer operations.',
    ]

    const result: string[] = []
    for (let i = 0; i < this.scenario.scales.organizations; i++) {
      result.push(descriptions[i % descriptions.length]!)
    }
    return result
  }

  /** generateEmailDomains creates realistic email domains. */
  private generateEmailDomains(): string[] {
    const domains: string[] = []
    const bases = [
      'Auxx',
      'TechFlow',
      'DataSync',
      'CloudPro',
      'MarketEdge',
      'SalesHub',
      'BusinessCore',
      'ServiceLink',
      'CustomerFirst',
    ]

    for (let i = 0; i < this.scenario.scales.organizations; i++) {
      const base = bases[i % bases.length]!.toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .substring(0, 15)
      domains.push(`${base}.com`)
    }
    return domains
  }

  /** generateOrganizationTypes creates realistic organization type distribution. */
  private generateOrganizationTypes(): ('INDIVIDUAL' | 'TEAM')[] {
    const types: ('INDIVIDUAL' | 'TEAM')[] = []

    for (let i = 0; i < this.scenario.scales.organizations; i++) {
      // 80% teams, 20% individual
      types.push(i % 5 === 0 ? 'INDIVIDUAL' : 'TEAM')
    }
    return types
  }

  /** generateHandles creates unique organization handles. */
  private generateHandles(): string[] {
    const handles: string[] = []
    const bases = [
      'Auxx',
      'TechFlow',
      'DataSync',
      'CloudPro',
      'MarketEdge',
      'SalesHub',
      'BusinessCore',
      'ServiceLink',
      'CustomerFirst',
    ]

    for (let i = 0; i < this.scenario.scales.organizations; i++) {
      const base = bases[i % bases.length]!.toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .substring(0, 12)
      handles.push(`${base}-${i + 1}`)
    }
    return handles
  }

  /** calculateMembershipCount determines total organization memberships needed. */
  private calculateMembershipCount(): number {
    // Average 10 members per organization, with variation
    return this.scenario.scales.organizations * 10
  }

  /** generateMembershipIds creates unique membership identifiers. */
  private generateMembershipIds(): string[] {
    const ids: string[] = []
    const count = this.calculateMembershipCount()

    for (let i = 0; i < count; i++) {
      ids.push(createId())
    }
    return ids
  }

  /** generateMemberRoles creates realistic role distribution. */
  private generateMemberRoles(): ('OWNER' | 'ADMIN' | 'USER')[] {
    const roles: ('OWNER' | 'ADMIN' | 'USER')[] = []
    const count = this.calculateMembershipCount()

    for (let i = 0; i < count; i++) {
      // 10% owners, 20% admins, 70% users
      if (i % 10 === 0) roles.push('OWNER')
      else if (i % 5 === 0) roles.push('ADMIN')
      else roles.push('USER')
    }
    return roles
  }

  /** generateMemberStatuses creates realistic status distribution. */
  private generateMemberStatuses(): ('ACTIVE' | 'INACTIVE')[] {
    const statuses: ('ACTIVE' | 'INACTIVE')[] = []
    const count = this.calculateMembershipCount()

    for (let i = 0; i < count; i++) {
      // 90% active, 10% inactive
      statuses.push(i % 10 === 9 ? 'INACTIVE' : 'ACTIVE')
    }
    return statuses
  }

  /** calculateSettingsCount determines total organization settings needed. */
  private calculateSettingsCount(): number {
    // Average 15 settings per organization
    return this.scenario.scales.organizations * 15
  }

  /** generateSettingIds creates unique setting identifiers. */
  private generateSettingIds(): string[] {
    const ids: string[] = []
    const count = this.calculateSettingsCount()

    for (let i = 0; i < count; i++) {
      ids.push(createId())
    }
    return ids
  }

  /** generateSettingKeys creates realistic configuration keys. */
  private generateSettingKeys(): string[] {
    const settingKeys = [
      'email_notifications',
      'auto_reply_enabled',
      'response_time_sla',
      'escalation_rules',
      'working_hours',
      'timezone',
      'language',
      'signature_template',
      'ai_analysis_enabled',
      'spam_filtering',
      'thread_assignment',
      'priority_routing',
      'customer_tags',
      'integration_webhooks',
      'data_retention_days',
    ]

    const keys: string[] = []
    const count = this.calculateSettingsCount()

    for (let i = 0; i < count; i++) {
      keys.push(settingKeys[i % settingKeys.length]!)
    }
    return keys
  }

  /** generateSettingValues creates realistic configuration values. */
  private generateSettingValues(): Record<string, any>[] {
    const values: Record<string, any>[] = []
    const count = this.calculateSettingsCount()
    const keys = this.generateSettingKeys()

    for (let i = 0; i < count; i++) {
      const key = keys[i]!
      values.push(this.getValueForSettingKey(key))
    }
    return values
  }

  /** getValueForSettingKey generates appropriate value for each setting type. */
  private getValueForSettingKey(key: string): Record<string, any> {
    const valueMap: Record<string, any> = {
      email_notifications: { enabled: true, frequency: 'immediate' },
      auto_reply_enabled: { enabled: false },
      response_time_sla: { hours: 24 },
      escalation_rules: { enabled: true, threshold_hours: 48 },
      working_hours: { start: '09:00', end: '17:00', timezone: 'America/New_York' },
      timezone: { value: 'America/New_York' },
      language: { primary: 'en', secondary: ['es', 'fr'] },
      signature_template: { template: 'Best regards,\n{{user.name}}\n{{organization.name}}' },
      ai_analysis_enabled: { enabled: true, confidence_threshold: 0.8 },
      spam_filtering: { enabled: true, strictness: 'medium' },
      thread_assignment: { auto_assign: true, round_robin: true },
      priority_routing: { enabled: true, vip_keywords: ['urgent', 'asap'] },
      customer_tags: { auto_tag: true, sentiment_tags: true },
      integration_webhooks: { enabled: false, urls: [] },
      data_retention_days: { value: 365 },
    }

    return valueMap[key] || { value: 'default' }
  }

  /** generateUserOverrideFlags creates realistic override permissions. */
  private generateUserOverrideFlags(): boolean[] {
    const flags: boolean[] = []
    const count = this.calculateSettingsCount()

    for (let i = 0; i < count; i++) {
      // 60% allow user override, 40% admin-only
      flags.push(i % 5 !== 0)
    }
    return flags
  }

  /** generateSettingScopes creates realistic setting scope distribution. */
  private generateSettingScopes(): string[] {
    const scopes = ['GENERAL', 'EMAIL', 'AI', 'AUTOMATION', 'SECURITY']
    const result: string[] = []
    const count = this.calculateSettingsCount()

    for (let i = 0; i < count; i++) {
      result.push(scopes[i % scopes.length]!)
    }
    return result
  }

  /** getSeededStartDate returns a consistent start date for seeded data. */
  private getSeededStartDate(): Date {
    const now = new Date()
    return new Date(now.getFullYear() - 1, 0, 1) // One year ago
  }
}
